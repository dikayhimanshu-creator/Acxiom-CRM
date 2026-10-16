// AcxiomCRM backend: Express routes + SQLite database.
// Read this file top-to-bottom: setup, middleware, authentication, CRUD, dashboard, start server.
const express = require("express");
const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, "data");
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new Database(path.join(DATA_DIR, "acxiomcrm.sqlite"));
db.pragma("foreign_keys = ON");
db.pragma("journal_mode = WAL");
db.exec(fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8"));

app.use(helmet({ contentSecurityPolicy: false })); // CSP is disabled for this local demo's inline scripts.
app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, "public")));
app.use("/api/auth", rateLimit({ windowMs: 15 * 60 * 1000, limit: 50 }));

// Set JWT_SECRET in the environment before deploying publicly.
const JWT_SECRET = process.env.JWT_SECRET || "local-demo-secret-change-before-deployment";
const today = () => new Date().toISOString().slice(0, 10);
const validEmail = value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || ""));
const validPhone = value => /^\+?[0-9 ()-]{10,16}$/.test(String(value || "").trim());
const clean = value => String(value ?? "").trim();
const isAdmin = req => req.user.role === "Admin";
const canManageTeam = req => ["Admin", "Manager"].includes(req.user.role);

function audit(userId, action, entity, recordId, details = "", result = "Success") {
  db.prepare(`INSERT INTO audit_logs (user_id, action, entity_name, record_id, details, result)
              VALUES (?, ?, ?, ?, ?, ?)`)
    .run(userId || null, action, entity, recordId || null, String(details).slice(0, 500), result);
}
function fail(res, status, message) { return res.status(status).json({ error: message }); }
function asyncRoute(fn) { return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next); }

function authenticate(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return fail(res, 401, "Please log in first.");
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    const user = db.prepare("SELECT id, name, email, role, active FROM users WHERE id = ?").get(req.user.id);
    if (!user || !user.active) return fail(res, 401, "Account is unavailable.");
    req.user = user;
    next();
  } catch {
    return fail(res, 401, "Session expired or invalid. Please log in again.");
  }
}
function allowRoles(...roles) {
  return (req, res, next) => roles.includes(req.user.role)
    ? next() : fail(res, 403, "Your role does not have permission for this action.");
}
function ownerScope(req, alias = "owner_id") {
  if (isAdmin(req) || req.user.role === "Manager") return { sql: "1=1", args: [] };
  return { sql: `${alias} = ?`, args: [req.user.id] };
}
function requireFields(body, fields) {
  for (const field of fields) if (!clean(body[field])) return `${field} is required.`;
  return null;
}
function validateContact(body, requireContact = true) {
  if (requireContact || body.email) {
    if (!validEmail(body.email)) return "Enter a valid email address.";
  }
  if (requireContact || body.phone) {
    if (!validPhone(body.phone)) return "Enter a valid phone number.";
  }
  return null;
}

// Health check can be used to prove the backend is running.
app.get("/api/health", (req, res) => res.json({ status: "ok", application: "AcxiomCRM", database: "SQLite" }));

// First registration creates the Admin account. Later registrations are Admin-only.
app.post("/api/auth/register", (req, res) => {
  const error = requireFields(req.body, ["name", "email", "password"]);
  if (error) return fail(res, 400, error);
  const name = clean(req.body.name), email = clean(req.body.email).toLowerCase(), password = String(req.body.password);
  if (!validEmail(email)) return fail(res, 400, "Enter a valid email address.");
  if (password.length < 8) return fail(res, 400, "Password must be at least 8 characters.");
  const firstUser = db.prepare("SELECT COUNT(*) AS count FROM users").get().count === 0;
  if (!firstUser) {
    const header = req.headers.authorization || "";
    let current;
    try { current = jwt.verify(header.startsWith("Bearer ") ? header.slice(7) : "", JWT_SECRET); } catch {}
    if (!current || current.role !== "Admin") return fail(res, 403, "Only an Admin can create additional users.");
  }
  const role = firstUser ? "Admin" : (["Admin", "Manager", "SalesExecutive"].includes(req.body.role) ? req.body.role : "SalesExecutive");
  try {
    const hash = bcrypt.hashSync(password, 12);
    const info = db.prepare("INSERT INTO users (name,email,password_hash,role) VALUES (?,?,?,?)").run(name,email,hash,role);
    audit(info.lastInsertRowid, "REGISTER", "User", info.lastInsertRowid, `Created ${role} account`);
    res.status(201).json({ message: "User created.", user: { id: info.lastInsertRowid, name, email, role } });
  } catch (e) {
    if (String(e.message).includes("UNIQUE")) return fail(res, 409, "An account with this email already exists.");
    throw e;
  }
});

app.post("/api/auth/login", (req, res) => {
  const email = clean(req.body.email).toLowerCase(), password = String(req.body.password || "");
  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
  if (!user || !user.active) {
    audit(user?.id, "LOGIN_FAILED", "User", user?.id, "Unknown or inactive account", "Failure");
    return fail(res, 401, "Invalid email or password.");
  }
  if (user.lockout_until && user.lockout_until > new Date().toISOString()) return fail(res, 423, "Account temporarily locked. Try again later.");
  if (!bcrypt.compareSync(password, user.password_hash)) {
    const count = user.failed_login_count + 1;
    const lockout = count >= 5 ? new Date(Date.now() + 10 * 60 * 1000).toISOString() : null;
    db.prepare("UPDATE users SET failed_login_count=?, lockout_until=? WHERE id=?").run(count, lockout, user.id);
    audit(user.id, "LOGIN_FAILED", "User", user.id, "Invalid password", "Failure");
    return fail(res, 401, count >= 5 ? "Too many attempts. Account locked for 10 minutes." : "Invalid email or password.");
  }
  db.prepare("UPDATE users SET failed_login_count=0, lockout_until=NULL WHERE id=?").run(user.id);
  const safeUser = { id: user.id, name: user.name, email: user.email, role: user.role };
  const token = jwt.sign(safeUser, JWT_SECRET, { expiresIn: "8h" });
  audit(user.id, "LOGIN", "User", user.id, "Successful login");
  res.json({ token, user: safeUser });
});
app.post("/api/auth/logout", authenticate, (req, res) => {
  audit(req.user.id, "LOGOUT", "User", req.user.id, "Client requested logout");
  res.json({ message: "Logged out. Clear the token in the browser." });
});
app.get("/api/auth/me", authenticate, (req, res) => res.json({ user: req.user }));

// Users and roles: only Admin can inspect or change user access.
app.get("/api/users", authenticate, allowRoles("Admin"), (req, res) => {
  res.json(db.prepare("SELECT id,name,email,role,active,created_at FROM users ORDER BY id").all());
});
app.patch("/api/users/:id/role", authenticate, allowRoles("Admin"), (req, res) => {
  const role = req.body.role;
  if (!["Admin","Manager","SalesExecutive"].includes(role)) return fail(res,400,"Invalid role.");
  const info = db.prepare("UPDATE users SET role=? WHERE id=?").run(role, req.params.id);
  if (!info.changes) return fail(res,404,"User not found.");
  audit(req.user.id,"ROLE_CHANGE","User",req.params.id,`Role changed to ${role}`);
  res.json({message:"Role updated."});
});
app.patch("/api/users/:id/active", authenticate, allowRoles("Admin"), (req, res) => {
  const active = req.body.active ? 1 : 0;
  if (Number(req.params.id) === req.user.id && !active) return fail(res,400,"You cannot deactivate your own account.");
  const info = db.prepare("UPDATE users SET active=? WHERE id=?").run(active,req.params.id);
  if (!info.changes) return fail(res,404,"User not found.");
  audit(req.user.id,"USER_STATUS_CHANGE","User",req.params.id,`Active set to ${active}`);
  res.json({message:"User status updated."});
});

// Generic CRUD routes keep the code easy to follow while validating each resource separately.
const resources = {
 customers: {
  table:"customers", entity:"Customer", required:["name","company","email","phone"],
  fields:["name","company","email","phone","address","city","status","owner_id"],
  defaults:{status:"Active"},
  validate:(b)=>validateContact(b,true),
  normalize:(b)=>({...b,name:clean(b.name),company:clean(b.company),email:clean(b.email).toLowerCase(),phone:clean(b.phone),address:clean(b.address),city:clean(b.city),status:b.status||"Active"})
 },
 leads: {
  table:"leads", entity:"Lead", required:["name"],
  fields:["name","company","email","phone","source","status","priority","expected_value","owner_id"],
  defaults:{source:"Website",status:"New",priority:"Medium",expected_value:0},
  validate:(b)=>{if(b.email&&!validEmail(b.email))return "Enter a valid email address.";if(b.phone&&!validPhone(b.phone))return "Enter a valid phone number.";if(Number(b.expected_value||0)<0)return "Expected value cannot be negative.";return null;},
  normalize:(b)=>({...b,name:clean(b.name),company:clean(b.company),email:clean(b.email),phone:clean(b.phone),source:b.source||"Website",status:b.status||"New",priority:b.priority||"Medium",expected_value:Number(b.expected_value||0)})
 },
 opportunities: {
  table:"opportunities", entity:"Opportunity", required:["name","amount","probability","stage","expected_close_date"],
  fields:["name","customer_id","lead_id","amount","probability","stage","expected_close_date","owner_id"],
  defaults:{stage:"Qualification"},
  validate:(b)=>{if(!Number.isFinite(Number(b.amount))||Number(b.amount)<=0)return "Opportunity amount must be greater than zero.";if(!Number.isInteger(Number(b.probability))||Number(b.probability)<0||Number(b.probability)>100)return "Probability must be between 0 and 100.";if(!b.expected_close_date)return "Expected close date is required.";if(!["Won","Lost"].includes(b.stage)&&b.expected_close_date<today())return "Expected close date cannot be in the past.";return null;},
  normalize:(b)=>({...b,name:clean(b.name),customer_id:b.customer_id?Number(b.customer_id):null,lead_id:b.lead_id?Number(b.lead_id):null,amount:Number(b.amount),probability:Number(b.probability),stage:b.stage||"Qualification",expected_close_date:b.expected_close_date})
 },
 followups: {
  table:"followups", entity:"FollowUp", required:["subject","followup_date"],
  fields:["subject","related_type","related_id","followup_date","type","status","notes","owner_id"],
  defaults:{related_type:"Customer",type:"Call",status:"Planned"},
  validate:(b)=>{if(!b.followup_date)return "Follow-up date is required.";if((b.status||"Planned")==="Planned"&&b.followup_date<today())return "Follow-up date cannot be earlier than today.";return null;},
  normalize:(b)=>({...b,subject:clean(b.subject),related_type:b.related_type||"Customer",related_id:b.related_id?Number(b.related_id):null,followup_date:b.followup_date,type:b.type||"Call",status:b.status||"Planned",notes:clean(b.notes)})
 },
 activities: {
  table:"activities", entity:"Activity", required:["subject","activity_date"],
  fields:["subject","activity_type","description","activity_date","status","customer_id","lead_id","owner_id"],
  defaults:{activity_type:"Task",status:"Planned"},
  validate:(b)=>b.activity_date?null:"Activity date is required.",
  normalize:(b)=>({...b,subject:clean(b.subject),activity_type:b.activity_type||"Task",description:clean(b.description),activity_date:b.activity_date,status:b.status||"Planned",customer_id:b.customer_id?Number(b.customer_id):null,lead_id:b.lead_id?Number(b.lead_id):null})
 }
};

for (const [urlName, config] of Object.entries(resources)) {
  app.get(`/api/${urlName}`, authenticate, (req, res) => {
    const scope = ownerScope(req);
    const rows = db.prepare(`SELECT * FROM ${config.table} WHERE ${scope.sql} ORDER BY id DESC`).all(...scope.args);
    res.json(rows);
  });

  app.get(`/api/${urlName}/:id`, authenticate, (req, res) => {
    const scope = ownerScope(req);
    const row = db.prepare(`SELECT * FROM ${config.table} WHERE id=? AND ${scope.sql}`).get(req.params.id, ...scope.args);
    if (!row) return fail(res,404,"Record not found.");
    res.json(row);
  });

  app.post(`/api/${urlName}`, authenticate, (req, res) => {
    const requiredError = requireFields(req.body, config.required);
    if (requiredError) return fail(res,400,requiredError);
    const validationError = config.validate(req.body);
    if (validationError) return fail(res,400,validationError);
    const record = config.normalize(req.body);
    if (req.user.role === "SalesExecutive") record.owner_id = req.user.id;
    else if (!record.owner_id) record.owner_id = req.user.id;
    record.created_by = req.user.id;
    const fields = [...config.fields,"created_by"];
    const values = fields.map(field => record[field] ?? null);
    try {
      const info = db.prepare(`INSERT INTO ${config.table} (${fields.join(",")}) VALUES (${fields.map(()=>"?").join(",")})`).run(...values);
      audit(req.user.id,"CREATE",config.entity,info.lastInsertRowid,`Created ${config.entity}`);
      res.status(201).json(db.prepare(`SELECT * FROM ${config.table} WHERE id=?`).get(info.lastInsertRowid));
    } catch(e) {
      if (String(e.message).includes("UNIQUE")) return fail(res,409,"A record with that unique email or phone already exists.");
      if (String(e.message).includes("CHECK")) return fail(res,400,"One or more values are outside the allowed range.");
      throw e;
    }
  });

  app.put(`/api/${urlName}/:id`, authenticate, (req, res) => {
    const scope = ownerScope(req);
    const existing = db.prepare(`SELECT * FROM ${config.table} WHERE id=? AND ${scope.sql}`).get(req.params.id,...scope.args);
    if (!existing) return fail(res,404,"Record not found or not assigned to you.");
    const requiredError = requireFields(req.body, config.required);
    if (requiredError) return fail(res,400,requiredError);
    const validationError = config.validate(req.body);
    if (validationError) return fail(res,400,validationError);
    const record = config.normalize(req.body);
    if (req.user.role === "SalesExecutive") record.owner_id = req.user.id;
    const fields = config.fields.filter(f=>f!=="owner_id" || canManageTeam(req));
    const assignments = fields.map(f=>`${f}=?`).concat(["updated_at=datetime('now')"]).join(",");
    try {
      db.prepare(`UPDATE ${config.table} SET ${assignments} WHERE id=?`).run(...fields.map(f=>record[f]??null),req.params.id);
      audit(req.user.id,"UPDATE",config.entity,req.params.id,`Updated ${config.entity}`);
      res.json(db.prepare(`SELECT * FROM ${config.table} WHERE id=?`).get(req.params.id));
    } catch(e) {
      if (String(e.message).includes("UNIQUE")) return fail(res,409,"A record with that unique email or phone already exists.");
      if (String(e.message).includes("CHECK")) return fail(res,400,"One or more values are outside the allowed range.");
      throw e;
    }
  });

  app.delete(`/api/${urlName}/:id`, authenticate, (req, res) => {
    if (urlName === "customers" && !canManageTeam(req)) return fail(res,403,"Only Admin or Manager can delete customers.");
    const scope = ownerScope(req);
    const row = db.prepare(`SELECT id FROM ${config.table} WHERE id=? AND ${scope.sql}`).get(req.params.id,...scope.args);
    if (!row) return fail(res,404,"Record not found or not assigned to you.");
    db.prepare(`DELETE FROM ${config.table} WHERE id=?`).run(req.params.id);
    audit(req.user.id,"DELETE",config.entity,req.params.id,`Deleted ${config.entity}`);
    res.json({message:`${config.entity} deleted.`});
  });
}

// Dashboard values are calculated from the database, not hard-coded in the browser.
app.get("/api/dashboard", authenticate, (req,res)=>{
  const scope=ownerScope(req);
  const scopedCount=table=>db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${scope.sql}`).get(...scope.args).count;
  const openOpps=db.prepare(`SELECT COALESCE(SUM(amount),0) AS amount FROM opportunities WHERE ${scope.sql} AND stage NOT IN ('Won','Lost')`).get(...scope.args).amount;
  const stageRows=db.prepare(`SELECT stage,COUNT(*) AS count FROM opportunities WHERE ${scope.sql} GROUP BY stage`).all(...scope.args);
  const leadRows=db.prepare(`SELECT status,COUNT(*) AS count FROM leads WHERE ${scope.sql} GROUP BY status`).all(...scope.args);
  res.json({customers:scopedCount("customers"),leads:scopedCount("leads"),opportunities:scopedCount("opportunities"),followups:scopedCount("followups"),openPipeline:openOpps,stages:stageRows,leadStatuses:leadRows});
});

// Audit logs are restricted to Admin. Reports are role-scoped.
app.get("/api/audit", authenticate, allowRoles("Admin"), (req,res)=>{
  res.json(db.prepare(`SELECT a.*,u.name AS user_name FROM audit_logs a LEFT JOIN users u ON a.user_id=u.id ORDER BY a.id DESC LIMIT 300`).all());
});
app.get("/api/reports/pipeline", authenticate, (req,res)=>{
  const scope=ownerScope(req);
  res.json(db.prepare(`SELECT stage,COUNT(*) AS deal_count,SUM(amount) AS amount,SUM(amount*probability/100.0) AS weighted_amount FROM opportunities WHERE ${scope.sql} GROUP BY stage ORDER BY stage`).all(...scope.args));
});
app.get("/api/reports/leads", authenticate, (req,res)=>{
  const scope=ownerScope(req);
  res.json(db.prepare(`SELECT status,COUNT(*) AS count FROM leads WHERE ${scope.sql} GROUP BY status ORDER BY status`).all(...scope.args));
});

// Friendly JSON errors without exposing stack traces to the browser.
app.use("/api", (req,res)=>fail(res,404,"API endpoint not found."));
app.use((err,req,res,next)=>{
  console.error(err.message);
  res.status(500).json({error:"Something went wrong on the server. Check the terminal for the developer error."});
});

app.listen(PORT,()=>{
  console.log(`AcxiomCRM running at http://localhost:${PORT}`);
  console.log("Database file: data/acxiomcrm.sqlite");
  console.log("First registered account becomes Admin. Use a strong password.");
});
