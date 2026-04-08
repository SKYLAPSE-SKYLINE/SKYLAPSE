# Code Analysis Deliverable — SkyLapse Security Assessment

**Application:** SkyLapse (IP Camera Management & Timelapse Platform)
**Date:** 2026-04-08
**Analyst:** Automated Security Code Analysis Agent (Pre-Recon Phase)

---

# Penetration Test Scope & Boundaries

**Primary Directive:** This analysis is strictly limited to the **network-accessible attack surface** of the SkyLapse application. All findings have been verified against the deployed architecture to confirm network reachability.

### In-Scope: Network-Reachable Components
- **Express.js REST API** (`/api/*` routes) — all endpoints served on port 5000 (Replit) or 3000 (default)
- **React SPA** — served from the same Express server as static assets in production
- **Static file serving** — `/api/captures/**` and `/api/videos/**` authenticated static file middleware
- **Replit OIDC Auth endpoints** — `/api/login`, `/api/callback`, `/api/logout` (legacy but still routed)
- **Background capture job** — triggered by in-process `setInterval`, fetches from user-configured camera URLs (stored SSRF surface)
- **Timelapse generation job** — processes stored file paths via ffmpeg (indirect attack surface through stored data)

### Out-of-Scope: Locally Executable Only
- `script/build.ts` — esbuild bundler script, CLI-only
- `drizzle.config.ts` — database migration configuration, requires `npm run db:push`
- Vite dev server middleware — only active in development mode, not deployed
- `.replit` configuration — Replit platform config, not application code
- `.local/` and `.claude/` skill/agent definitions — development tooling only

---

## 1. Executive Summary

SkyLapse is a monolithic TypeScript web application that manages IP camera surveillance, scheduled image capture, and timelapse video generation. It presents a moderate-to-high risk security profile driven primarily by its role as a **server-side proxy to IP cameras** — a design pattern that creates inherent Server-Side Request Forgery (SSRF) attack surface. The application uses Express.js 5 with JWT-based authentication, PostgreSQL via Drizzle ORM, and serves both a React SPA and REST API from a single process.

The most critical security findings center on three areas: (1) **Stored SSRF** — admin-configured camera hostnames and stream URLs are fetched by the server on every capture interval (60 seconds) with no SSRF validation applied at creation/update time; the `isSafeTarget()` blocklist is only enforced on the test endpoint and is trivially bypassable even there. (2) **Broken access control on static file serving** — the `/api/captures` and `/api/videos` static middleware authenticates users but does not enforce camera-level authorization, allowing any authenticated client to access any camera's captures by guessing the URL path. (3) **Camera credentials stored in plaintext** in the database and returned in full via the admin detail endpoint, with initial client passwords sent in cleartext email.

Positively, the application demonstrates several strong security practices: bcrypt cost-12 password hashing, httpOnly/Secure/SameSite:strict cookie configuration, Zod input validation on all endpoints, database-level account existence verification on every authenticated request (compensating for stateless JWTs), comprehensive audit logging, and whitelist-based DTOs that prevent credential leakage to client-facing endpoints. The Content Security Policy is configured but weakened by `unsafe-inline` and `unsafe-eval` directives.

---

## 2. Architecture & Technology Stack

### Framework & Language

The application is built entirely in **TypeScript 5.6.3** with strict mode enabled (`tsconfig.json`). The server uses **Express.js 5.0.1** (a relatively new major version that may have undiscovered edge cases compared to the battle-tested v4). The client is a **React 18.3.1** SPA built with **Vite 7.3.0**, using **Wouter 3.3.5** for routing and **TanStack React Query 5.60.5** for server state management. The UI layer uses **shadcn/ui** (Radix primitives) with Tailwind CSS. Validation is handled by **Zod 3.24.2** with **drizzle-zod** for schema-to-validator generation. The database is **PostgreSQL 16** accessed via **Drizzle ORM 0.39.3** with the `pg` driver. Password hashing uses **bcryptjs 3.0.3** (pure JS implementation), and session tokens use **jsonwebtoken 9.0.3**. Email is sent via the **Resend SDK 6.10.0**. Video processing uses **ffmpeg/ffprobe** system binaries invoked via `child_process.execFile`.

From a security perspective, the Express 5 upgrade is notable — it changes error handling semantics and async support. The use of `bcryptjs` (JS) rather than `bcrypt` (native) means no native compilation dependencies but slightly slower hashing. The `pg` database driver is used without SSL configuration. Several dependencies in `package.json` are unused dead code from a Replit template: `passport`, `passport-local`, `openid-client`, `connect-pg-simple`, `express-session`, `memorystore` — these increase the dependency attack surface without providing functionality.

### Architectural Pattern

SkyLapse follows a **monolithic SPA + API server** pattern. A single Express process serves the React SPA (static files in production, Vite middleware in development) and all REST API endpoints under `/api/*`. There are no microservices, message queues, or separate worker processes. Background jobs (camera capture polling every 60 seconds, timelapse queue polling every 30 seconds) run as in-process `setInterval` timers within the same Express process. The server binds to `0.0.0.0` on port 5000 (Replit) or 3000 (default). Deployment is via **Replit Autoscale** — no Docker, Kubernetes, nginx, or other infrastructure configuration exists. TLS termination is handled by Replit's proxy infrastructure.

Trust boundaries exist at five critical points: (1) Internet → Express server (Replit proxy handles TLS), (2) Server → PostgreSQL (no SSL enforcement), (3) Server → IP cameras (outbound HTTP to user-supplied hostnames — primary SSRF surface), (4) Server → Resend email API (API key in env var), (5) Admin vs Client authorization (separate JWT secrets derived from same base secret). The lack of a reverse proxy (nginx) means no request-level rate limiting, WAF, or request size controls beyond Express defaults (100kb JSON body limit).

### Critical Security Components

The middleware pipeline in `server/index.ts` applies in order: JSON body parser (with rawBody capture), URL-encoded parser, cookie parser, security headers (manual — no helmet), and request logger. Security headers include `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, HSTS in production, and a CSP that unfortunately permits `unsafe-inline` and `unsafe-eval`. Routes are organized into three authorization tiers: public (login/logout/password-reset), admin-authenticated (`/api/admin/*`), and client-authenticated (`/api/client/*`), with a shared `isAnyAuthenticated` middleware for static file serving. The rate limiter is custom in-memory (Map-based, 5 attempts per IP per 15 minutes) applied only to authentication endpoints.

---

## 3. Authentication & Authorization Deep Dive

### Authentication Mechanisms

The application implements a custom JWT-based authentication system with two separate user types: **Admin** and **Client**. Each has its own JWT secret, cookie name, and middleware. Admin JWT secret is `SESSION_SECRET + "_admin"` and Client JWT secret is `SESSION_SECRET + "_client"` (defined in `server/routes.ts`, lines 32-33). Both secrets are derived from the same base `SESSION_SECRET` environment variable by simple string concatenation — if the base secret is compromised, both admin and client tokens can be forged. The `SESSION_SECRET` is validated at server startup (`server/index.ts`, lines 13-23) to be at least 32 characters in production, with a warning and insecure fallback in development mode.

Password hashing uses **bcryptjs with cost factor 12** consistently across all paths: admin account creation (`server/routes.ts:982`), client account creation (`server/routes.ts:762`), password changes (`server/routes.ts:1253`), password resets (`server/routes.ts:1305`), admin updates (`server/routes.ts:1009`), and initial admin seed (`server/index.ts:107`). The password policy enforces a minimum of 8 characters via Zod validation (`shared/schema.ts:209`) but does not enforce complexity requirements (uppercase, special characters, or breach-database checks).

**Exhaustive list of authentication API endpoints:**

| Endpoint | Method | File:Line | Auth | Purpose |
|----------|--------|-----------|------|---------|
| `/api/admin/login` | POST | `server/routes.ts:903` | Public | Admin login (email/password → JWT cookie) |
| `/api/admin/logout` | POST | `server/routes.ts:948` | Public* | Admin logout (clears cookie) |
| `/api/client/login` | POST | `server/routes.ts:846` | Public | Client login (email/password → JWT cookie) |
| `/api/client/logout` | POST | `server/routes.ts:1202` | Public* | Client logout (clears cookie) |
| `/api/client/forgot-password` | POST | `server/routes.ts:1264` | Public | Password reset request (sends email) |
| `/api/client/reset-password` | POST | `server/routes.ts:1290` | Public | Password reset execution (token + new password) |
| `/api/client/change-password` | POST | `server/routes.ts:1235` | Client | Authenticated password change |
| `/api/login` | GET | `server/replit_integrations/auth/replitAuth.ts:105` | Public | Replit OIDC login initiation (legacy) |
| `/api/callback` | GET | `server/replit_integrations/auth/replitAuth.ts:113` | Public | Replit OIDC callback (legacy) |
| `/api/logout` | GET | `server/replit_integrations/auth/replitAuth.ts:121` | Public | Replit OIDC logout (legacy) |

*Note: Logout endpoints lack auth middleware — they can be called without a valid token. Low impact since they only clear cookies, but `audit()` logs `req.adminAccountId`/`req.clientAccountId` which will be undefined.

### Session Management & Token Security

JWT tokens are issued with a **24-hour expiry** (`expiresIn: "24h"`) and delivered via HTTP cookies. Cookie configuration is defined at two locations:

**Admin cookie** (`server/routes.ts`, lines 935-939):
```
Cookie: skylapse-admin-token
httpOnly: true
secure: process.env.NODE_ENV === "production"
sameSite: "strict"
maxAge: 86400000 (24 hours)
path: "/"
```

**Client cookie** (`server/routes.ts`, lines 883-888):
```
Cookie: skylapse-client-token
httpOnly: true
secure: process.env.NODE_ENV === "production"
sameSite: "strict"
maxAge: 86400000 (24 hours)
path: "/"
```

All critical cookie flags are correctly set: `httpOnly` prevents JavaScript access, `secure` ensures HTTPS-only in production, and `sameSite: "strict"` provides effective CSRF mitigation. The `secure` flag is not set in development, meaning cookies are transmitted over HTTP in dev environments.

**Critical weakness — No server-side token revocation:** Logout only clears the client-side cookie (`res.clearCookie`). The JWT itself remains cryptographically valid for up to 24 hours. There is no server-side token blacklist or revocation mechanism. However, the application partially compensates: both middleware functions (`isAdminAuthenticated` at line 64-82 and `isClientAuthenticated` at line 84-102) verify that the account still exists in the database on every request. This means deleting or deactivating an account effectively revokes access, but logout alone does not invalidate the token if it has been captured by an attacker.

### Authorization Model

The application implements a **two-tier authorization model**:

1. **Admin tier** — All `/api/admin/*` routes are protected by `isAdminAuthenticated` middleware. All admins have identical privileges — there is no role-based differentiation. Any admin can create, modify, or delete other admin accounts, cameras, clients, and all data. The only safeguard is preventing deletion of the last admin account (`server/routes.ts:1027`).

2. **Client tier** — All `/api/client/*` routes are protected by `isClientAuthenticated` middleware. Clients have camera-level access control enforced via the `clientCameraAccess` junction table. Each client endpoint verifies that the requested camera ID is in the client's allowed list before serving data. Client-facing DTOs use a **whitelist approach** (`toClientCameraDTO` at lines 1043-1056) that only includes safe fields, never exposing credentials.

**Potential bypass scenario — Static file IDOR:** The static file middleware at `server/routes.ts:163-164` uses `isAnyAuthenticated` (admin OR client) but performs no camera-level authorization check. Any authenticated client can access any camera's captures by constructing a direct URL to `/api/captures/{cameraId}/{date}/{filename}`. Since camera IDs are UUIDs, this requires guessing or enumeration, but the ID format is predictable if any camera ID is known.

### Multi-Tenancy Security

Client isolation relies entirely on the `clientCameraAccess` table and application-level enforcement. All data resides in shared database tables — there is no tenant-level database partitioning. The enforcement is consistent across all client API endpoints (`server/routes.ts:1058-1200`), but as noted above, the static file serving middleware bypasses this isolation.

### SSO/OAuth/OIDC Flows

A complete **Replit OIDC** implementation exists in `server/replit_integrations/auth/replitAuth.ts` but is **NOT active** — the `setupAuth()` function is never imported or called from the main application. The endpoints (`/api/login`, `/api/callback`, `/api/logout`) are registered but non-functional without the Passport initialization. The implementation uses dynamic hostname-based strategy registration (`req.hostname`), which would be vulnerable to Host header manipulation if activated with `trust proxy` enabled (line 64). State and nonce validation is handled by the `openid-client` library internally. This dead code represents unnecessary attack surface.

---

## 4. Data Security & Storage

### Database Security

The PostgreSQL database is accessed via Drizzle ORM with the `pg` driver (`server/db.ts`). The connection is established using `new Pool({ connectionString: process.env.DATABASE_URL })` at line 13 with **no explicit SSL/TLS configuration**. If the database is on a remote host, connections may be unencrypted. No connection pool tuning is configured — default `pg.Pool` settings allow 10 connections with no statement timeout, creating potential for slow-query denial-of-service.

All SQL queries use Drizzle's query builder (`eq()`, `gte()`, `lte()`, `inArray()`) or the `sql` tagged template literal for parameterized queries. No string concatenation or raw SQL construction was found — the application is **not vulnerable to SQL injection**. The storage layer (`server/storage.ts`) is the sole interface to the database, providing a clean abstraction.

**Schema security concerns** (`shared/schema.ts`):
- **Lines 42-43:** Camera credentials (`usuario`, `senha`) are stored as plaintext `text()` columns with no encryption at rest. Any database breach, backup access, or SQL injection (if introduced in the future) would expose all camera credentials.
- **Line 71:** Password reset tokens (`resetToken`) are stored in plaintext. A database breach would allow an attacker to reset any user's password. Tokens should be stored as SHA-256 hashes.
- **Lines 10-11, 67:** PII fields (email, phone number) are stored as plaintext with no field-level encryption.
- All primary keys use UUIDs (`gen_random_uuid()`), which prevents sequential ID enumeration — a positive finding.
- Missing indexes on `clientAccounts.resetToken` and `clientAccounts.email` could enable timing-based enumeration and cause performance issues.

### Data Flow Security

**Camera credentials flow:** Admin submits plaintext credentials via `POST /api/admin/cameras` → stored directly in database as plaintext → read by capture job every 60 seconds → embedded in HTTP URL query parameters (e.g., `?user=xxx&password=yyy` at `camera-service.ts:72,76-78`) for camera requests. Credentials in URL query parameters may appear in camera-side access logs. The `stripCameraCredentials()` function (`routes.ts:139-142`) correctly removes credentials from list API responses, but the detail endpoint `GET /api/admin/cameras/:id` returns the full object including credentials (intentional for editing).

**Password flow:** User-submitted passwords are received as plaintext in request bodies, immediately hashed with bcrypt cost-12, and the plaintext is never stored. **Exception:** When creating client accounts (`routes.ts:775-782`), the plaintext password is passed to `sendWelcomeEmail()` and embedded in the HTML email body via the Resend API (`email-service.ts:201`). This means the initial password transits through a third-party email service and persists in the recipient's inbox.

**Password reset flow:** Tokens are generated with `crypto.randomBytes(32).toString("hex")` (256-bit entropy), expire in 1 hour, and are cleared after use. The forgot-password endpoint returns identical responses regardless of email existence (prevents enumeration). However, when `RESEND_API_KEY` is not configured, the reset URL (containing the token) is logged to stdout (`email-service.ts:57`).

### Multi-Tenant Data Isolation

Client data isolation is enforced via the `clientCameraAccess` junction table. Every client API endpoint checks `allowedIds.includes(req.params.id)` before serving camera data. This enforcement is consistent and correctly implemented across all five client camera endpoints. However, the static file middleware (`/api/captures/**`, `/api/videos/**`) at `routes.ts:163-164` only checks authentication (not authorization), creating a bypass where any authenticated user can access any camera's files by constructing the direct URL.

---

## 5. Attack Surface Analysis

### External Entry Points

The application exposes **60+ REST API endpoints** through a single Express server. These are organized into three authorization tiers:

**Public endpoints (no authentication):**
- `POST /api/client/login` — Client authentication with email/password. Rate-limited (5/15min per IP). Zod-validated input. Generic error messages prevent enumeration, but `403` response for inactive accounts partially leaks account existence. (`routes.ts:846`)
- `POST /api/admin/login` — Admin authentication. Same rate limiter pool as client login (shared counter). (`routes.ts:903`)
- `POST /api/client/forgot-password` — Password reset initiation. Returns identical response for known/unknown emails. (`routes.ts:1264`)
- `POST /api/client/reset-password` — Password reset execution. Validates 32-byte hex token with 1-hour expiry. (`routes.ts:1290`)
- `POST /api/admin/logout` / `POST /api/client/logout` — Cookie clearing. No auth middleware applied. (`routes.ts:948, 1202`)
- `GET /api/login`, `/api/callback`, `/api/logout` — Replit OIDC endpoints (legacy, non-functional without Passport initialization). (`replit_integrations/auth/replitAuth.ts`)

**Admin-authenticated endpoints (29 endpoints):**
Full CRUD operations on cameras, clients, locations, timelapses, client accounts, and admin accounts. Key high-risk endpoints:
- `POST /api/admin/cameras/test` (`routes.ts:507`) — **Primary SSRF vector.** Accepts `hostname` or `streamUrl` and makes outbound HTTP request. Has `isSafeTarget()` check but it is easily bypassed.
- `POST /api/admin/cameras` (`routes.ts:492`) — Camera creation. **No SSRF validation** on `hostname`/`streamUrl`. Values are stored and fetched automatically by capture job.
- `PUT /api/admin/cameras/:id` (`routes.ts:611`) — Camera update. Same SSRF concern as creation.
- `GET /api/admin/cameras/:id` (`routes.ts:382`) — Returns full camera object **including plaintext credentials** (usuario, senha, hostname).
- `GET /api/admin/cameras/:id/snapshot` (`routes.ts:580`) — Triggers live outbound HTTP request to stored camera URL.
- `GET /api/admin/cameras/:id/captures/download` (`routes.ts:428`) — Streams ZIP file of captures. Uses `archiver` library.
- `GET /api/admin/system-info` (`routes.ts:195`) — **Information disclosure:** Returns camera hostnames and `PORTAL_URL`.
- `GET /api/admin/dashboard-extra` (`routes.ts:167`) — Calculates disk usage by walking `uploads/captures` directory. Potential DoS if directory is very large.
- `POST /api/admin/client-accounts` (`routes.ts:755`) — Creates client accounts. Sends plaintext password in welcome email.

**Client-authenticated endpoints (7 endpoints):**
Read-only access to authorized cameras, captures, and account management. Camera-level ACL is consistently enforced. Missing date format validation on capture list/download endpoints compared to admin equivalents.

**Shared-auth static middleware (2 paths):**
- `/api/captures/**` (`routes.ts:163`) — Serves capture images. `isAnyAuthenticated` only — **no camera-level ACL**. IDOR vulnerability.
- `/api/videos/**` (`routes.ts:164`) — Serves timelapse videos. Same ACL bypass.

### Input Validation Patterns

All API endpoints use **Zod validation** for request bodies via `drizzle-zod` generated schemas. The validation is applied inline within route handlers (e.g., `insertCameraSchema.parse(req.body)`). Path parameters (`:id`) are used directly without explicit format validation, but Drizzle ORM's parameterized queries prevent SQL injection. Query parameters for pagination (`page`, `limit`) are parsed with `parseInt` and capped (limit: 1-500). Date parameters on admin endpoints are validated with `isValidDate()`, but client endpoints (`routes.ts:1073, 1094`) skip this validation.

### Background Processing

Two background jobs run as in-process `setInterval` timers:
1. **Capture job** (`server/capture-job.ts`) — Every 60 seconds, iterates all active cameras and fetches snapshots using stored `hostname`/`streamUrl`. This is the **stored SSRF attack surface** — an admin can configure a camera pointing at any internal service, and the server will fetch from it indefinitely.
2. **Timelapse job** (`server/timelapse-job.ts`) — Every 30 seconds, processes pending timelapse requests by invoking ffmpeg with a concat file built from database-stored file paths. The `-safe 0` flag permits ffmpeg to read absolute paths anywhere on the filesystem. While file paths are currently server-generated, the lack of sanitization means database manipulation could enable arbitrary file read via ffmpeg.

### Notable Out-of-Scope Components
- `script/build.ts` — Build script using esbuild and Vite. CLI-only, not network-accessible.
- `drizzle.config.ts` — Database migration config. Requires `npm run db:push` CLI execution.
- `server/replit_integrations/` — Replit OIDC auth code. Not wired into the main application (dead code).

---

## 6. Infrastructure & Operational Security

### Secrets Management

Secrets are loaded exclusively from environment variables. The `.env` file on disk contains: `SESSION_SECRET` (JWT signing base), `RESEND_API_KEY` (email service API key `re_H265BHgU_...`), `DATABASE_URL` (PostgreSQL connection string), and `PORTAL_URL` (ngrok tunnel URL). The `.env` file is listed in `.gitignore` and was verified to not be committed to git history. However, the file exists on disk with real production credentials.

There is **no secret rotation mechanism** — changing `SESSION_SECRET` would invalidate all active JWT sessions. JWT secrets are derived from `SESSION_SECRET` by simple string concatenation (`+ "_admin"` / `+ "_client"`) rather than a proper key derivation function (HKDF). The initial admin password is generated via `crypto.randomBytes(12).toString("base64url")` and logged to stdout during first-run seed — acceptable for bootstrapping but the password appears in log aggregation systems.

### Configuration Security

**Security headers** are manually configured in `server/index.ts` (lines 46-61):
- `X-Content-Type-Options: nosniff` ✓
- `X-Frame-Options: DENY` ✓
- `X-XSS-Protection: 1; mode=block` ✓
- `Referrer-Policy: strict-origin-when-cross-origin` ✓
- `Permissions-Policy: camera=(), microphone=(), geolocation=()` ✓
- **HSTS:** `Strict-Transport-Security: max-age=31536000; includeSubDomains` — set in production only (`server/index.ts`, within the security headers middleware block)
- **CSP:** `default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; frame-src https://*.ts.net; connect-src 'self'` — **`unsafe-inline` and `unsafe-eval` significantly weaken XSS protection**

**No infrastructure configuration files exist** — no Nginx, Kubernetes Ingress, CDN settings, Docker, or docker-compose. The entire deployment relies on Replit Autoscale infrastructure (configured in `.replit` file). `Cache-Control` headers are not explicitly configured; Express default behavior applies.

**No CORS middleware** is configured. Since API and SPA are served from the same origin, this is acceptable. The `sameSite: "strict"` cookie attribute provides CSRF protection. No dedicated CSRF token mechanism exists.

### External Dependencies

| Service | Purpose | Credential | Risk |
|---------|---------|-----------|------|
| PostgreSQL | Primary database | `DATABASE_URL` env var | No SSL enforcement on connection |
| Resend | Transactional email | `RESEND_API_KEY` env var | Third-party sees plaintext passwords in welcome emails |
| IP Cameras | Snapshot capture | Per-camera user/pass in DB | Credentials stored plaintext, transmitted in URL query params |
| go2rtc | Live streaming proxy | Stream URL in DB | User-controllable URL → SSRF |
| ffmpeg/ffprobe | Video generation | System binary | `-safe 0` permits arbitrary file reads |
| ngrok | Dev/staging tunnel | `PORTAL_URL` env var | Tunnel URL in `.env` and exposed via system-info endpoint |

Notable unused dependencies that increase attack surface: `passport@0.7.0`, `passport-local@1.0.0`, `openid-client@6.8.1`, `connect-pg-simple@10.0.0`, `express-session@1.19.0`, `memorystore@1.6.7`. The build script's external allowlist (`script/build.ts:7-33`) also references unused packages: `@google/generative-ai`, `axios`, `cors`, `express-rate-limit`, `multer`, `nodemailer`, `openai`, `stripe`, `uuid`, `xlsx`.

### Monitoring & Logging

**Audit logging** is implemented in `server/audit.ts` (lines 1-34) providing structured JSON output to stdout for: login success/failure, logout, account creation/deletion, password changes, camera/capture/timelapse operations. The audit log includes timestamps, IP addresses, user IDs, and action types.

**Request logging** in `server/index.ts` (lines 82-93) logs method, URL, status code, and response time for all requests. Sensitive paths (`/login`, `/change-password`, `/forgot-password`, `/reset-password`) are excluded from response body logging. Camera credential masking is applied in `camera-service.ts:200` (`password=***`). However, when `RESEND_API_KEY` is not set, password reset URLs containing tokens are logged to stdout (`email-service.ts:57`).

---

## 7. Overall Codebase Indexing

The SkyLapse codebase follows a clean monorepo structure with three primary directories: `server/` (backend Express.js application), `client/` (React SPA frontend), and `shared/` (types and database schema shared between server and client). The server directory contains the core application logic organized by concern: `index.ts` (entry point and middleware), `routes.ts` (all REST API route definitions — the single largest file at ~1300 lines), `storage.ts` (database access layer implementing a storage interface), `camera-service.ts` (outbound HTTP requests to cameras — primary SSRF surface), `capture-job.ts` (background image capture), `timelapse-job.ts` (ffmpeg-based video generation), `email-service.ts` (Resend email integration), `audit.ts` (security event logging), and `db.ts` (database connection). A `replit_integrations/auth/` subdirectory contains a complete but unused Replit OIDC authentication implementation. The client directory uses a standard React/Vite structure with `src/components/`, `src/pages/`, `src/hooks/`, and `src/lib/` subdirectories. The `shared/schema.ts` file defines the complete database schema using Drizzle ORM and generates Zod validators via `drizzle-zod` — this is the single source of truth for data models and input validation. Build orchestration uses `script/build.ts` which runs Vite for the client and esbuild for the server, producing a single `dist/index.cjs` bundle. No test framework or test files exist in the codebase. From a security review perspective, the most critical files are concentrated in `server/routes.ts` (all endpoint logic), `server/camera-service.ts` (SSRF surface), and `shared/schema.ts` (data model and validation). The `uploads/` directory stores captured images and generated videos, organized by camera ID and date.

---

## 8. Critical File Paths

### Configuration
- `package.json` — Dependencies, scripts, application metadata
- `tsconfig.json` — TypeScript compiler configuration (strict mode enabled)
- `vite.config.ts` — Client build and dev server configuration
- `drizzle.config.ts` — Database migration configuration
- `.replit` — Replit deployment configuration (autoscale, port mapping)
- `.gitignore` — Git exclusion rules
- `.env` — Runtime secrets (SESSION_SECRET, RESEND_API_KEY, DATABASE_URL, PORTAL_URL) — not tracked in git
- `components.json` — shadcn/ui component configuration

### Authentication & Authorization
- `server/routes.ts` (lines 32-33) — JWT secret derivation
- `server/routes.ts` (lines 36-62) — Rate limiter implementation
- `server/routes.ts` (lines 64-102) — `isAdminAuthenticated` and `isClientAuthenticated` middleware
- `server/routes.ts` (lines 104-113) — `isAnyAuthenticated` middleware
- `server/routes.ts` (lines 846-952) — Login/logout endpoints (admin and client)
- `server/routes.ts` (lines 1202-1314) — Client logout, change-password, forgot-password, reset-password
- `server/routes.ts` (lines 883-888, 935-939) — Cookie flag configuration (httpOnly, Secure, SameSite)
- `server/index.ts` (lines 13-23) — SESSION_SECRET validation at startup
- `server/index.ts` (lines 102-120) — Initial admin seed account creation
- `server/replit_integrations/auth/replitAuth.ts` — Legacy Replit OIDC auth (dead code)
- `server/replit_integrations/auth/routes.ts` — Legacy auth API route

### API & Routing
- `server/routes.ts` — All REST API route definitions (~1300 lines, single file)
- `server/index.ts` — Express app setup, middleware pipeline, server startup
- `server/static.ts` — Production static file serving and SPA catch-all
- `server/vite.ts` — Development Vite middleware integration

### Data Models & DB Interaction
- `shared/schema.ts` — Complete database schema (cameras, clients, captures, timelapses, accounts, access control)
- `server/storage.ts` — Database access layer (all CRUD operations)
- `server/db.ts` — PostgreSQL connection pool configuration
- `drizzle.config.ts` — Drizzle ORM migration configuration

### Dependency Manifests
- `package.json` — Node.js dependencies (includes unused packages: passport, openid-client, etc.)
- `package-lock.json` — Locked dependency versions

### Sensitive Data & Secrets Handling
- `server/email-service.ts` — Resend email integration (sends plaintext passwords in welcome emails)
- `server/camera-service.ts` — Camera credential handling and outbound HTTP requests
- `shared/schema.ts` (lines 42-43) — Plaintext camera credential columns
- `shared/schema.ts` (line 71) — Plaintext reset token storage
- `.env` — Runtime secrets file (not in git)

### Middleware & Input Validation
- `server/routes.ts` (lines 139-153) — `stripCameraCredentials`, `sanitizeFilename`, `isPathSafe` utilities
- `server/routes.ts` (lines 115-137) — `isValidDate`, `toClientCameraDTO` helpers
- `shared/schema.ts` — Zod validation schemas generated via drizzle-zod
- `server/index.ts` (lines 38-44) — Body parsers (JSON with rawBody, URL-encoded)
- `server/index.ts` (lines 46-61) — Security headers middleware

### Logging & Monitoring
- `server/audit.ts` — Security audit logging (structured JSON to stdout)
- `server/index.ts` (lines 82-93) — Request/response logging with sensitive path exclusions

### Infrastructure & Deployment
- `.replit` — Replit autoscale deployment configuration
- `script/build.ts` — Build script (esbuild + Vite)
- `server/index.ts` (lines 124-136) — Server binding configuration (0.0.0.0, port)

### Background Jobs & Processing
- `server/capture-job.ts` — Automatic camera capture (60-second interval, stored SSRF surface)
- `server/timelapse-job.ts` — ffmpeg-based timelapse generation (file path injection surface)

### Client Application
- `client/src/hooks/use-auth.ts` — Client-side auth state management
- `client/src/lib/auth-utils.ts` — Auth utility functions
- `client/src/components/ui/chart.tsx` (line 81) — `dangerouslySetInnerHTML` usage (low risk)

---

## 9. XSS Sinks and Render Contexts

### Network Surface Focus

The SkyLapse client is a React SPA where React's default JSX rendering automatically escapes HTML entities, providing strong baseline XSS protection. The CSP policy (`server/index.ts:55`) allows `unsafe-inline` and `unsafe-eval`, which means any XSS vector that bypasses React's escaping will execute without CSP mitigation.

### Identified XSS Sinks

#### 1. `dangerouslySetInnerHTML` in Chart Component — LOW RISK
- **File:** `client/src/components/ui/chart.tsx`, line 81
- **Context:** HTML Body Context (inline `<style>` tag)
- **Code:** `<style dangerouslySetInnerHTML={{ __html: Object.entries(THEMES).map(([theme, prefix]) => ...) }}`
- **Data flow:** Generates CSS variable declarations from the `THEMES` constant (hardcoded) and `colorConfig` (derived from component props). The data source is developer-defined chart configuration, not user input or API responses.
- **Exploitability:** LOW — requires compromising the chart configuration object, which is statically defined in component source code. However, if chart configuration ever becomes data-driven from API responses, this becomes a CSS injection vector. Combined with `unsafe-inline` in the style CSP directive, injected CSS could exfiltrate data via `url()` values.

#### 2. `location.href` Assignments — INFORMATIONAL (NOT EXPLOITABLE)
- **File:** `client/src/hooks/use-auth.ts`, line 34 — `window.location.href = "/login"`
- **File:** `client/src/lib/auth-utils.ts`, line 15 — `window.location.href = "/api/login"`
- **Context:** URL Context
- **Data flow:** Both use hardcoded string literals, not user-controllable input. No open redirect vulnerability.

#### 3. CSP Weakness Amplifier — MEDIUM RISK
- **File:** `server/index.ts`, lines 53-55
- **CSP directive:** `script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'`
- **Impact:** The `unsafe-inline` directive allows any inline `<script>` tag to execute, and `unsafe-eval` allows `eval()`, `new Function()`, and `setTimeout(string)`. This means if any stored XSS vector is introduced (e.g., through camera names, client names, or other user-supplied text rendered in the UI), the CSP provides zero mitigation. This is not an XSS sink itself but significantly amplifies the impact of any XSS vector found elsewhere.

### Sinks NOT Found (Explicitly Verified)
- **No `innerHTML`, `outerHTML`, `document.write`, `document.writeln`** assignments in client code
- **No `insertAdjacentHTML`, `createContextualFragment`** usage
- **No `eval()`, `Function()`, `setTimeout(string)`, `setInterval(string)`** in client code
- **No jQuery** — the application uses React exclusively
- **No template literal injection** in DOM contexts
- **No server-side template engines** — the server renders no HTML (pure REST API + static file serving)

### Assessment

The XSS attack surface is minimal due to React's built-in escaping. The primary concern is the weak CSP (`unsafe-inline` + `unsafe-eval`) which would fail to contain any XSS that bypasses React. Penetration testers should focus on: (1) stored data rendered without React's escaping (any `dangerouslySetInnerHTML` expansion), (2) DOM-based XSS via URL fragments or query parameters processed by the client-side router, and (3) any future API responses that contain user-controllable HTML rendered in the UI.

---

## 10. SSRF Sinks

### Network Surface Focus

The SkyLapse application has a **significant SSRF attack surface** due to its core functionality of fetching images from user-configured IP cameras. All SSRF sinks require admin authentication to configure but some can be triggered by client-authenticated users or automatically by background jobs.

### Critical SSRF Sinks

#### Sink 1: `fetchRawImage()` — Direct Camera Snapshot Fetch (CRITICAL)
- **File:** `server/camera-service.ts`, line 92
- **Code:** `const response = await fetch(url, { method: 'GET', signal: controller.signal, headers });`
- **Data flow:** Admin creates/updates camera (`POST /api/admin/cameras` at `routes.ts:492` or `PUT /api/admin/cameras/:id` at `routes.ts:611`) with user-supplied `hostname`, `portaHttp`, `usuario`, `senha`, `marca` → values stored in database → `buildSnapshotUrl()` (`camera-service.ts:61`) constructs URL as `http://${hostname}:${portaHttp}/...` → `fetchRawImage()` fetches it
- **`isSafeTarget()` applied:** **NO** — not applied on camera creation, update, or snapshot fetch. Only applied on the test endpoint.
- **Auth required:** Admin to configure; automatic capture job, admin snapshot, and client snapshot all trigger the fetch.
- **Exploitation:** Admin sets `hostname` to `127.0.0.1`, any internal service IP, or cloud metadata endpoints. The server fetches from the target and returns the response body as image data. Response content up to 500 bytes is logged on error (`camera-service.ts:104-105`).

#### Sink 2: `fetchSnapshotFromGo2rtc()` — go2rtc Stream Fetch (CRITICAL)
- **File:** `server/camera-service.ts`, line 137
- **Code:** `const frameUrl = \`${streamUrl.replace(/\\/$/, '')}/api/frame.jpeg?src=${source}\``
- **Data flow:** Admin sets `streamUrl` on camera → stored in database → `fetchSnapshot()` (`camera-service.ts:184-186`) prefers `streamUrl` over hostname → `fetchSnapshotFromGo2rtc()` constructs URL and fetches
- **`isSafeTarget()` applied:** **NO**
- **Auth required:** Admin to configure
- **Exploitation:** Set `streamUrl` to any URL; the server appends `/api/frame.jpeg?src=...` but the base URL is fully attacker-controlled.

#### Sink 3: Automatic Capture Job — Stored/Blind SSRF (CRITICAL)
- **File:** `server/capture-job.ts`, lines 32-39
- **Code:** `const result = await fetchSnapshot({ streamUrl: camera.streamUrl, hostname: camera.hostname, ... });`
- **Data flow:** Camera config stored by admin → every 60 seconds, `runCaptureRound()` iterates ALL cameras and calls `fetchSnapshot()` using stored values → no `isSafeTarget()` check anywhere in this path
- **Auth required:** Admin (to store config); exploitation is then automatic and persistent
- **Exploitation:** This is a **stored/blind SSRF**. The server makes the request and saves the response as a JPEG file, which is then served to authenticated users via the capture endpoints — enabling response exfiltration.

#### Sink 4: `isCompleteUrl()` Bypass (HIGH)
- **File:** `server/camera-service.ts`, lines 47-49, 62-64
- **Code:** `function isCompleteUrl(hostname: string): boolean { return (hostname.startsWith("http://") || hostname.startsWith("https://")) && (hostname.includes("/cgi-bin/") || hostname.includes("?") || hostname.includes("/ISAPI/")); }`
- **When `isCompleteUrl()` returns true, `buildSnapshotUrl()` returns the hostname verbatim (line 64).** An attacker can set `hostname` to any URL containing `?` (e.g., `http://internal-service:8080/secret?anything`) and it will be fetched as-is without any path appended.

#### Sink 5: `testGo2rtcConnection()` — go2rtc Test (HIGH)
- **File:** `server/camera-service.ts`, line 169
- **Code:** `const url = \`${streamUrl.replace(/\\/$/, '')}/api/streams\`; const response = await fetch(url, { signal: controller.signal });`
- **Route:** `POST /api/admin/cameras/test` (`routes.ts:507-518`)
- **`isSafeTarget()` applied:** **YES** — but trivially bypassable (see Sink 7)
- **Auth required:** Admin
- **Exploitation:** Response JSON is parsed and returned to the caller, enabling blind SSRF with partial response reading.

#### Sink 6: `testCameraConnection()` — Camera Test (HIGH)
- **File:** `server/camera-service.ts`, line 92 (via test route)
- **Route:** `POST /api/admin/cameras/test` (`routes.ts:524-549`)
- **`isSafeTarget()` applied:** **YES** — but weak blocklist
- **Auth required:** Admin
- **Exploitation:** Returns base64-encoded response body as "thumbnail" — full response exfiltration for non-image targets.

#### Sink 7: `isSafeTarget()` Blocklist Weaknesses
- **File:** `server/camera-service.ts`, lines 9-29
- **Blocklist:** Only 3 entries: `169.254.169.254`, `metadata.google.internal`, `metadata.internal`
- **Bypasses:**
  - `127.0.0.1`, `localhost`, `[::1]`, `0.0.0.0` — loopback not blocked
  - `10.x.x.x`, `172.16-31.x.x`, `192.168.x.x` — all RFC1918 intentionally allowed
  - `[::ffff:169.254.169.254]` — IPv6-mapped address not blocked
  - `0xa9fea9fe` (hex), `2852039166` (decimal) — alternate IP representations
  - DNS rebinding — attacker domain resolving to metadata IP after check
  - `169.254.170.2` — AWS ECS task metadata endpoint not blocked
  - `100.100.100.200` — Alibaba Cloud metadata not blocked
  - Protocol bypass: non-URL branch (line 25-28) allows any protocol

### Lower Severity SSRF-Related Sinks

#### Sink 8: Resend Email SDK — LOW
- **File:** `server/email-service.ts`, lines 31, 62, 91
- **Outbound HTTPS to `api.resend.com`** via Resend SDK. The `to` field is admin-supplied (email address). Not a traditional SSRF — outbound destination is fixed (Resend API), only the email recipient is user-influenced.

#### Sink 9: Replit OIDC Discovery — LOW (Dead Code)
- **File:** `server/replit_integrations/auth/replitAuth.ts`, line 13
- **OIDC discovery fetch** using `ISSUER_URL` env var. Not user-exploitable unless environment variables are controlled.

#### Sink 10: Open Redirect via Host Header — MEDIUM (Dead Code)
- **File:** `server/replit_integrations/auth/replitAuth.ts`, lines 123-128
- **`res.redirect()` using `req.hostname`** from the `Host` header. With `trust proxy` enabled (line 64), an attacker can manipulate the redirect destination. This is not an SSRF but an open redirect. Currently dead code (auth not initialized).

#### Sink 11: ffmpeg Concat Demuxer — MEDIUM (Stored)
- **File:** `server/timelapse-job.ts`, lines 89-93, 102-116
- **`-safe 0` flag** tells ffmpeg to accept absolute paths. `imagemPath` values from the database are written into the concat list file. Currently server-generated, but if database records are manipulated, ffmpeg could read arbitrary files. The file must exist (`fs.existsSync` check at line 70).

#### Sink 12: Host Header Injection in OIDC Strategy — MEDIUM (Dead Code)
- **File:** `server/replit_integrations/auth/replitAuth.ts`, lines 93, 106-107
- **`req.hostname`** used to build OIDC callback URL and select Passport strategy. With `trust proxy`, an attacker could register strategies for arbitrary domains. Dead code — not initialized.

### Assessment

The SSRF attack surface is the **most critical security concern** in this application. The core design pattern (server fetches from admin-configured URLs) creates inherent SSRF risk. The primary mitigation (`isSafeTarget()`) is only applied on the test endpoint, not on camera creation/update or actual fetches. The blocklist approach is fundamentally insufficient — it misses loopback addresses, IPv6 representations, alternate IP encodings, and DNS rebinding. Penetration testers should prioritize: (1) testing SSRF via camera creation with internal/metadata hostnames, (2) testing `isSafeTarget()` bypasses on the test endpoint, (3) verifying response exfiltration via saved capture files, and (4) probing the `isCompleteUrl()` bypass for arbitrary URL fetching.
