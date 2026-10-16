// Frontend logic. All real data is requested from the Express API.
const API="/api";
let token=localStorage.getItem("crm-token")||"";
let currentUser=null, currentPage="Dashboard", editingId=null;
const modal=new bootstrap.Modal(document.getElementById("recordModal"));
const pageInfo={
 Dashboard:["Dashboard overview","A database-backed view of your sales workspace."],
 Customers:["Customers","Create, search, edit and remove customer records."],
 Leads:["Leads","Track prospects and their qualification status."],
 Opportunities:["Opportunities","Track deal value, stage and close date."],
 FollowUps:["Follow-Ups","Schedule and track customer follow-up activities."],
 Activities:["Activities","Record calls, meetings, emails and tasks."],
 Reports:["Reports","Summaries calculated from your database."],
 Audit:["Audit Log","Review recorded actions. Admin access only."]
};
const resourceMap={Customers:"customers",Leads:"leads",Opportunities:"opportunities",FollowUps:"followups",Activities:"activities"};
const configs={
 Customers:{url:"customers",fields:[["name","Customer name","text"],["company","Company","text"],["email","Email","email"],["phone","Phone","tel"],["address","Address","text"],["city","City","text"],["status","Status","select",["Active","Inactive"]]]},
 Leads:{url:"leads",fields:[["name","Lead name","text"],["company","Company","text"],["email","Email (optional)","email"],["phone","Phone (optional)","tel"],["source","Source","select",["Website","Referral","Campaign","Event","Other"]],["status","Status","select",["New","Contacted","Qualified","Unqualified","Converted","Lost"]],["priority","Priority","select",["Low","Medium","High"]],["expected_value","Expected value","number"]]},
 Opportunities:{url:"opportunities",fields:[["name","Opportunity name","text"],["amount","Amount","number"],["probability","Probability (%)","number"],["stage","Stage","select",["Qualification","Proposal","Negotiation","Won","Lost"]],["expected_close_date","Expected close date","date"],["customer_id","Customer ID (optional)","number"]]},
 FollowUps:{url:"followups",fields:[["subject","Subject","text"],["related_type","Related record type","select",["Customer","Lead","Opportunity"]],["related_id","Related record ID (optional)","number"],["followup_date","Follow-up date","date"],["type","Type","select",["Call","Meeting","Email","Task"]],["status","Status","select",["Planned","Completed","Missed","Cancelled"]],["notes","Notes","text"]]},
 Activities:{url:"activities",fields:[["subject","Subject","text"],["activity_type","Type","select",["Call","Meeting","Email","Task"]],["description","Description","text"],["activity_date","Activity date","date"],["status","Status","select",["Planned","Completed"]],["customer_id","Customer ID (optional)","number"]]}
};
async function api(path,options={}){
 const headers={"Content-Type":"application/json",...(options.headers||{})};
 if(token)headers.Authorization="Bearer "+token;
 const response=await fetch(API+path,{...options,headers});
 const body=await response.json().catch(()=>({}));
 if(!response.ok)throw new Error(body.error||"Request failed");
 return body;
}
function toast(message){document.getElementById("toastText").textContent=message;bootstrap.Toast.getOrCreateInstance(document.getElementById("toast")).show()}
function esc(value){return String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function money(value){return new Intl.NumberFormat("en-IN",{style:"currency",currency:"INR",maximumFractionDigits:0}).format(Number(value||0))}
function statusPill(value){return `<span class="pill">${esc(value||"—")}</span>`}
function loginScreen(register=false){
 document.getElementById("app").innerHTML=`<div class="auth-wrap px-3"><div class="card p-4 p-md-5"><div class="brand text-dark mb-2">Acxiom<span>CRM</span></div><div class="muted mb-4">${register?"Create the first account. It will become Admin.":"Sign in to your CRM workspace."}</div><form id="authForm">${register?`<label class="form-label small">Full name</label><input class="form-control mb-3" name="name" required>`:""}<label class="form-label small">Email</label><input class="form-control mb-3" type="email" name="email" required><label class="form-label small">Password</label><input class="form-control mb-3" type="password" name="password" minlength="8" required><button class="btn btn-primary w-100 mt-2">${register?"Create account":"Sign in"}</button></form><div class="small mt-3"><a href="#" id="toggleAuth">${register?"Already registered? Sign in":"First time here? Create the Admin account"}</a></div><div class="muted mt-3">For this local demo, the first registered account receives the Admin role.</div></div></div>`;
 document.getElementById("authForm").addEventListener("submit",async e=>{e.preventDefault();const form=Object.fromEntries(new FormData(e.target));try{if(register){await api("/auth/register",{method:"POST",body:JSON.stringify(form)});toast("Account created. Please sign in.");loginScreen(false)}else{const result=await api("/auth/login",{method:"POST",body:JSON.stringify(form)});token=result.token;localStorage.setItem("crm-token",token);currentUser=result.user;renderShell();await go("Dashboard")}}catch(err){toast(err.message)}});
 document.getElementById("toggleAuth").onclick=e=>{e.preventDefault();loginScreen(!register)};
}
function renderShell(){
 document.getElementById("app").innerHTML=`<aside class="sidebar"><div class="brand">Acxiom<span>CRM</span></div><div class="eyebrow px-3 mb-2" style="color:#8292aa">Workspace</div><nav id="nav"><div class="nav-link active" data-page="Dashboard"><span class="sym">▦ </span>Dashboard</div><div class="nav-link" data-page="Customers"><span class="sym">♙ </span>Customers</div><div class="nav-link" data-page="Leads"><span class="sym">◎ </span>Leads</div><div class="nav-link" data-page="Opportunities"><span class="sym">↗ </span>Opportunities</div><div class="nav-link" data-page="FollowUps"><span class="sym">◷ </span>Follow-Ups</div><div class="nav-link" data-page="Activities"><span class="sym">☷ </span>Activities</div><div class="nav-link" data-page="Reports"><span class="sym">▤ </span>Reports</div>${currentUser.role==="Admin"?`<div class="nav-link" data-page="Audit"><span class="sym">◉ </span>Audit Log</div><div class="nav-link" data-page="Users"><span class="sym">♧ </span>Users & Roles</div>`:""}</nav><div class="mt-5 px-3 small" style="color:#8292aa">SIGNED IN AS<br><span style="color:#d6deeb">${esc(currentUser.name)}</span><br><span class="pill mt-2">${esc(currentUser.role)}</span><br><button id="logout" class="btn btn-sm btn-outline-light mt-3">Log out</button></div></aside><main class="main"><header class="topline"><div><div class="eyebrow">Sales workspace / <span id="crumb">Overview</span></div><h1 id="title">Dashboard overview</h1><div class="muted" id="subtitle"></div></div><div class="pill">API connected</div></header><div id="content"></div></main>`;
 document.getElementById("nav").onclick=e=>{const el=e.target.closest("[data-page]");if(el)go(el.dataset.page)};
 document.getElementById("logout").onclick=async()=>{try{await api("/auth/logout",{method:"POST"})}catch{}token="";currentUser=null;localStorage.removeItem("crm-token");loginScreen(false)};
}
async function go(page){
 currentPage=page;document.querySelectorAll("[data-page]").forEach(el=>el.classList.toggle("active",el.dataset.page===page));
 document.getElementById("crumb").textContent=page==="Dashboard"?"Overview":page;
 document.getElementById("title").textContent=page==="Dashboard"?"Dashboard overview":page==="FollowUps"?"Follow-Ups":page==="Users"?"Users & Roles":page==="Audit"?"Audit Log":page;
 document.getElementById("subtitle").textContent=(pageInfo[page]||[])[1]||"Manage your CRM workspace.";
 try{
  if(page==="Dashboard")await dashboard();
  else if(page==="Reports")await reports();
  else if(page==="Users")await users();
  else if(page==="Audit")await auditPage();
  else await listPage(page);
 }catch(e){document.getElementById("content").innerHTML=`<div class="alert alert-danger">${esc(e.message)}</div>`}
}
async function dashboard(){
 const d=await api("/dashboard");
 const cards=[["Customers",d.customers],["Leads",d.leads],["Opportunities",d.opportunities],["Open pipeline",money(d.openPipeline)]];
 document.getElementById("content").innerHTML=`<div class="row g-3 mb-3">${cards.map((c,i)=>`<div class="col-12 col-sm-6 col-xl-3"><div class="card metric"><div class="metric-label">${c[0]}</div><div class="metric-value">${c[1]}</div><div class="muted">Calculated by the backend</div></div></div>`).join("")}</div><div class="row g-3"><div class="col-12 col-lg-6"><div class="card section"><div class="section-title mb-3">Opportunities by stage</div>${d.stages.length?d.stages.map(x=>`<div class="d-flex justify-content-between py-2 border-bottom"><span>${esc(x.stage)}</span><strong>${x.count}</strong></div>`).join(""):`<div class="empty">Create an opportunity to see the pipeline.</div>`}</div></div><div class="col-12 col-lg-6"><div class="card section"><div class="section-title mb-3">Leads by status</div>${d.leadStatuses.length?d.leadStatuses.map(x=>`<div class="d-flex justify-content-between py-2 border-bottom"><span>${esc(x.status)}</span><strong>${x.count}</strong></div>`).join(""):`<div class="empty">Create a lead to see status totals.</div>`}</div></div></div>`;
}
function tableFor(page,rows){
 const cols={
 Customers:[["name","Customer"],["company","Company"],["email","Email"],["phone","Phone"],["status","Status"]],
 Leads:[["name","Lead"],["company","Company"],["source","Source"],["status","Status"],["priority","Priority"]],
 Opportunities:[["name","Opportunity"],["amount","Amount"],["probability","Probability"],["stage","Stage"],["expected_close_date","Close date"]],
 FollowUps:[["subject","Subject"],["related_type","Related type"],["followup_date","Date"],["type","Type"],["status","Status"]],
 Activities:[["subject","Subject"],["activity_type","Type"],["activity_date","Date"],["status","Status"]]
 }[page];
 return `<div class="table-responsive"><table class="table table-hover mb-0"><thead><tr>${cols.map(c=>`<th>${c[1]}</th>`).join("")}<th class="text-end">Actions</th></tr></thead><tbody>${rows.map(row=>`<tr>${cols.map(c=>{let v=row[c[0]]??"—";if(c[0]==="amount")v=money(v);if(c[0]==="probability")v=v+"%";return `<td>${["status","stage"].includes(c[0])?statusPill(v):esc(v)}</td>`}).join("")}<td class="text-end text-nowrap"><button class="btn btn-sm btn-light me-1" onclick="editRow('${page}',${row.id})">Edit</button><button class="btn btn-sm btn-outline-danger" onclick="deleteRow('${page}',${row.id})">Delete</button></td></tr>`).join("")}</tbody></table></div>`;
}
let activeRows=[];
async function listPage(page){
 const cfg=configs[page];activeRows=await api("/"+cfg.url);
 document.getElementById("content").innerHTML=`<div class="card section"><div class="d-flex flex-column flex-md-row gap-3 justify-content-between mb-4"><div><div class="section-title">${page==="FollowUps"?"Follow-Ups":page} directory</div><div class="muted">${activeRows.length} records stored in SQLite</div></div><div class="d-flex gap-2"><input id="search" class="form-control" placeholder="Search records..." oninput="filterTable()" style="max-width:240px"><button class="btn btn-primary" onclick="openForm('${page}')">＋ Add record</button></div></div><div id="tableArea">${activeRows.length?tableFor(page,activeRows):`<div class="empty">No records yet. Click “Add record” to create one.</div>`}</div></div>`;
}
function filterTable(){const q=document.getElementById("search").value.toLowerCase();const rows=activeRows.filter(r=>Object.values(r).some(v=>String(v??"").toLowerCase().includes(q)));document.getElementById("tableArea").innerHTML=rows.length?tableFor(currentPage,rows):`<div class="empty">No matching records.</div>`}
function openForm(page,id=null){
 const cfg=configs[page],old=id?activeRows.find(x=>x.id===id)||{}:{};
 editingId=id;document.getElementById("modalTitle").textContent=(id?"Edit ":"Add ")+page.replace(/s$/,"");
 document.getElementById("fields").innerHTML=cfg.fields.map(([key,label,type,options])=>{let value=old[key]??(key==="status"?"Active":key==="probability"?50:key==="expected_close_date"||key==="followup_date"||key==="activity_date"?new Date().toISOString().slice(0,10):"");let html=type==="select"?`<select class="form-select" id="f-${key}" required>${options.map(o=>`<option ${o===value?"selected":""}>${o}</option>`).join("")}</select>`:`<input class="form-control" id="f-${key}" type="${type}" value="${esc(value)}" ${["name","company","email","phone","subject","amount","probability","expected_close_date","followup_date","activity_date"].includes(key)&&!(key==="email"&&page==="Leads"||key==="phone"&&page==="Leads")?"required":""} ${type==="number"?(key==="probability"?'min="0" max="100"':'min="0"'):''}>`;return `<div class="mb-3"><label class="form-label small fw-semibold">${label}</label>${html}</div>`}).join("");
 modal.show();
}
async function editRow(page,id){openForm(page,id)}
async function deleteRow(page,id){if(!confirm("Delete this record?"))return;try{await api("/"+configs[page].url+"/"+id,{method:"DELETE"});toast("Record deleted.");await go(page)}catch(e){toast(e.message)}}
document.getElementById("recordForm").addEventListener("submit",async e=>{
 e.preventDefault();const cfg=configs[currentPage],body={};
 for(const [key,label,type] of cfg.fields){const el=document.getElementById("f-"+key);body[key]=type==="number"?(el.value===""?null:Number(el.value)):el.value.trim()}
 try{await api("/"+cfg.url+(editingId?"/"+editingId:""),{method:editingId?"PUT":"POST",body:JSON.stringify(body)});modal.hide();toast(editingId?"Record updated.":"Record created.");await go(currentPage)}catch(err){toast(err.message)}
});
async function reports(){
 const [pipeline,leads]=await Promise.all([api("/reports/pipeline"),api("/reports/leads")]);
 document.getElementById("content").innerHTML=`<div class="row g-3"><div class="col-12 col-lg-6"><div class="card section"><div class="section-title mb-3">Pipeline report</div>${pipeline.length?`<div class="table-responsive"><table class="table"><thead><tr><th>Stage</th><th>Deals</th><th>Value</th><th>Weighted</th></tr></thead><tbody>${pipeline.map(x=>`<tr><td>${esc(x.stage)}</td><td>${x.deal_count}</td><td>${money(x.amount)}</td><td>${money(x.weighted_amount)}</td></tr>`).join("")}</tbody></table></div>`:"No opportunity data yet."}</div></div><div class="col-12 col-lg-6"><div class="card section"><div class="section-title mb-3">Lead status report</div>${leads.length?leads.map(x=>`<div class="d-flex justify-content-between py-2 border-bottom"><span>${esc(x.status)}</span><strong>${x.count}</strong></div>`).join(""):"No lead data yet."}</div></div></div>`;
}
async function auditPage(){
 const rows=await api("/audit");
 document.getElementById("content").innerHTML=`<div class="card section"><div class="section-title mb-3">Recent audit events</div>${rows.length?`<div class="table-responsive"><table class="table"><thead><tr><th>Time</th><th>User</th><th>Action</th><th>Entity</th><th>Details</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.created_at)}</td><td>${esc(r.user_name||"System")}</td><td>${esc(r.action)}</td><td>${esc(r.entity_name)}</td><td>${esc(r.details)}</td></tr>`).join("")}</tbody></table></div>`:"No audit events yet."}</div>`;
}
async function users(){
 const rows=await api("/users");
 document.getElementById("content").innerHTML=`<div class="card section"><div class="section-title mb-3">User accounts</div><div class="muted mb-3">First registration creates the Admin. Additional accounts can be registered by an Admin via POST /api/auth/register with the token.</div><div class="table-responsive"><table class="table"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Active</th><th>Actions</th></tr></thead><tbody>${rows.map(u=>`<tr><td>${esc(u.name)}</td><td>${esc(u.email)}</td><td><select class="form-select form-select-sm" id="role-${u.id}" style="max-width:180px">${["Admin","Manager","SalesExecutive"].map(r=>`<option ${r===u.role?"selected":""}>${r}</option>`).join("")}</select></td><td>${u.active?"Yes":"No"}</td><td><button class="btn btn-sm btn-light" onclick="saveRole(${u.id})">Save role</button><button class="btn btn-sm btn-outline-secondary ms-1" onclick="toggleUser(${u.id},${u.active?0:1})">${u.active?"Deactivate":"Activate"}</button></td></tr>`).join("")}</tbody></table></div></div>`;
}
async function saveRole(id){try{await api("/users/"+id+"/role",{method:"PATCH",body:JSON.stringify({role:document.getElementById("role-"+id).value})});toast("Role updated.");await users()}catch(e){toast(e.message)}}
async function toggleUser(id,active){try{await api("/users/"+id+"/active",{method:"PATCH",body:JSON.stringify({active:!!active})});toast("User status updated.");await users()}catch(e){toast(e.message)}}
(async function start(){
 if(!token){loginScreen(false);return}
 try{const result=await api("/auth/me");currentUser=result.user;renderShell();await go("Dashboard")}
 catch{token="";localStorage.removeItem("crm-token");loginScreen(false)}
})();
