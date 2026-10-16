# AcxiomCRM Full-Stack Demo

A beginner-friendly CRM application built with:
- HTML, CSS, Bootstrap and browser JavaScript
- Node.js and Express REST API
- SQLite database (`data/acxiomcrm.sqlite`)
- bcrypt password hashing, JWT sessions, basic lockout, role checks, validation and audit logging

## Run on Windows

1. Install Node.js LTS (Node 20 or later): https://nodejs.org/
2. Extract this folder.
3. Open this folder in VS Code.
4. Open Terminal > New Terminal.
5. Run:

   ```bash
   npm install
   npm start
   ```

6. Open http://localhost:3000
7. Choose **Create the Admin account**. The first registered account becomes Admin. Use a password of at least 8 characters.

The SQLite database is automatically created in `data/acxiomcrm.sqlite` on the first run. Do not delete this file if you want to keep your records.

## Main API routes

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/health` | Check server status |
| POST | `/api/auth/register` | Create first Admin; later user creation requires Admin token |
| POST | `/api/auth/login` | Sign in and receive JWT |
| GET | `/api/auth/me` | Current user |
| POST | `/api/auth/logout` | Record logout request |
| GET/POST | `/api/customers` | List/create customers |
| GET/PUT/DELETE | `/api/customers/:id` | Read/update/delete a customer |
| GET/POST | `/api/leads` | List/create leads |
| GET/POST | `/api/opportunities` | List/create opportunities |
| GET/POST | `/api/followups` | List/create follow-ups |
| GET/POST | `/api/activities` | List/create activities |
| GET | `/api/dashboard` | Database-backed KPI counts and pipeline |
| GET | `/api/reports/pipeline` | Stage-wise deal count/value/weighted value |
| GET | `/api/reports/leads` | Lead status counts |
| GET | `/api/audit` | Admin-only audit events |
| GET | `/api/users` | Admin-only user list |
| PATCH | `/api/users/:id/role` | Admin-only role update |
| PATCH | `/api/users/:id/active` | Admin-only account activation/deactivation |

All CRUD resources also have `GET /api/<resource>/:id`, `PUT /api/<resource>/:id`, and `DELETE /api/<resource>/:id` routes.

## How to explain the architecture

1. The browser renders the UI and sends HTTP requests with `fetch()`.
2. Express receives `/api/...` requests.
3. Authentication middleware checks the JWT and loads the user's current role.
4. The route validates inputs and applies role/ownership rules.
5. SQL statements read/write SQLite.
6. The API returns JSON; the browser updates the screen.
7. Important actions are inserted into `audit_logs`.

## Important limitations before production

This is an interview/demo baseline, not a production-certified CRM. The JWT secret has a local-demo fallback and **must** be set to a strong random environment secret before deployment. Use HTTPS in deployment. For production, add CSRF protections appropriate to the chosen token/cookie model, stronger security headers/CSP, refresh/revocation strategy, automated tests, backup/migration procedures, more complete record ownership rules, and security review. The demo uses a simple frontend JWT stored in localStorage; do not use this pattern for sensitive production systems without a security review.

The app provides backend validation, SQL constraints, hashed passwords, temporary lockout after five failed attempts, role middleware, and audit records. Always test the actual requirements before claiming every acceptance criterion is satisfied.
