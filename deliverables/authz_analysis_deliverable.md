# Authorization Analysis Report

## 1. Executive Summary

- **Analysis Status:** Complete
- **Target:** SkyLapse IP Camera Management Platform — `http://host.docker.internal:3000`
- **Key Outcome:** Seven (7) externally-exploitable authorization vulnerabilities were confirmed through white-box code tracing. Findings span horizontal privilege escalation (IDOR, peer admin takeover), vertical privilege abuse (admin proliferation, SSRF guard bypass), and context/workflow boundary failures (client-triggered stored SSRF). All confirmed findings have been passed to the exploitation phase via the machine-readable JSON queue.
- **Purpose of this Document:** This report provides the strategic context, dominant vulnerability patterns, and architectural intelligence necessary to effectively exploit the vulnerabilities listed in the queue. It is intended to be read alongside the JSON deliverable (`authz_exploitation_queue.json`).

---

## 2. Dominant Vulnerability Patterns

### Pattern 1: Missing Camera Ownership Validation on Static File Routes (Horizontal)
- **Description:** The `/api/captures/**` and `/api/videos/**` static file routes authenticate the user (any valid admin or client token) but perform **zero** camera-level ownership verification. The file path structure `{cameraId}/{date}/{filename}` is entirely attacker-controlled via the URL, and the only middleware applied is `isAnyAuthenticated` (routes.ts:163-164).
- **Implication:** Any authenticated user — including client accounts that have never been granted access to a specific camera — can read capture images and timelapse videos from ANY camera by constructing the appropriate URL path. This completely bypasses the per-camera ACL enforced on the JSON API layer.
- **Representative:** AUTHZ-VULN-01, AUTHZ-VULN-02

### Pattern 2: Missing Peer-Ownership Check on Admin Account Mutations (Horizontal)
- **Description:** The `PUT /api/admin/accounts/:id` and `DELETE /api/admin/accounts/:id` endpoints accept arbitrary admin account IDs in the path parameter and perform modifications (including password change) with no check that `req.adminAccountId === req.params.id`. Any admin can target any other admin.
- **Implication:** An attacker with a single admin credential can silently take over every other admin account by changing their passwords, or can delete competing admin accounts to reduce the account count to 1 (rendering further deletions impossible but achieving exclusive control).
- **Representative:** AUTHZ-VULN-03, AUTHZ-VULN-04

### Pattern 3: Missing SSRF Guard on Stored Camera Configurations (Vertical/Context)
- **Description:** Camera creation (`POST /api/admin/cameras`) and update (`PUT /api/admin/cameras/:id`) accept `hostname` and `streamUrl` with no server-side URL safety check (`isSafeTarget()` is called only on the test endpoint). These values are stored in the database and subsequently fetched server-side by the 60-second background capture job, the admin snapshot endpoint, and the client snapshot endpoint — all without safety checks.
- **Implication:** An admin-level attacker can plant a malicious target (e.g., `http://127.0.0.1:5432`, `http://192.168.1.1`, `http://169.254.170.2/metadata`) as a camera hostname/streamUrl. The server will fetch it repeatedly and save responses as JPEG capture files, which are then readable via the IDOR-vulnerable `/api/captures/**` route — turning a blind SSRF into a fully exfiltrable one.
- **Representative:** AUTHZ-VULN-06, AUTHZ-VULN-07

### Pattern 4: Insufficient SSRF Blocklist (Vertical)
- **Description:** The `isSafeTarget()` function used on `POST /api/admin/cameras/test` maintains a 3-entry blocklist (`169.254.169.254`, `metadata.google.internal`, `metadata.internal`) while allowing `127.0.0.1`, `localhost`, `[::1]`, any RFC1918 address (10.x, 172.16.x, 192.168.x), and cloud-specific metadata endpoints (`169.254.170.2` for AWS ECS, `100.100.100.200` for Alibaba).
- **Implication:** Admins can use the test endpoint to perform authenticated SSRF probes against internal services, with the full HTTP response returned to the caller as base64-encoded data.
- **Representative:** AUTHZ-VULN-05

### Pattern 5: Admin Privilege Proliferation (Vertical)
- **Description:** `POST /api/admin/accounts` allows **any** authenticated admin to create additional admin accounts. There is no super-admin tier, no approval gate, and no constraint preventing unlimited admin creation.
- **Implication:** A compromised admin account can immediately create persistent backdoor admin accounts that will survive revocation of the original account.
- **Representative:** AUTHZ-VULN-08

---

## 3. Strategic Intelligence for Exploitation

### Session Management Architecture
- Sessions use HS256 JWT tokens stored in httpOnly, Secure, SameSite:strict cookies
- Two distinct JWT secrets: `SESSION_SECRET+"_admin"` and `SESSION_SECRET+"_client"`; the development default secret is the hardcoded literal `"skylapse-dev-secret-insecure"`
- User identity (`adminAccountId` / `clientAccountId`) is extracted from the token and confirmed via a live DB query on every request
- **Critical Finding:** The admin token grants full CRUD access to all admin-tier resources with no per-resource ownership validation except camera access on client routes

### Role/Permission Model
- **Two roles only:** `admin` (full access) and `client` (scoped to assigned cameras via `clientCameraAccess` junction table)
- Role is determined entirely by which DB table and which JWT secret is used — there is no `role` column
- **Critical Finding:** Within the admin tier, all accounts are peers; there is no super-admin, so any admin can operate on any other admin's account

### Resource Access Patterns
- JSON API endpoints (e.g., `/api/client/cameras/:id/captures`) correctly enforce the `allowedIds` ownership check
- Static file endpoints (`/api/captures/**`, `/api/videos/**`) use only `isAnyAuthenticated` — no ownership check
- File path structure: `/api/captures/{cameraId}/{YYYY-MM-DD}/{filename}`, `/api/videos/{cameraId}/{filename}`
- **Critical Finding:** Camera UUIDs are present in the JSON API responses (e.g., `GET /api/client/cameras`) — an authenticated client can enumerate allowed camera IDs from the API, then use those same IDs on the static routes to access any other camera's files by substituting a different cameraId

### SSRF Architecture
- `isSafeTarget()` in `server/camera-service.ts:15-29` is the only SSRF guard, and it is applied ONLY to `POST /api/admin/cameras/test`
- The actual server-side fetch pipeline (`fetchSnapshot` → `fetchRawImage`/`fetchSnapshotFromGo2rtc`) has no SSRF guard
- The 60-second capture cron job (`server/capture-job.ts`) fetches all active cameras automatically without any hostname validation
- **Critical Finding:** Responses from SSRF fetches are stored as JPEG capture files under `uploads/captures/{cameraId}/{date}/`, making the SSRF non-blind via `/api/captures/**`

### Workflow Implementation
- Password reset uses `crypto.randomBytes(32)` (256-bit entropy) with a 1-hour expiry — robust
- `POST /api/client/change-password` is not rate-limited but requires the current password, which is a sufficient guard
- **Critical Finding (Date Params):** `GET /api/client/cameras/:id/captures/download` does NOT call `isValidDate()` on `dataInicio`/`dataFim` parameters, while the equivalent admin endpoint does. This inconsistency is a minor logic gap but does not directly bypass authorization since the camera ownership check is still enforced.

---

## 4. Vulnerability Findings — Code-Backed Traces

### AUTHZ-VULN-01 & AUTHZ-VULN-02: Static File IDOR (Captures & Videos)

**Source (route registration):**
```
server/routes.ts:163-164
app.use("/api/captures", isAnyAuthenticated, express.static(path.resolve("uploads/captures")));
app.use("/api/videos",   isAnyAuthenticated, express.static(path.resolve("uploads/videos")));
```

**Guard applied:**
```
server/routes.ts:105-132 — isAnyAuthenticated
  ↓ verifies JWT signature + live DB existence
  ↓ sets req.adminAccountId OR req.clientAccountId
  ↓ calls next() — NO camera ownership check
```

**Missing guard (contrast with protected JSON endpoint):**
```
server/routes.ts:1075-1077
  const allowedIds = await storage.getClientCameraIds(req.clientAccountId!);
  if (!allowedIds.includes(req.params.id)) {
    return res.status(403).json({ message: "Acesso negado a esta câmera" });
  }
```
This ownership check exists on the JSON API but is entirely absent on the static file middleware.

---

### AUTHZ-VULN-03: PUT /api/admin/accounts/:id — Horizontal Admin Account Takeover

**Source:**
```
server/routes.ts:998-1022
app.put("/api/admin/accounts/:id", isAdminAuthenticated, async (req, res) => {
  const data = updateSchema.parse(req.body);           // nome, email, senha
  if (data.senha) updateData.senhaHash = await bcrypt.hash(data.senha, 12);
  const updated = await storage.updateAdminAccount(req.params.id, updateData);
```

**Missing guard:** No `req.adminAccountId === req.params.id` check. Any admin ID in `req.params.id` will be updated.

---

### AUTHZ-VULN-04: DELETE /api/admin/accounts/:id — Horizontal Admin Account Deletion

**Source:**
```
server/routes.ts:1024-1039
app.delete("/api/admin/accounts/:id", isAdminAuthenticated, async (req, res) => {
  const count = await storage.countAdminAccounts();
  if (count <= 1) return res.status(400).json({ ... });  // only guard: last-admin check
  const deleted = await storage.deleteAdminAccount(req.params.id);
```

**Missing guard:** No `req.adminAccountId === req.params.id` check. Any admin can delete any other admin.

---

### AUTHZ-VULN-05: POST /api/admin/cameras/test — SSRF via Weak Blocklist

**Source:**
```
server/camera-service.ts:9-13
const BLOCKED_HOSTS = new Set([
  "169.254.169.254", "metadata.google.internal", "metadata.internal"
]);

server/camera-service.ts:15-29 (isSafeTarget)
  — hostname checked against BLOCKED_HOSTS only
  — 127.0.0.1, localhost, [::1], 10.x.x.x, 192.168.x.x NOT blocked

server/routes.ts:536-542 — response returned as base64 imagem field
```

---

### AUTHZ-VULN-06 & AUTHZ-VULN-07: Stored SSRF via Camera Creation/Update

**Source:**
```
server/routes.ts:492-505 (POST /api/admin/cameras)
  insertCameraSchema.parse(req.body)   // z.string() only on hostname/streamUrl
  storage.createCamera(data)           // NO isSafeTarget() called

server/routes.ts:611-626 (PUT /api/admin/cameras/:id)
  insertCameraSchema.partial().parse(req.body)
  storage.updateCamera(req.params.id, data)  // NO isSafeTarget() called
```

**SSRF fetch path (automatic + on-demand):**
```
server/capture-job.ts:32-39
  → fetchSnapshot({ streamUrl, hostname, ... })

server/camera-service.ts:184-202 (fetchSnapshot)
  → if (config.streamUrl) → fetchSnapshotFromGo2rtc(streamUrl) → fetch(frameUrl) [line 137]
  → else buildSnapshotUrl(hostname) → fetchRawImage(url) → fetch(url) [line 92]
  NO isSafeTarget() guard at any of these points
```

**Exfiltration path:**
```
Captured response saved to uploads/captures/{cameraId}/{date}/{filename}
→ Readable via GET /api/captures/{cameraId}/{date}/{filename} (IDOR, AUTHZ-VULN-01)
```

---

### AUTHZ-VULN-08: POST /api/admin/accounts — Unbounded Admin Proliferation

**Source:**
```
server/routes.ts:979-996
app.post("/api/admin/accounts", isAdminAuthenticated, async (req, res) => {
  const data = insertAdminAccountSchema.parse(req.body);
  const senhaHash = await bcrypt.hash(data.senha, 12);
  const account = await storage.createAdminAccount({ nome, email, senhaHash });
  // No super-admin check, no approval gate, no limit
```

---

## 5. Vectors Analyzed and Confirmed Secure

These authorization checks were traced and confirmed to have robust, properly-placed guards.

| **Endpoint** | **Guard Location** | **Defense Mechanism** | **Verdict** |
|---|---|---|---|
| `GET /api/client/cameras` | routes.ts:1058 | `isClientAuthenticated` + storage.getClientCameras scoped to clientAccountId | SAFE |
| `GET /api/client/cameras/:id/captures` | routes.ts:1073-1077 | `isClientAuthenticated` + `allowedIds.includes(req.params.id)` | SAFE |
| `GET /api/client/cameras/:id/captures/download` | routes.ts:1096-1099 | `isClientAuthenticated` + `allowedIds.includes(req.params.id)` (date params unvalidated but ownership is enforced) | SAFE (auth) |
| `GET /api/client/cameras/:id/thumbnail` | routes.ts:1143-1148 | `isClientAuthenticated` + `allowedIds` check + `isPathSafe()` | SAFE |
| `GET /api/client/me` | routes.ts:1208 | `isClientAuthenticated`; returns own profile via `req.clientAccountId` — no param manipulation | SAFE |
| `POST /api/client/change-password` | routes.ts:1235-1260 | `isClientAuthenticated`; verifies current password before update; scoped to own accountId | SAFE |
| `POST /api/client/reset-password` | routes.ts:1290-1314 | `crypto.randomBytes(32)` (256-bit token); 1-hour expiry check; rate-limited by IP | SAFE |
| `POST /api/client/forgot-password` | routes.ts:1264-1287 | Rate-limited; always returns same response to prevent email enumeration | SAFE |
| `GET /api/admin/cameras` (list) | routes.ts:362 | `isAdminAuthenticated` + `stripCameraCredentials()` applied | SAFE (no creds) |
| `GET /api/admin/cameras/offline` | routes.ts:372 | `isAdminAuthenticated` + `stripCameraCredentials()` applied | SAFE (no creds) |
| `DELETE /api/admin/captures/:id` | routes.ts:472-490 | `isAdminAuthenticated` + `isPathSafe()` before file delete | SAFE |
| `GET /api/admin/cameras/:id/thumbnail` | routes.ts:553 | `isAdminAuthenticated` + `isPathSafe()` before file read | SAFE |
| `DELETE /api/admin/timelapses/:id` | routes.ts:694 | `isAdminAuthenticated` + `isPathSafe()` before file delete | SAFE |
| `GET /api/admin/me` | routes.ts:954 | `isAdminAuthenticated`; returns own profile via `req.adminAccountId` | SAFE |
| `POST /api/admin/login` / `POST /api/client/login` | routes.ts:903/846 | Rate-limited (5/15min/IP); bcrypt cost-12 | SAFE |
| All `/api/admin/*` JSON routes | routes.ts:64-82 | `isAdminAuthenticated` blocks all non-admin tokens (different JWT secret) | SAFE (client cannot access admin routes) |

---

## 6. Analysis Constraints and Blind Spots

### Peer Admin Authorization Is By-Design Flat
The application has a flat admin model — all admins are peers. The `PUT /api/admin/client-accounts/:id` and `DELETE /api/admin/client-accounts/:id` endpoints allow any admin to modify/delete any client account. This is consistent with the design intent (all admins manage all resources). However, the `PUT /api/admin/accounts/:id` and `DELETE /api/admin/accounts/:id` allow admins to target OTHER ADMIN ACCOUNTS, which represents a genuine horizontal escalation risk regardless of the flat model.

### SSRF Exfiltration Chain Dependency
AUTHZ-VULN-06/07 (stored SSRF exfiltration) is most powerful in combination with AUTHZ-VULN-01 (static file IDOR). The response from an SSRF target is only accessible if the capture file is saved AND the attacker can retrieve it. Both vulnerabilities must be confirmed in exploitation.

### Static Analysis Scope
This analysis is based entirely on static code inspection. Runtime behavior of the Express.js `express.static()` middleware (e.g., whether it sanitizes `../` sequences) was not dynamically tested. However, the authorization control gap (no ownership check before `express.static`) is confirmed at the code level regardless.

### No Dynamic Permission System
The application uses a simple DB-table-based role model with no dynamic permission system. All findings are deterministic from static analysis.
