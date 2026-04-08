# Reconnaissance Deliverable: SkyLapse IP Camera Management Platform

## 0) HOW TO READ THIS

This reconnaissance report provides a comprehensive map of the SkyLapse application's attack surface, with special emphasis on authorization and privilege escalation opportunities for all downstream specialist agents.

**Key Sections for Authorization Analysis:**
- **Section 4 (API Endpoint Inventory):** Contains authorization details for each endpoint — focus on "Required Role" and "Object ID Parameters" columns to identify IDOR candidates. The static file routes at the bottom are the most critical IDOR surface.
- **Section 6.4 (Guards Directory):** Catalog of authorization controls — understand what `isAnyAuthenticated` means vs `isClientAuthenticated` with `allowedIds` check.
- **Section 7 (Role & Privilege Architecture):** Complete role hierarchy — only two roles (Admin, Client). No sub-roles.
- **Section 8 (Authorization Vulnerability Candidates):** Pre-prioritized lists — the static file IDOR is the highest-priority finding.

**How to Use the Network Mapping (Section 6):** The entity/flow mapping shows the SkyLapse system boundaries. Pay special attention to the CameraService entity and the capture/video static file paths that bypass the JSON API authorization layer.

**Priority Order for Testing:**
1. Static file IDOR (`/api/captures/**`, `/api/videos/**`) — any authenticated user accesses any camera's media
2. Admin-to-admin horizontal escalation (`PUT /api/admin/accounts/:id`) — any admin takes over any other admin
3. SSRF via camera creation/update — stored SSRF via hostname/streamUrl with weak blocklist
4. Client date parameter injection (`dataInicio`/`dataFim` without validation on client routes)

---

## 1. Executive Summary

SkyLapse is a TypeScript monolithic web application providing IP camera monitoring, automated image capture (every 60 seconds), and timelapse video generation for construction site surveillance. The application serves a React SPA and REST API from a single Express.js 5 process, backed by PostgreSQL 16. It exposes **61 network-accessible API endpoints** across three authorization tiers: public (6 endpoints), admin-authenticated (48 endpoints), and client-authenticated (7 endpoints), plus 2 static file middleware paths.

The **most critical attack surfaces** are:
1. **Stored SSRF** — Admin-configured camera hostnames and stream URLs are fetched server-side with only a 3-entry blocklist that is trivially bypassable and only applied to the test endpoint (not actual fetches).
2. **Static file IDOR** — The `/api/captures/**` and `/api/videos/**` routes authenticate users but perform no camera-level access control, allowing any authenticated client to read any camera's media files.
3. **Broken admin peer authorization** — Any authenticated admin can modify or delete any other admin account with no self-protection check.

The application demonstrates strong positive security practices in its JSON API layer (Zod validation, parameterized ORM queries, per-request DB revocation check, httpOnly/Secure/SameSite:strict cookies), but these controls are bypassed by the static file serving architecture.

---

## 2. Technology & Service Map

- **Frontend:** React 18.3.1, Vite 7.3.0, Wouter 3.3.5 (routing), TanStack React Query 5.60.5, shadcn/ui (Radix primitives), Tailwind CSS, Zod 3.24.2
- **Backend:** TypeScript 5.6.3 (strict mode), Express.js 5.0.1, bcryptjs 3.0.3 (bcrypt cost-12), jsonwebtoken 9.0.3, Drizzle ORM 0.39.3 (pg driver), Zod 3.24.2, drizzle-zod, Resend SDK 6.10.0, archiver (ZIP streaming), child_process.execFile (ffmpeg/ffprobe)
- **Infrastructure:** Replit Autoscale (no nginx, no Docker); PostgreSQL 16 (local); TLS terminated by Replit proxy; ffmpeg/ffprobe system binaries; ngrok tunnel for external access (`PORTAL_URL=https://piratic-cory-internally.ngrok-free.dev`)
- **Identified Subdomains:** None — single-origin application; `host.docker.internal:3000` (target); ngrok tunnel URL referenced in system-info endpoint
- **Open Ports & Services:** Port 3000 (Express HTTP server, primary target); Port 5432 (PostgreSQL, internal only)
- **Dead Code / Unused Dependencies:** `passport`, `passport-local`, `openid-client`, `connect-pg-simple`, `express-session`, `memorystore` — installed but never initialized in production code path

**Confirmed Response Headers (live):**
```
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
X-XSS-Protection: 1; mode=block
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; frame-src 'self' https://*.ts.net; connect-src 'self' https://*.ts.net; font-src 'self' data:;
```

---

## 3. Authentication & Session Management Flow

### Entry Points (Confirmed Live)
- `POST /api/admin/login` — Admin credential authentication
- `POST /api/client/login` — Client portal credential authentication
- `POST /api/client/forgot-password` — Password reset initiation (returns same response regardless of email existence)
- `POST /api/client/reset-password` — Token-based password reset execution
- `GET /api/login` → Returns SPA HTML (OIDC not initialized; Passport never called)
- `GET /api/callback` → Returns SPA HTML (dead code)
- `GET /api/logout` → Returns SPA HTML (dead code)

### Mechanism
1. Client/Admin submits `{email, senha}` via POST to respective login endpoint
2. Rate limiter checked (5 attempts / 15 min per IP, shared in-memory Map, lost on restart)
3. Account looked up from DB (`adminAccounts` or `clientAccounts` table respectively)
4. For clients: `status === "ativo"` verified before password check
5. `bcrypt.compare(senha, senhaHash)` with cost-12
6. On success: `jwt.sign({ adminAccountId/clientAccountId }, SECRET, { expiresIn: "24h" })` (HS256)
7. JWT set as httpOnly cookie (`skylapse-admin-token` or `skylapse-client-token`)
8. Rate limit counter reset on successful login

**On every subsequent authenticated request:**
- JWT extracted from cookie, verified against derived secret
- **Live DB query** performed to verify account still exists (admin) or exists and is `"ativo"` (client)
- `req.adminAccountId` or `req.clientAccountId` set

### Code Pointers
- JWT secret derivation: `server/routes.ts:32-33`
- Rate limiter: `server/routes.ts:36-62`
- `isAdminAuthenticated` middleware: `server/routes.ts:64-82`
- `isClientAuthenticated` middleware: `server/routes.ts:84-102`
- `isAnyAuthenticated` middleware: `server/routes.ts:105-132`
- Admin login handler: `server/routes.ts:903-947`
- Client login handler: `server/routes.ts:846-892`
- Cookie configuration: `server/routes.ts:883-888` (client), `935-940` (admin)
- PASSWORD RESET: `server/routes.ts:1263-1314`
- Initial admin seed: `server/index.ts:102-120`

### 3.1 Role Assignment Process
- **Role Determination:** Entirely structural — which DB table the account lives in determines the role. No `role` column exists in either `adminAccounts` or `clientAccounts`. The JWT secret used for signing (`_admin` vs `_client` suffix) is how the middleware differentiates roles.
- **Default Role:** New accounts created via `POST /api/admin/client-accounts` get `clientAccounts` entry. Only admins can create both admin and client accounts.
- **Role Upgrade Path:** No self-service upgrade. Only admin-initiated. `POST /api/admin/accounts` creates admin accounts (requires existing admin).
- **Code Implementation:** `server/routes.ts:979-996` (admin creation), `server/routes.ts:755-793` (client account creation)

### 3.2 Privilege Storage & Validation
- **Storage Location:** JWT payload contains only `{ adminAccountId: "<uuid>" }` or `{ clientAccountId: "<uuid>" }`. No role claim. Role is implicit from which cookie/secret is used.
- **Validation Points:** All `/api/admin/*` routes use `isAdminAuthenticated` middleware; all `/api/client/*` routes use `isClientAuthenticated`; static file routes use `isAnyAuthenticated`.
- **Cache/Session Persistence:** 24-hour JWT. No server-side session store. Per-request DB verification compensates for lack of revocation.
- **Code Pointers:** `server/routes.ts:64-132` (all three middleware implementations)

### 3.3 Role Switching & Impersonation
- **Impersonation Features:** None implemented.
- **Role Switching:** No temporary elevation mechanisms.
- **Audit Trail:** Login/logout/password-change events are logged via `server/audit.ts`. Logout endpoints lack auth middleware — audit logs `adminAccountId: undefined` for unauthenticated logout calls.
- **JWT Secret Weakness:** `CLIENT_JWT_SECRET = SESSION_SECRET + "_client"`, `ADMIN_JWT_SECRET = SESSION_SECRET + "_admin"`. Simple string concatenation — knowledge of base secret yields both derived secrets. In development, base secret defaults to the hardcoded literal `"skylapse-dev-secret-insecure"`.

---

## 4. API Endpoint Inventory

**Network Surface Focus:** Only network-accessible endpoints served by the Express.js application.

| Method | Endpoint Path | Required Role | Object ID Parameters | Authorization Mechanism | Description & Code Pointer |
|--------|--------------|---------------|---------------------|------------------------|---------------------------|
| POST | `/api/admin/login` | anon | None | None (rate-limited: 5/15min/IP) | Admin credential login → sets `skylapse-admin-token` cookie. `server/routes.ts:903` |
| POST | `/api/admin/logout` | anon | None | None (no auth middleware) | Clears admin cookie. Audit log records `undefined` accountId. `server/routes.ts:948` |
| POST | `/api/client/login` | anon | None | None (rate-limited: 5/15min/IP) | Client credential login → sets `skylapse-client-token` cookie. `server/routes.ts:846` |
| POST | `/api/client/logout` | anon | None | None (no auth middleware) | Clears client cookie. Audit log records `undefined` accountId. `server/routes.ts:1202` |
| POST | `/api/client/forgot-password` | anon | None | None (rate-limited) | Password reset email initiation. Always returns same response. `server/routes.ts:1264` |
| POST | `/api/client/reset-password` | anon | None | None (rate-limited) | Execute password reset with 64-char hex token + new password. Token has 1-hour TTL. `server/routes.ts:1290` |
| GET | `/api/login` | anon | None | None | Legacy Replit OIDC (dead — returns SPA HTML). `server/replit_integrations/auth/replitAuth.ts:105` |
| GET | `/api/callback` | anon | None | None | Legacy Replit OIDC callback (dead). `server/replit_integrations/auth/replitAuth.ts:113` |
| GET | `/api/logout` | anon | None | None | Legacy Replit OIDC logout (dead). `server/replit_integrations/auth/replitAuth.ts:121` |
| GET | `/api/admin/me` | admin | None | `isAdminAuthenticated` | Returns `{id, nome, email}` of current admin. `server/routes.ts:954` |
| GET | `/api/admin/dashboard-extra` | admin | None | `isAdminAuthenticated` | Activity chart data + disk usage (walks `uploads/captures`). `server/routes.ts:167` |
| GET | `/api/admin/system-info` | admin | None | `isAdminAuthenticated` | Returns `portalUrl` and all cameras with hostnames. **Info disclosure**. `server/routes.ts:195` |
| GET | `/api/admin/stats` | admin | None | `isAdminAuthenticated` | Aggregate stats (counts of clients, cameras, captures). `server/routes.ts:215` |
| GET | `/api/admin/accounts` | admin | None | `isAdminAuthenticated` | Lists all admin accounts. `server/routes.ts:969` |
| POST | `/api/admin/accounts` | admin | None | `isAdminAuthenticated` | Creates admin account. Any admin can create more admins. `server/routes.ts:979` |
| PUT | `/api/admin/accounts/:id` | admin | `id` (admin account) | `isAdminAuthenticated` (no peer check) | Updates any admin's name/email/password. **Horizontal escalation: any admin can takeover any other admin**. `server/routes.ts:998` |
| DELETE | `/api/admin/accounts/:id` | admin | `id` (admin account) | `isAdminAuthenticated` + last-admin guard | Deletes admin account. Guards only against deleting the last admin. `server/routes.ts:1024` |
| GET | `/api/admin/clients` | admin | None | `isAdminAuthenticated` | Lists all clients (no pagination). `server/routes.ts:226` |
| GET | `/api/admin/clients/:id` | admin | `id` (client) | `isAdminAuthenticated` | Gets single client. `server/routes.ts:236` |
| POST | `/api/admin/clients` | admin | None | `isAdminAuthenticated` | Creates client. `server/routes.ts:249` |
| PUT | `/api/admin/clients/:id` | admin | `id` (client) | `isAdminAuthenticated` | Updates client. `server/routes.ts:263` |
| DELETE | `/api/admin/clients/:id` | admin | `id` (client) | `isAdminAuthenticated` | Deletes client. `server/routes.ts:280` |
| GET | `/api/admin/locations` | admin | None | `isAdminAuthenticated` | Lists all locations. `server/routes.ts:294` |
| GET | `/api/admin/locations/:id` | admin | `id` (location) | `isAdminAuthenticated` | Gets single location. `server/routes.ts:304` |
| POST | `/api/admin/locations` | admin | None | `isAdminAuthenticated` | Creates location. `server/routes.ts:317` |
| PUT | `/api/admin/locations/:id` | admin | `id` (location) | `isAdminAuthenticated` | Updates location. `server/routes.ts:331` |
| DELETE | `/api/admin/locations/:id` | admin | `id` (location) | `isAdminAuthenticated` | Deletes location. `server/routes.ts:348` |
| GET | `/api/admin/cameras` | admin | None | `isAdminAuthenticated` | Lists cameras — credentials stripped via `stripCameraCredentials()`. `server/routes.ts:362` |
| GET | `/api/admin/cameras/offline` | admin | None | `isAdminAuthenticated` | Lists offline cameras — credentials stripped. `server/routes.ts:372` |
| GET | `/api/admin/cameras/:id` | admin | `id` (camera UUID) | `isAdminAuthenticated` | Gets full camera object **including plaintext credentials** (hostname, usuario, senha, portaHttp, portaRtsp). `server/routes.ts:382` |
| GET | `/api/admin/cameras/:id/last-capture` | admin | `id` (camera UUID) | `isAdminAuthenticated` | Most recent capture record. `server/routes.ts:395` |
| GET | `/api/admin/cameras/:id/captures` | admin | `id` (camera UUID) | `isAdminAuthenticated` | Paginated captures. Query: `dataInicio`, `dataFim`, `page`, `limit` (max 500). Date validated via `isValidDate()`. `server/routes.ts:408` |
| GET | `/api/admin/cameras/:id/captures/download` | admin | `id` (camera UUID) | `isAdminAuthenticated` | Streams ZIP archive of captures for date range. `server/routes.ts:428` |
| DELETE | `/api/admin/captures/:id` | admin | `id` (capture UUID) | `isAdminAuthenticated` + `isPathSafe()` | Deletes capture record + file. `server/routes.ts:472` |
| GET | `/api/admin/cameras/:id/thumbnail` | admin | `id` (camera UUID) | `isAdminAuthenticated` + `isPathSafe()` | Serves last capture JPEG. ETag/304 supported. `server/routes.ts:553` |
| GET | `/api/admin/cameras/:id/snapshot` | admin | `id` (camera UUID) | `isAdminAuthenticated` | **SSRF:** Live fetch from camera's stored URL (no `isSafeTarget()` here). `server/routes.ts:580` |
| POST | `/api/admin/cameras` | admin | None | `isAdminAuthenticated` | Creates camera with hostname/streamUrl. **Stored SSRF: no URL validation at creation time**. `server/routes.ts:492` |
| POST | `/api/admin/cameras/test` | admin | None | `isAdminAuthenticated` + `isSafeTarget()` | Tests camera connectivity. SSRF check applied (weakly). Returns response body as base64. `server/routes.ts:507` |
| PUT | `/api/admin/cameras/:id` | admin | `id` (camera UUID) | `isAdminAuthenticated` | Updates camera. **Stored SSRF: no URL validation**. `server/routes.ts:611` |
| DELETE | `/api/admin/cameras/:id` | admin | `id` (camera UUID) | `isAdminAuthenticated` | Deletes camera. `server/routes.ts:628` |
| GET | `/api/admin/timelapses` | admin | None | `isAdminAuthenticated` | Lists all timelapses. `server/routes.ts:643` |
| GET | `/api/admin/timelapses/recent` | admin | None | `isAdminAuthenticated` | Lists 5 most recent timelapses. `server/routes.ts:653` |
| GET | `/api/admin/timelapses/:id` | admin | `id` (timelapse UUID) | `isAdminAuthenticated` | Gets single timelapse. `server/routes.ts:663` |
| POST | `/api/admin/timelapses` | admin | None | `isAdminAuthenticated` | Creates timelapse job. `fps` field has no range constraint → flows to ffmpeg. `server/routes.ts:676` |
| DELETE | `/api/admin/timelapses/:id` | admin | `id` (timelapse UUID) | `isAdminAuthenticated` + `isPathSafe()` | Deletes timelapse + video file. `server/routes.ts:694` |
| GET | `/api/admin/client-accounts` | admin | None | `isAdminAuthenticated` | Lists all client portal accounts (safe DTO, no passwords). `server/routes.ts:734` |
| GET | `/api/admin/client-accounts/:id` | admin | `id` (client account UUID) | `isAdminAuthenticated` | Gets single client account (safe DTO). `server/routes.ts:744` |
| POST | `/api/admin/client-accounts` | admin | None | `isAdminAuthenticated` | Creates client account. **Sends plaintext initial password in welcome email via Resend**. `server/routes.ts:755` |
| PUT | `/api/admin/client-accounts/:id` | admin | `id` (client account UUID) | `isAdminAuthenticated` | Updates client account (name, email, password, camera access). `server/routes.ts:795` |
| DELETE | `/api/admin/client-accounts/:id` | admin | `id` (client account UUID) | `isAdminAuthenticated` | Deletes client account. `server/routes.ts:833` |
| GET | `/api/client/me` | client | None | `isClientAuthenticated` | Returns current client profile including `cameraIds`. `server/routes.ts:1208` |
| GET | `/api/client/cameras` | client | None | `isClientAuthenticated` | Lists cameras client can access. DTO strips credentials. `server/routes.ts:1058` |
| GET | `/api/client/cameras/:id/captures` | client | `id` (camera UUID) | `isClientAuthenticated` + `allowedIds` check | Paginated captures. **No `isValidDate()` on `dataInicio`/`dataFim` query params**. `server/routes.ts:1073` |
| GET | `/api/client/cameras/:id/captures/download` | client | `id` (camera UUID) | `isClientAuthenticated` + `allowedIds` check | ZIP download. **No date format validation**. `server/routes.ts:1094` |
| GET | `/api/client/cameras/:id/thumbnail` | client | `id` (camera UUID) | `isClientAuthenticated` + `allowedIds` check + `isPathSafe()` | Serves last capture thumbnail. `server/routes.ts:1143` |
| GET | `/api/client/cameras/:id/snapshot` | client | `id` (camera UUID) | `isClientAuthenticated` + `allowedIds` check | **SSRF:** Live fetch from camera's stored URL. No SSRF guard here. `server/routes.ts:1173` |
| POST | `/api/client/change-password` | client | None | `isClientAuthenticated` | Changes password with current password verification. **Not rate-limited**. `server/routes.ts:1235` |
| GET | `/api/captures/*` | admin OR client | path contains cameraId + filename | `isAnyAuthenticated` ONLY — **NO camera ownership check** | **IDOR**: Serves capture images from `uploads/captures/`. Any auth'd user accesses any camera. `server/routes.ts:163` |
| GET | `/api/videos/*` | admin OR client | path contains cameraId + filename | `isAnyAuthenticated` ONLY — **NO camera ownership check** | **IDOR**: Serves timelapse videos from `uploads/videos/`. Any auth'd user accesses any camera. `server/routes.ts:164` |

---

## 5. Potential Input Vectors for Vulnerability Analysis

**Network Surface Focus:** All vectors below are reachable via HTTP to `http://host.docker.internal:3000`.

### URL Parameters (Query String)
- `GET /api/admin/cameras/:id/captures` — `dataInicio` (date string, validated by `isValidDate()`), `dataFim`, `page` (parseInt), `limit` (parseInt, max 500). `server/routes.ts:411-419`
- `GET /api/admin/cameras/:id/captures/download` — `dataInicio`, `dataFim` (required, validated). `server/routes.ts:430-438`
- `GET /api/client/cameras/:id/captures` — `dataInicio`, `dataFim` (**NOT validated** — no `isValidDate()` call), `page`, `limit`. `server/routes.ts:1073-1092`
- `GET /api/client/cameras/:id/captures/download` — `dataInicio`, `dataFim` (**NOT validated**). `server/routes.ts:1094-1141`
- `GET /api/captures/*` — Full URL path component after `/api/captures/` controls which file is served by `express.static`. Path traversal guarded by Express static middleware. `server/routes.ts:163`
- `GET /api/videos/*` — Same as captures. `server/routes.ts:164`

### POST Body Fields (JSON)

**Authentication Endpoints:**
- `POST /api/admin/login` — `email` (z.string().email()), `senha` (z.string().min(1)). `server/routes.ts:905-910`
- `POST /api/client/login` — `email` (z.string().email()), `senha` (z.string().min(1)). `server/routes.ts:848-853`
- `POST /api/client/forgot-password` — `email` (z.string().email()). `server/routes.ts:1265-1270`
- `POST /api/client/reset-password` — `token` (z.string().min(1)), `novaSenha` (z.string().min(8)). `server/routes.ts:1292-1299`
- `POST /api/client/change-password` — `senhaAtual` (z.string().min(1)), `novaSenha` (z.string().min(8)). `server/routes.ts:1237-1242`

**Camera Management (Admin — Critical SSRF Surface):**
- `POST /api/admin/cameras` — `hostname` (**z.string() only, no URL validation, no blocklist**), `streamUrl` (**z.string() only, no URL validation**), `portaHttp` (z.number().int()), `portaRtsp` (z.number().int()), `usuario`, `senha`, `marca`, `nome`, `clienteId`, `localizacaoId`, `intervaloCaptura`, `status`. Schema: `insertCameraSchema` from `shared/schema.ts`. `server/routes.ts:492-505`
- `PUT /api/admin/cameras/:id` — Same fields as camera creation (partial). `server/routes.ts:611-626`
- `POST /api/admin/cameras/test` — `streamUrl` (tested with `isSafeTarget()` — weak blocklist), `hostname`, `usuario`, `senha`, `marca`, `portaHttp`. `server/routes.ts:507-550`

**Timelapse Management (Admin — ffmpeg Surface):**
- `POST /api/admin/timelapses` — `cameraId`, `dataInicio`, `dataFim`, `fps` (**z.number().int() only, no range 1-60 enforcement** — flows to ffmpeg `-vf fps=N` argument). `server/routes.ts:676-692`; ffmpeg sink at `server/timelapse-job.ts:107`

**Client Account Management (Admin):**
- `POST /api/admin/client-accounts` — `nome`, `email`, `senha` (min 8), `clienteId`, `cameraIds` (array of UUIDs). `server/routes.ts:755-793`; `insertClientAccountSchema` from `shared/schema.ts`
- `PUT /api/admin/client-accounts/:id` — Same fields partial; `cameraIds` replaces access list. `server/routes.ts:795-831`

**Admin Account Management:**
- `POST /api/admin/accounts` — `nome`, `email`, `senha` (min 8). `insertAdminAccountSchema`. `server/routes.ts:979-996`
- `PUT /api/admin/accounts/:id` — `nome?`, `email?`, `senha?` (min 8). Inline Zod. `server/routes.ts:998-1022`

**Location & Client Management:**
- `POST /api/admin/locations` — `nome`, `cidade`, `estado`, `pais`. `insertLocationSchema`. `server/routes.ts:317`
- `POST /api/admin/clients` — `nome`, `email`. `insertClientSchema`. `server/routes.ts:249`

### HTTP Headers
- **Cookie: skylapse-admin-token** — JWT token parsed and verified by `isAdminAuthenticated`. Forged tokens (using known or derived secret) would bypass auth. `server/routes.ts:66-70`
- **Cookie: skylapse-client-token** — JWT token parsed and verified by `isClientAuthenticated`. `server/routes.ts:86-90`
- **X-Powered-By: Express** — Present in responses (confirms framework/version leak, though minor)
- **Host header** — Used in legacy OIDC code (`req.hostname`) to build callback URLs and select Passport strategies. Dead code but notable if OIDC is ever re-enabled.

### Cookie Values
- `skylapse-admin-token` — httpOnly, Secure (prod), SameSite:strict, 24h TTL. JWT payload: `{adminAccountId: uuid}`. `server/routes.ts:935-940`
- `skylapse-client-token` — httpOnly, Secure (prod), SameSite:strict, 24h TTL. JWT payload: `{clientAccountId: uuid}`. `server/routes.ts:883-888`

### URL Path Parameters
- `:id` in all `/api/admin/cameras/:id/*` — Camera UUID, used in DB queries and file paths. No client ownership check at admin level.
- `:id` in all `/api/client/cameras/:id/*` — Camera UUID, validated against `allowedIds` before use.
- `:id` in `/api/admin/accounts/:id` — Admin account UUID. No peer ownership check — any admin modifies any account.
- `:id` in `/api/admin/client-accounts/:id` — Client account UUID. No ownership check.
- URL path after `/api/captures/` — File path passed to `express.static`. The path structure is `{cameraId}/{date}/{filename}`.
- URL path after `/api/videos/` — File path passed to `express.static`. Structure: `{cameraId}/{filename}`.

---

## 6. Network & Interaction Map

### 6.1 Entities

| Title | Type | Zone | Tech | Data | Notes |
|-------|------|------|------|------|-------|
| ClientBrowser | ExternAsset | Internet | React 18 SPA / Wouter | Public | Public-facing; admin and client user agents |
| SkyLapseApp | Service | App | Node.js/Express 5.0.1, TypeScript 5.6.3 | PII, Tokens, Secrets | Monolith: serves SPA + REST API + static files; port 3000 |
| PostgreSQLDB | DataStore | Data | PostgreSQL 16 (pg driver) | PII, Tokens, Secrets | Stores all application data; no SSL enforcement; connection string in .env |
| UploadsDir | DataStore | App | Filesystem (`uploads/`) | Public (images/video) | `uploads/captures/{cameraId}/{date}/` and `uploads/videos/{cameraId}/`; served via express.static |
| IPCameras | ThirdParty | Internet | Various (Hikvision, Dahua, etc.) | Public (images) | User-configured external cameras; fetched every 60s by capture job |
| ResendEmailAPI | ThirdParty | ThirdParty | Resend SDK / HTTPS | PII, Secrets | Sends welcome emails containing plaintext initial passwords; transactional email |
| FFmpegBinary | Service | App | ffmpeg/ffprobe system binaries | Public | Invoked via child_process.execFile; processes stored file paths |
| NgrokTunnel | ExternAsset | Internet | ngrok | Public | External tunnel URL (`PORTAL_URL`); exposed via `/api/admin/system-info` |

### 6.2 Entity Metadata

| Title | Metadata Key: Value |
|-------|---------------------|
| SkyLapseApp | Hosts: `http://host.docker.internal:3000`; Endpoints: `/api/admin/*` (48), `/api/client/*` (7), `/api/captures/*`, `/api/videos/*`; Auth: `skylapse-admin-token` / `skylapse-client-token` JWT cookies (HS256, 24h); JWT Secrets: `SESSION_SECRET+"_admin"` / `SESSION_SECRET+"_client"`; Rate Limit: 5 req/15min/IP (in-memory, shared for login+reset); Body Limit: 100kb JSON |
| PostgreSQLDB | Engine: PostgreSQL 16; ConnectionString: `DATABASE_URL` env var; SSL: Not enforced; Consumers: SkyLapseApp only; Tables: `adminAccounts`, `clientAccounts`, `clients`, `locations`, `cameras`, `captures`, `timelapses`, `clientCameraAccess` |
| UploadsDir | Path: `uploads/captures/{cameraId}/{YYYY-MM-DD}/`, `uploads/videos/{cameraId}/`; Served: `/api/captures/**`, `/api/videos/**` via express.static; Auth: `isAnyAuthenticated` (no per-camera ACL) |
| IPCameras | Protocol: HTTP (outbound from server); Credentials: plaintext in DB (`usuario`/`senha`); URL Construction: `http://{hostname}:{portaHttp}/...` or direct `streamUrl`; Fetch Interval: 60 seconds; SSRF Guard: None at fetch time |
| ResendEmailAPI | Endpoint: `api.resend.com` (HTTPS); API Key: `RESEND_API_KEY` env var; Concern: Plaintext initial passwords sent in email body (`server/email-service.ts:201`) |
| FFmpegBinary | Invocation: `execFileAsync("ffmpeg", args)`; Key flags: `-safe 0` (allows absolute paths), `-vf fps={fps}`; Input: concat list file with DB-sourced paths; Output: `uploads/videos/{cameraId}/{timelapseId}.mp4` |

### 6.3 Flows (Connections)

| FROM → TO | Channel | Path/Port | Guards | Touches |
|-----------|---------|-----------|--------|---------|
| ClientBrowser → SkyLapseApp | HTTP | `:3000 /api/admin/login` | None; rate-limit:5/15min | Public |
| ClientBrowser → SkyLapseApp | HTTP | `:3000 /api/client/login` | None; rate-limit:5/15min | Public |
| ClientBrowser → SkyLapseApp | HTTP | `:3000 /api/client/forgot-password` | None; rate-limit:5/15min | PII (email) |
| ClientBrowser → SkyLapseApp | HTTP | `:3000 /api/client/reset-password` | None; rate-limit:5/15min | Tokens |
| ClientBrowser → SkyLapseApp | HTTP | `:3000 /api/admin/*` | auth:admin (JWT cookie) | PII, Tokens, Secrets |
| ClientBrowser → SkyLapseApp | HTTP | `:3000 /api/client/*` | auth:client (JWT cookie) | PII |
| ClientBrowser → SkyLapseApp | HTTP | `:3000 /api/captures/*` | auth:any (no ownership) | Public (images) |
| ClientBrowser → SkyLapseApp | HTTP | `:3000 /api/videos/*` | auth:any (no ownership) | Public (video) |
| SkyLapseApp → PostgreSQLDB | TCP | `:5432` | app-internal; no-ssl | PII, Tokens, Secrets |
| SkyLapseApp → IPCameras | HTTP | Variable ports | none (no isSafeTarget at fetch) | Public (images) |
| SkyLapseApp → ResendEmailAPI | HTTPS | `api.resend.com:443` | api-key | PII, Secrets |
| SkyLapseApp → FFmpegBinary | Process | internal execFile | app-internal | Public |
| SkyLapseApp → UploadsDir | File | filesystem | app-internal + isPathSafe() | Public (images/video) |

### 6.4 Guards Directory

| Guard Name | Category | Statement |
|------------|----------|-----------|
| auth:admin | Auth | Requires valid `skylapse-admin-token` cookie (HS256 JWT, `SESSION_SECRET+"_admin"` secret). Performs live DB lookup of adminAccounts on every request. Implemented at `server/routes.ts:64-82`. |
| auth:client | Auth | Requires valid `skylapse-client-token` cookie (HS256 JWT, `SESSION_SECRET+"_client"` secret). Performs live DB lookup; requires `status === "ativo"`. Implemented at `server/routes.ts:84-102`. |
| auth:any | Auth | Accepts either admin or client token. No ownership enforcement. Implemented at `server/routes.ts:105-132`. Used only for static file routes. |
| rate-limit:5/15min | RateLimit | In-memory IP-based rate limiter. 5 attempts per 15-minute window. Shared pool across login+reset endpoints. Resets on success. Not applied to `change-password`. `server/routes.ts:36-62`. |
| ownership:camera | ObjectOwnership | Client-specific: verifies `req.params.id` is in `getClientCameraIds(clientAccountId)` before serving camera data. Applied to all `/api/client/cameras/:id/*` JSON endpoints. NOT applied to `/api/captures/*` or `/api/videos/*`. `server/routes.ts:1075-1077`. |
| isPathSafe | Authorization | Resolves file path and verifies it starts with `UPLOADS_DIR` (`uploads/`). Applied to thumbnail, capture delete, and timelapse delete. `server/routes.ts:151-154`. |
| isSafeTarget | Authorization | Blocklist-based SSRF check. Only blocks: `169.254.169.254`, `metadata.google.internal`, `metadata.internal`. Applied ONLY to `POST /api/admin/cameras/test`. NOT applied to actual camera fetch operations. `server/camera-service.ts:9-29`. |
| last-admin-guard | Authorization | Prevents deletion of the last admin account. `server/routes.ts:1027`. |
| no-guard | Authorization | Static file routes (`/api/captures/*`, `/api/videos/*`) — only `auth:any` applied, no camera ownership check. |

---

## 7. Role & Privilege Architecture

### 7.1 Discovered Roles

| Role Name | Privilege Level | Scope/Domain | Code Implementation |
|-----------|----------------|--------------|---------------------|
| anon | 0 | Global | No cookie required. Access to login, logout, password reset endpoints only. |
| client | 1 | Camera-list | Authenticated via `skylapse-client-token`. `isClientAuthenticated` middleware. Access scoped to `clientCameraAccess` junction table entries. `server/routes.ts:84-102`. |
| admin | 5 | Global | Authenticated via `skylapse-admin-token`. `isAdminAuthenticated` middleware. Full CRUD on all resources. `server/routes.ts:64-82`. |

No sub-roles, no permissions bits, no role column in any table. The distinction is purely structural (which DB table + which JWT secret).

### 7.2 Privilege Lattice

```
Privilege Ordering (→ means "can access resources of"):
anon → client → admin

Domain Isolation:
- Client access is scoped by clientCameraAccess junction table (camera-level ACL)
- All admins are peers — no super-admin or least-privilege differentiation
- Admin can CREATE clients and other admins (no approval gate)

Role Switching: None implemented.
Impersonation: None implemented.
JWT Secret Hierarchy:
  SESSION_SECRET (base)
  ├── SESSION_SECRET + "_admin" → ADMIN_JWT_SECRET
  └── SESSION_SECRET + "_client" → CLIENT_JWT_SECRET
```

### 7.3 Role Entry Points

| Role | Default Landing Page | Accessible Route Patterns | Authentication Method |
|------|---------------------|--------------------------|----------------------|
| anon | `/` (SPA login form) | `/`, `/api/client/login`, `/api/admin/login`, `/api/client/forgot-password`, `/api/client/reset-password` | None |
| client | `/` (redirect to client dashboard) | `/api/client/*`, `/api/captures/*`, `/api/videos/*` | `skylapse-client-token` JWT cookie |
| admin | `/` (redirect to admin dashboard) | `/api/admin/*`, `/api/captures/*`, `/api/videos/*` | `skylapse-admin-token` JWT cookie |

### 7.4 Role-to-Code Mapping

| Role | Middleware/Guards | Permission Checks | Storage Location |
|------|------------------|------------------|-----------------|
| anon | None | None | N/A |
| client | `isClientAuthenticated` (routes.ts:84-102) | `allowedIds.includes(req.params.id)` for camera-scoped routes (routes.ts:1075,1097,1146,1176); `status === "ativo"` check | `skylapse-client-token` httpOnly cookie; JWT payload: `{clientAccountId}` |
| admin | `isAdminAuthenticated` (routes.ts:64-82) | Account existence in `adminAccounts` table | `skylapse-admin-token` httpOnly cookie; JWT payload: `{adminAccountId}` |

---

## 8. Authorization Vulnerability Candidates

### 8.1 Horizontal Privilege Escalation Candidates

| Priority | Endpoint Pattern | Object ID Parameter | Data Type | Sensitivity |
|----------|-----------------|---------------------|-----------|-------------|
| **High** | `GET /api/captures/{cameraId}/{date}/{filename}` | cameraId (path component) | camera images | Any authenticated client accesses any camera's capture images without ownership check |
| **High** | `GET /api/videos/{cameraId}/{filename}` | cameraId (path component) | timelapse video | Any authenticated client accesses any camera's videos without ownership check |
| **High** | `PUT /api/admin/accounts/:id` | id (admin account UUID) | admin credentials | Any admin updates any other admin's email/password → account takeover |
| **High** | `DELETE /api/admin/accounts/:id` | id (admin account UUID) | admin account | Any admin deletes any other admin account (except last) |
| **Medium** | `GET /api/admin/cameras/:id` | id (camera UUID) | camera credentials (plaintext hostname, usuario, senha) | Admin can view credentials for any camera; all admins are peers |
| **Medium** | `PUT /api/admin/client-accounts/:id` | id (client account UUID) | client account data | Any admin modifies any client's account including password and camera access list |
| **Low** | `DELETE /api/admin/client-accounts/:id` | id (client account UUID) | client account | Any admin deletes any client account |

### 8.2 Vertical Privilege Escalation Candidates

| Target Role | Endpoint Pattern | Functionality | Risk Level |
|-------------|-----------------|---------------|------------|
| admin | `POST /api/admin/accounts` | Any current admin creates new admin accounts without approval gate | High |
| admin | `PUT /api/admin/accounts/:id` | Escalate privileges by taking over existing admin account | High |
| admin | `/api/admin/*` (all) | Full admin panel access — requires compromising admin JWT secret or token | High |
| admin | `GET /api/admin/system-info` | Information disclosure: camera hostnames, ngrok PORTAL_URL | Medium |
| admin | `GET /api/admin/cameras/:id` | Retrieves plaintext camera credentials (usuario, senha) | Medium |
| admin | `POST /api/admin/cameras/test` | SSRF probe with partial response return — admin-only but tests isSafeTarget bypass | High |
| admin | `POST /api/admin/cameras` / `PUT /api/admin/cameras/:id` | Stored SSRF — plant malicious hostname/streamUrl that server fetches persistently | High |

**Note:** There is no direct client→admin escalation path via the API. The JWT secrets differ and accounts are in separate tables.

### 8.3 Context-Based Authorization Candidates

| Workflow | Endpoint | Expected Prior State | Bypass Potential |
|----------|----------|---------------------|-----------------|
| Password Reset | `POST /api/client/reset-password` | Token sent via email (forgot-password called first) | Direct submission of guessed/leaked token bypasses email step |
| Camera Snapshot (Client) | `GET /api/client/cameras/:id/snapshot` | Client must have camera in allowedIds list | SSRF via stored hostname — client triggers server fetch of admin-configured URL |
| Timelapse Creation | `POST /api/admin/timelapses` → background job | Captures must exist in date range for ffmpeg processing | Submit timelapse with `fps` outside normal range (no validation) |
| Capture ZIP Download | `GET /api/client/cameras/:id/captures/download` | Valid `dataInicio`/`dataFim` dates | Submit malformed date strings — no `isValidDate()` validation on client route |
| Media File Access | `GET /api/captures/*` | Client should only access their permitted cameras | Direct URL construction bypasses JSON API ACL entirely |

---

## 9. Injection Sources

### Command Injection Sources

**Finding CI-1: `fps` field → ffmpeg `-vf` filter argument (No Range Validation)**
- **Input:** `fps` field in `POST /api/admin/timelapses` body
- **Validation:** `z.number().int()` only — no minimum (1) or maximum (60) constraint
- **Data Flow:** `POST /api/admin/timelapses` (`server/routes.ts:676`) → `insertTimelapseSchema.parse(req.body)` → stored in `timelapses.fps` DB column → `checkQueue()` reads back → `processTimelapse()` (`server/timelapse-job.ts:26`) → `execFileAsync("ffmpeg", ["-vf", `fps=${fps},scale=...`])` (`server/timelapse-job.ts:107`)
- **Dangerous Sink:** `server/timelapse-job.ts:107`
- **Exploitation Notes:** `execFile` (not `exec`) is used — shell metacharacters are NOT interpreted. No shell injection possible. However, extreme values (negative, zero, very large integers) could cause ffmpeg resource exhaustion or error. Indirect attack surface.

**Finding CI-2: `imagemPath` values → ffmpeg concat list file (String Interpolation)**
- **Input:** `captures.imagemPath` values from DB (server-generated, but if DB manipulation occurs)
- **Data Flow:** `timelapse-job.ts:89` → `validCaptures.map(c => "file '${path.resolve(c.imagemPath!)}'")` → written to concat list file → passed to ffmpeg with `-safe 0` flag
- **Dangerous Sink:** `server/timelapse-job.ts:89-93` (string interpolation into file), then ffmpeg reads file at line 102-116
- **Exploitation Notes:** Single-quote in `imagemPath` would corrupt the ffmpeg concat format. Requires DB write access to `captures.imagemPath`. The `-safe 0` ffmpeg flag enables reading absolute paths anywhere on filesystem.

### SQL Injection Sources

**Finding SQL-1: No traditional SQL injection found**
- All DB operations in `server/storage.ts` use Drizzle ORM parameterized helpers (`eq()`, `gte()`, `lte()`, `inArray()`, `.values()`)
- No string concatenation into SQL queries was found
- Raw `db.execute(sql\`...\`)` at `storage.ts:450-458` uses no user input
- **Assessment:** The application is not vulnerable to SQL injection via the ORM layer

**Finding SQL-2: Unvalidated date parameters on client routes (Logic/ORM behavior issue)**
- **Input:** `dataInicio` and `dataFim` query params on `GET /api/client/cameras/:id/captures` and `GET /api/client/cameras/:id/captures/download`
- **Validation Gap:** No `isValidDate()` call (admin equivalents at `routes.ts:411-419` do validate)
- **Data Flow:** `req.query.dataInicio` → `storage.getCaptures(id, dataInicio, ...)` (`routes.ts:1079`) → `new Date(dataInicio)` (`storage.ts:194`) → ORM `gte()` query parameter
- **Dangerous Sink:** `server/storage.ts:194,219` — malformed dates produce `Invalid Date` objects passed to ORM
- **Impact:** Not traditional SQL injection (ORM parameterization still applies), but could cause unexpected query behavior or errors

### Path Traversal / LFI Sources

**Finding PT-1: Static file serving path traversal (Express.static)**
- **Input:** URL path after `/api/captures/` or `/api/videos/`
- **Data Flow:** `GET /api/captures/{attacker-controlled-path}` → `express.static("uploads/captures")` middleware
- **Dangerous Sink:** `server/routes.ts:163-164` — `express.static()` processes the path
- **Mitigation:** Express.static has built-in path traversal protection (normalizes `../` sequences). Practical exploitability low, but surface exists.

**Finding PT-2: Thumbnail and delete operations on DB-sourced paths**
- **Input:** `capture.imagemPath` from DB (indirect — requires DB corruption)
- **Data Flow:** DB value → `fs.createReadStream(capture.imagemPath)` (`routes.ts:572`) / `fs.unlinkSync(capture.imagemPath)` (`routes.ts:481`)
- **Guard:** `isPathSafe()` applied before both operations (`routes.ts:575, 483`) — resolves and checks prefix against `uploads/` directory
- **Dangerous Sink:** File system read/delete, but `isPathSafe()` mitigates direct exploitation

### SSRF Sources

**Finding SSRF-1: Camera `hostname`/`streamUrl` stored SSRF (CRITICAL)**
- **Input:** `hostname`, `portaHttp`, `streamUrl` fields in `POST /api/admin/cameras` or `PUT /api/admin/cameras/:id` body
- **Validation:** `insertCameraSchema` — only `z.string()` (no URL format, no scheme restriction, no blocklist applied at storage time)
- **Data Flow:** Admin POST → stored in `cameras.hostname` / `cameras.streamUrl` → 60-second interval capture job reads all active cameras → `fetchSnapshot({streamUrl, hostname, ...})` → `fetchSnapshotFromGo2rtc(streamUrl)` → `fetch(frameUrl)` OR `buildSnapshotUrl(hostname)` → `fetchRawImage(url)` → `fetch(url)`
- **Dangerous Sinks:** `server/camera-service.ts:92` (`fetch(url)` in `fetchRawImage`) and `server/camera-service.ts:137` (`fetch(frameUrl)` in `fetchSnapshotFromGo2rtc`)
- **SSRF Guard:** `isSafeTarget()` only applied at `POST /api/admin/cameras/test` — NOT at creation/update time, NOT during capture job, NOT at snapshot endpoints
- **Blocklist Weaknesses (isSafeTarget at test endpoint):** Only 3 entries blocked: `169.254.169.254`, `metadata.google.internal`, `metadata.internal`. Unblocked: `127.0.0.1`, `localhost`, `[::1]`, `0.0.0.0`, any RFC1918 address, `[::ffff:169.254.169.254]`, hex/decimal IP encodings, `169.254.170.2` (AWS ECS), `100.100.100.200` (Alibaba)
- **`isCompleteUrl()` Bypass:** If `hostname` starts with `http://` and contains `?`, it's used verbatim: `http://internal-service:8080/path?anything` → fetched as-is. `server/camera-service.ts:47-49, 62-64`
- **Response Exfiltration:** Captured responses saved as JPEG files, served via `/api/captures/**`, readable by authenticated users → blind SSRF becomes non-blind
- **Endpoints triggering the SSRF:** `GET /api/admin/cameras/:id/snapshot` (`routes.ts:580`), `GET /api/client/cameras/:id/snapshot` (`routes.ts:1173`), automatic 60-second capture job (`server/capture-job.ts:32-39`)

**Finding SSRF-2: Camera test endpoint with weak blocklist (HIGH)**
- **Input:** `streamUrl` or `hostname` in `POST /api/admin/cameras/test` body
- **Validation:** `isSafeTarget()` applied — weak 3-entry blocklist (see bypasses above)
- **Data Flow:** `POST /api/admin/cameras/test` → `isSafeTarget(target)` → `testGo2rtcConnection(streamUrl)` → `fetch(url+'/api/streams')` (`camera-service.ts:169`) OR `testCameraConnection(params)` → `fetchRawImage(url)` → `fetch(url)` → response base64-encoded and returned to caller
- **Dangerous Sink:** `server/camera-service.ts:169` (`testGo2rtcConnection`) and `server/camera-service.ts:92` (`fetchRawImage`)
- **Response Returned Directly:** The test endpoint returns the base64-encoded response body as a "thumbnail" — enabling full SSRF response exfiltration

### Server-Side Template Injection Sources

**Finding SSTI-1: No SSTI surface found**
- The server renders no HTML templates — it is a pure REST API + static file server
- No template engine (Handlebars, EJS, Pug, etc.) is used
- Email templates are string literals constructed in `server/email-service.ts` with no user-controlled expressions in template delimiters

### Deserialization Sources

**Finding DS-1: No insecure deserialization found**
- JWT parsing uses `jsonwebtoken.verify()` — standard library, no known deserialization vulnerabilities
- No `eval()`, `Function()`, or unsafe `JSON.parse()` of user-controlled data found
- No serialized object formats (Java serialization, pickle, etc.) used

