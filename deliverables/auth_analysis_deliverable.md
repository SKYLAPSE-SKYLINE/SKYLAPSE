# Authentication Analysis Report

## 1. Executive Summary

- **Analysis Status:** Complete
- **Target:** SkyLapse IP Camera Management Platform — `http://host.docker.internal:3000`
- **Key Outcome:** Six externally exploitable authentication flaws were identified, spanning session/token management, abuse-defense gaps, and transport security. The most critical findings are the absence of server-side JWT revocation on logout (enabling 24-hour token replay) and missing Secure cookie flags due to a non-production environment configuration. A structural rate-limit bypass allows credential brute-force attacks with minimal throttling by interleaving successful logins. Inactive-account enumeration exposes partial account-existence information.
- **Purpose of this Document:** This report provides strategic context on the SkyLapse application's authentication mechanisms, dominant vulnerability patterns, and key architectural details required to effectively exploit the vulnerabilities listed in the exploitation queue.

---

## 2. Dominant Vulnerability Patterns

### Pattern 1: Stateless JWT With No Server-Side Revocation
- **Description:** The application uses 24-hour HS256 JWTs stored in cookies. There is no server-side session store, no token blacklist, and no revocation mechanism. Logout endpoints (`POST /api/admin/logout`, `POST /api/client/logout`) carry no authentication middleware — they simply clear the response cookie. A captured token remains valid for the full 24-hour window regardless of whether the user has "logged out."
- **Implication:** Any attacker who captures a JWT (via network interception over the unencrypted HTTP channel, XSS, or other means) can replay it until expiry. The only server-side check that partially mitigates this is live DB lookup on every request — but that only invalidates tokens for *deleted* accounts, not for logged-out ones.
- **Representative Findings:** `AUTH-VULN-01`, `AUTH-VULN-05`.

### Pattern 2: Transport Exposure from Non-Production Environment Configuration
- **Description:** Both security-sensitive cookie attributes (`Secure` flag) and HSTS are gated on `process.env.NODE_ENV === "production"`. Since `NODE_ENV` is not set in the deployment's `.env` file, the application runs in non-production mode: cookies lack the `Secure` flag and no `Strict-Transport-Security` header is emitted. The target is accessible over plain HTTP (`http://host.docker.internal:3000`), confirming the HTTP-only exposure.
- **Implication:** Cookies and session tokens travel in cleartext over HTTP. A network-level attacker (or any proxy in the request path) can passively capture authentication tokens without any active attack.
- **Representative Findings:** `AUTH-VULN-05`, `AUTH-VULN-06`.

### Pattern 3: Incomplete Abuse Defenses on Authentication Flows
- **Description:** The rate-limiter (`checkRateLimit`) is applied to login and password-reset endpoints but is absent from `POST /api/client/change-password`. More critically, the rate-limit counter is reset (`resetRateLimit`) upon *any* successful authentication from the same IP. This allows an attacker holding valid credentials (for their own account) to interleave successful logins between brute-force attempts, continuously resetting the counter and effectively defeating the 5-attempt limit.
- **Implication:** Brute-force and credential-stuffing attacks can be conducted without meaningful throttling, provided the attacker has a valid account of their own.
- **Representative Findings:** `AUTH-VULN-02`, `AUTH-VULN-03`, `AUTH-VULN-04`.

---

## 3. Strategic Intelligence for Exploitation

### Authentication Architecture
- **Method:** Stateless JWT-based authentication (HS256) via HttpOnly cookies.
- **Cookie Names:** `skylapse-admin-token` (admin), `skylapse-client-token` (client).
- **JWT Secrets:**
  - `CLIENT_JWT_SECRET = SESSION_SECRET + "_client"`
  - `ADMIN_JWT_SECRET = SESSION_SECRET + "_admin"`
  - `SESSION_SECRET` is a 64-character random value set in `.env`. Both secrets are derived by simple string concatenation — knowledge of one yields the other.
- **Token Lifetime:** 24 hours (`{ expiresIn: "24h" }`). No sliding window. No refresh mechanism.
- **Role Differentiation:** Structural — which DB table the account is in, not a role claim in the JWT.

### Session & Cookie Configuration
- `httpOnly: true` ✓ (in all environments)
- `sameSite: "strict"` ✓ (in all environments)
- `secure: process.env.NODE_ENV === "production"` → **`false` in the current deployment** (NODE_ENV not set)
- `maxAge: 24 * 60 * 60 * 1000` (24h)
- No `path` attribute explicitly set (defaults to `/`)

### Rate Limiting
- **Mechanism:** In-memory `Map` keyed by `req.ip`. 5 attempts / 15-minute window.
- **Covered:** `POST /api/admin/login`, `POST /api/client/login`, `POST /api/client/forgot-password`, `POST /api/client/reset-password`.
- **NOT covered:** `POST /api/client/change-password`.
- **Reset-on-success vulnerability:** `loginAttempts.delete(ip)` fires on any successful authentication from the IP, resetting the counter for ALL pending attempts.
- **Persistence:** In-memory only; lost on server restart.

### Password Policy
- Minimum 8 characters (Zod: `z.string().min(8)`).
- No complexity requirements (uppercase, numbers, symbols).
- No maximum length specified.
- Password hashing: bcryptjs cost-12 (strong).
- Initial admin password: `crypto.randomBytes(12).toString("base64url")` — random and cryptographically secure at seed time.

### Password Reset Flow
- Token: `crypto.randomBytes(32).toString("hex")` → 256 bits entropy. **Secure.**
- TTL: 1 hour. **Adequate.**
- Single-use: `storage.clearResetToken(account.id)` after use. **Secure.**
- Enumeration resistance: always returns identical message. **Secure.**

### Dead Code / Non-Applicable
- OIDC routes (`/api/login`, `/api/callback`, `/api/logout`): dead code — Passport never initialized. No OAuth/SSO flow to audit.
- `express-session`, `connect-pg-simple`, `memorystore`, `passport-local`, `openid-client`: installed but unreachable.

---

## 4. Vulnerability Findings

### AUTH-VULN-01 — No Server-Side JWT Invalidation on Logout (Token Replay)
- **Location:** `server/routes.ts:948-952` (admin logout), `server/routes.ts:1202-1206` (client logout)
- **Description:** Both logout endpoints have **no authentication middleware**. They only call `res.clearCookie()` on the outbound response. Because there is no server-side session store or token blacklist, the JWT extracted prior to logout remains cryptographically valid and will continue to pass the `jwt.verify()` + DB existence check on every subsequent protected endpoint for up to 24 hours.
- **Code Evidence:**
  ```typescript
  app.post("/api/admin/logout", (req, res) => {          // no isAdminAuthenticated
      audit("admin.logout", { adminAccountId: req.adminAccountId }); // undefined — no auth
      res.clearCookie("skylapse-admin-token");            // client-side only
      res.json({ message: "Logout realizado" });
  });
  ```

### AUTH-VULN-02 — No Rate Limiting on POST /api/client/change-password
- **Location:** `server/routes.ts:1235`
- **Description:** The change-password endpoint is protected by `isClientAuthenticated` but has **no call to `checkRateLimit`**. An authenticated attacker (or malicious script with a valid session) can make unlimited password verification attempts against `bcrypt.compare(senhaAtual, account.senhaHash)`.
- **Code Evidence:** Compare the login handler (line 849: `if (!checkRateLimit(ip)) { ... }`) with the change-password handler (line 1235–1261): no `checkRateLimit` call present.

### AUTH-VULN-03 — Rate Limit Bypass via Successful Login Reset
- **Location:** `server/routes.ts:52-54`, `server/routes.ts:876` (client), `server/routes.ts:929` (admin)
- **Description:** `resetRateLimit(ip)` deletes the entire rate-limit entry for the IP upon any successful authentication. An attacker who holds their own valid credentials can interleave successful logins between brute-force attempts, continuously resetting the 5-attempt counter and sustaining indefinite brute-force campaigns against any target account.
- **Code Evidence:**
  ```typescript
  function resetRateLimit(ip: string) {
      loginAttempts.delete(ip);   // wipes ALL attempt history for this IP
  }
  // Called on every successful login:
  resetRateLimit(ip);  // routes.ts:876 (client), 929 (admin)
  ```

### AUTH-VULN-04 — Account Existence Enumeration via HTTP Status Code (Inactive Accounts)
- **Location:** `server/routes.ts:862-873`
- **Description:** The client login flow returns a **403** with the distinct message `"Conta desativada. Entre em contato com o suporte."` when the account exists but has `status !== "ativo"`, versus a **401** with `"E-mail ou senha incorretos"` for non-existent accounts or wrong passwords. This discrepancy allows an attacker to enumerate whether a specific email address corresponds to an *inactive* SkyLapse account.
- **Code Evidence:**
  ```typescript
  const account = await storage.getClientAccountByEmail(email);
  if (!account) {
      return res.status(401).json({ message: "E-mail ou senha incorretos" }); // 401
  }
  if (account.status !== "ativo") {
      return res.status(403).json({ message: "Conta desativada. Entre em contato com o suporte." }); // 403 — account exists!
  }
  ```

### AUTH-VULN-05 — Missing Secure Cookie Flag (Non-Production Environment)
- **Location:** `server/routes.ts:885` (client), `server/routes.ts:937` (admin)
- **Description:** The `Secure` flag on both JWT cookies is conditionally set to `false` when `NODE_ENV !== "production"`. `NODE_ENV` is not present in the `.env` file, so the running application is in non-production mode. The application is served over plain HTTP (`http://host.docker.internal:3000`). Cookies without the `Secure` flag are transmitted in cleartext HTTP requests and are not protected from network interception.
- **Code Evidence:**
  ```typescript
  res.cookie("skylapse-client-token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",  // → false (NODE_ENV not set)
      maxAge: 24 * 60 * 60 * 1000,
      sameSite: "strict",
  });
  ```
- **Live Confirmation:** HTTP responses to `http://host.docker.internal:3000` contain no `Strict-Transport-Security` header and no `Secure` attribute on any `Set-Cookie` response header.

### AUTH-VULN-06 — HSTS Not Emitted in Non-Production Environment
- **Location:** `server/index.ts:58-60`
- **Description:** The `Strict-Transport-Security` header is only added when `NODE_ENV === "production"`. Because `NODE_ENV` is not set, HSTS is absent from all responses. Combined with the missing `Secure` flag, there is no browser-level enforcement of HTTPS for this application.
- **Code Evidence:**
  ```typescript
  if (process.env.NODE_ENV === "production") {
      res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  // NODE_ENV not set → header never sent
  ```
- **Live Confirmation:** `curl -I http://host.docker.internal:3000/` returns no `Strict-Transport-Security` header.

---

## 5. Secure by Design: Validated Components

These components were analyzed and found to have robust defenses. They are low-priority for further testing.

| Component/Flow | Endpoint/File Location | Defense Mechanism Implemented | Verdict |
|---|---|---|---|
| Password Hashing | `server/routes.ts:870`, `server/routes.ts:923` | `bcrypt.compare` with cost-12 for all password verification. No timing-safe shortcut. | SAFE |
| Admin Password Hashing | `server/routes.ts:982`, `server/routes.ts:1010` | `bcrypt.hash(password, 12)` on creation and update. | SAFE |
| Reset Token Generation | `server/routes.ts:1275` | `crypto.randomBytes(32).toString("hex")` — 256-bit entropy. Cryptographically secure. | SAFE |
| Reset Token TTL | `server/routes.ts:1276` | 1-hour expiry enforced server-side at token lookup (`new Date() > account.resetTokenExpiry`). | SAFE |
| Reset Token Single-Use | `server/routes.ts:1308` | `storage.clearResetToken(account.id)` called immediately after successful reset. | SAFE |
| Forgot-Password Enumeration | `server/routes.ts:1273`, `server/routes.ts:1282` | Returns identical message regardless of whether email exists. | SAFE |
| Admin Login Error Messages | `server/routes.ts:921`, `server/routes.ts:926` | Both "account not found" and "wrong password" return identical 401 `"E-mail ou senha incorretos"`. | SAFE |
| JWT Secret Strength | `server/index.ts:19-23`, `.env` | SESSION_SECRET validated ≥32 chars in production; actual value is 64-char CSPRNG string. | SAFE |
| Live DB Revocation | `server/routes.ts:72-76`, `server/routes.ts:93-96` | Per-request DB lookup invalidates tokens for deleted/deactivated accounts immediately. | SAFE |
| HttpOnly Cookie Flag | `server/routes.ts:884`, `server/routes.ts:936` | `httpOnly: true` on all JWT cookies — protects against JavaScript cookie theft. | SAFE |
| SameSite Cookie Flag | `server/routes.ts:887`, `server/routes.ts:939` | `sameSite: "strict"` on all cookies — blocks cross-site request forgery for session endpoints. | SAFE |
| Session Fixation | N/A (JWT-stateless) | Each successful login issues a new `jwt.sign()` call — no pre-login session ID exists to fix. | SAFE |
| OAuth/OIDC Flow | `server/replit_integrations/auth/replitAuth.ts` | Dead code — Passport never initialized. No live OAuth surface. | N/A (SAFE) |
| Initial Admin Password | `server/index.ts:106` | `crypto.randomBytes(12).toString("base64url")` — random seed credential, not hardcoded. | SAFE |
| Hardcoded Dev Fallback | `server/index.ts:19` | Code path exists (`"skylapse-dev-secret-insecure"`) but deployment has SESSION_SECRET properly set in `.env`. Not exploitable in this instance. | SAFE (this deployment) |
