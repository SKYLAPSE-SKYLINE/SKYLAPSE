# Injection Analysis Report (SQLi & Command Injection)

## 1. Executive Summary

- **Analysis Status:** Complete
- **Target:** SkyLapse IP Camera Management Platform — `http://host.docker.internal:3000`
- **Key Outcome:** No SQL injection vulnerabilities were found. Two SSRF vulnerabilities (one stored, one interactive) were confirmed as externally exploitable with admin credentials. All Command Injection, Path Traversal, SSTI, and Deserialization surfaces were traced and confirmed safe. All findings have been passed to the exploitation phase via the machine-readable queue at `deliverables/injection_exploitation_queue.json`.
- **Purpose of this Document:** This report provides the strategic context, dominant patterns, and environmental intelligence necessary to effectively exploit the vulnerabilities listed in the queue. It is intended to be read alongside the JSON deliverable.

---

## 2. Dominant Vulnerability Patterns

### Pattern A: SSRF via Unsanitized Camera URL Fields
- **Description:** Admin-configurable camera fields (`hostname`, `streamUrl`, `portaHttp`) accept arbitrary string/integer values with no URL validation, blocklist checks, or scheme restriction at storage time. These values are subsequently used as targets for outbound HTTP fetches via Node.js `fetch()` calls in `camera-service.ts`. The lack of validation at creation/update time means any stored malicious URL will be fetched automatically every 60 seconds by the background capture job, and also on demand via snapshot endpoints.
- **Implication:** An authenticated admin can pivot the server to probe internal network services, reach cloud metadata endpoints (IMDS), or make the server issue arbitrary HTTP requests to attacker-controlled hosts. The SSRF is "semi-blind" for the automated loop (response saved as JPEG file) but fully non-blind for the snapshot and test endpoints (response returned directly).
- **Representative:** INJ-VULN-01 (Stored SSRF), INJ-VULN-02 (Test Endpoint SSRF)

### Pattern B: Insufficient Blocklist Defense
- **Description:** The only SSRF guard in the application is `isSafeTarget()` (`server/camera-service.ts:15-29`), a 3-entry blocklist covering only `169.254.169.254`, `metadata.google.internal`, and `metadata.internal`. This is only applied to the `POST /api/admin/cameras/test` endpoint — not to camera creation/update, snapshot endpoints, or the background capture loop. The blocklist bypasses include `localhost`, `127.0.0.1`, `0.0.0.0`, all RFC1918 ranges (`10.x`, `172.16.x`, `192.168.x`), IPv6 loopback (`[::1]`), and many IMDS bypasses (decimal IP, hex IP, IPv6-mapped IPv4).
- **Implication:** Even the "protected" test endpoint can be used to probe internal LAN services and port-scan internal infrastructure.
- **Representative:** INJ-VULN-02

---

## 3. Strategic Intelligence for Exploitation

### Defensive Evasion (WAF Analysis)
- No WAF detected. Standard response headers present (`X-Content-Type-Options`, `X-Frame-Options`, `X-XSS-Protection`, `CSP`). No WAF-specific headers observed.
- All SSRF payloads should go through without filtering.

### Authentication Prerequisite
- Both SSRF vulnerabilities require **admin authentication** (`skylapse-admin-token` JWT cookie).
- **JWT Secret Weakness (Critical):** `ADMIN_JWT_SECRET = SESSION_SECRET + "_admin"`. In development, `SESSION_SECRET` defaults to the hardcoded literal `"skylapse-dev-secret-insecure"`. If this default is in use, admin tokens can be forged without valid credentials. Check the environment for this default.
- If admin credentials cannot be obtained via credential stuffing or token forgery, escalation path requires first obtaining valid admin credentials.

### SSRF-1 (Stored SSRF) — Exploitation Strategy
- **Primary trigger:** `GET /api/admin/cameras/:id/snapshot` — immediately returns the SSRF response as image data. Fast, on-demand, full response visible.
- **Secondary trigger:** Background capture job (60-second loop) — stores SSRF response as JPEG under `uploads/captures/{cameraId}/{date}/`. Accessible via `GET /api/captures/{cameraId}/{date}/{filename}` (any authenticated user).
- **Client-side trigger:** `GET /api/client/cameras/:id/snapshot` triggers same fetch if client has camera access.
- **URL Construction Bypass:** If `hostname` starts with `http://` or `https://` AND contains `/cgi-bin/`, `?`, or `/ISAPI/` in the path, `isCompleteUrl()` returns `true` and the value is passed verbatim to `fetch()`. Example: `http://169.254.169.254/cgi-bin/` bypasses the normal hostname reconstruction.
- **`streamUrl` Path:** Stored `streamUrl` is appended with `/api/frame.jpeg?src=...` in `fetchSnapshotFromGo2rtc()` — so the attacker controls the base URL prefix.
- **Recommended starting payload:** `hostname: "http://169.254.169.254/cgi-bin/"` (passes `isCompleteUrl()`, fetched verbatim, reaches IMDS on AWS/GCP).

### SSRF-2 (Test Endpoint) — Exploitation Strategy
- **Direct exfiltration:** `POST /api/admin/cameras/test` returns the base64-encoded HTTP response body inline in the JSON response (`imagem` field). Full response body is immediately available.
- **Blocklist bypasses:** `127.0.0.1`, `localhost`, `0.0.0.0`, `10.0.0.1`, `192.168.1.1`, `[::1]`, `169.254.170.2` (AWS ECS task metadata), `100.100.100.200` (Alibaba Cloud metadata).
- **Recommended starting payloads:** `{"hostname": "127.0.0.1", "portaHttp": 3000}` — tests loopback access; `{"hostname": "0.0.0.0", "portaHttp": 80}` — alternative loopback.

### Confirmed Database Technology
- **PostgreSQL 16** — confirmed from recon (`DATABASE_URL` env var, pg driver, `gen_random_uuid()` function, table definitions).
- Relevant for any time-based or error-based probes (though no SQLi was found).

---

## 4. Vectors Analyzed and Confirmed Secure

These input vectors were traced and confirmed to have robust, context-appropriate defenses. They are **low-priority** for further testing.

| **Source (Parameter/Key)** | **Endpoint/File Location** | **Defense Mechanism Implemented** | **Verdict** |
|-----------------------------|----------------------------|-----------------------------------|-------------|
| `fps` (integer) | `POST /api/admin/timelapses` → `timelapse-job.ts:107` | Zod `z.number().int()` validates as integer; `execFileAsync` uses array args (no shell); integer type cannot escape ffmpeg filter syntax via shell | SAFE |
| `imagemPath` (DB field) | `timelapse-job.ts:90` → ffmpeg concat list | Server-generated path only (`capture-job.ts:56`); no HTTP endpoint accepts user-supplied `imagemPath`; concat file injection not reachable from external attacker | SAFE |
| All DB queries (ORM layer) | `server/storage.ts` (all functions) | Drizzle ORM 0.39.3 + node-postgres use parameterized queries (`eq()`, `gte()`, `lte()`, `inArray()`, `.values()`); no string concatenation into SQL | SAFE |
| Raw `sql\`...\`` at `storage.ts:450-458` | `GET /api/admin/dashboard-extra` | SQL template literal contains no user-controlled values; hardcoded 7-day aggregation query only | SAFE |
| `dataInicio` / `dataFim` (query params) | `GET /api/client/cameras/:id/captures`, `GET /api/client/cameras/:id/captures/download` | Missing `isValidDate()` allows `Invalid Date` objects to reach ORM, but Drizzle still parameterizes these as bound values; SQL injection is prevented; behavioral anomaly only | SAFE (SQLi) |
| URL path after `/api/captures/` | `GET /api/captures/**` → `express.static("uploads/captures")` | Express.static normalizes `../` sequences and rejects paths outside root directory; auth checked before static middleware | SAFE |
| URL path after `/api/videos/` | `GET /api/videos/**` → `express.static("uploads/videos")` | Same as captures | SAFE |
| `capture.imagemPath` (DB field) | File ops: `fs.unlinkSync`, `fs.createReadStream`, `archive.file` at multiple routes | `isPathSafe()` resolves and prefix-checks against `uploads/` before all file operations; paths are server-generated, not user-supplied | SAFE |
| `timelapse.videoPath` (DB field) | `fs.unlinkSync` at `routes.ts:701` | `isPathSafe()` applied; path generated from auto-generated UUID | SAFE |
| `email` / `senha` | `POST /api/admin/login`, `POST /api/client/login` | Zod validates format; DB lookup via ORM parameterized query; bcrypt comparison | SAFE |
| `token` | `POST /api/client/reset-password` | 64-char hex token looked up via `eq(clientAccounts.resetToken, token)` — parameterized; 1-hour TTL | SAFE |
| `nome`, `cidade`, `estado`, `pais` | `POST /api/admin/locations`, `POST /api/admin/clients`, etc. | Drizzle ORM `.values()` — parameterized inserts | SAFE |
| Email templates | `server/email-service.ts` | `escapeHtml()` applied to all user-supplied values; no template engine used (pure string building) | SAFE (SSTI) |
| ffmpeg/ffprobe invocations | `server/timelapse-job.ts:102-116, 139` | `execFileAsync()` with array arguments and no `shell: true` option; no user input in command arrays | SAFE (CMDi) |

---

## 5. Analysis Constraints and Blind Spots

### Limited SSRF Depth Analysis
- The exact behavior when `hostname` is set to an SSRF payload was not live-tested. The code path analysis is definitive for the vulnerability structure, but the specific internal network topology accessible via SSRF is unknown without live exploitation.

### JWT Secret in Production
- Whether the default `"skylapse-dev-secret-insecure"` secret is in use in the deployed instance is not determinable via static analysis alone. If it is, admin token forgery would be trivially possible and the SSRF vulnerabilities would become exploitable without any credential theft.

### Background Capture Job Timing
- The 60-second background capture loop stores SSRF responses as JPEG files. The exact filename format is `{cameraId}_{timestamp}.jpg` under `uploads/captures/{cameraId}/{YYYY-MM-DD}/`. Enumerating these requires knowing the camera UUID and approximate timestamp — both derivable after camera creation.

### `isPathSafe()` Theoretical Weakness
- `isPathSafe()` uses `startsWith(UPLOADS_DIR)` without appending `path.sep`, meaning a sibling directory `uploads-evil/` would pass the check. However, since file paths are entirely server-generated and no HTTP endpoint allows writing arbitrary paths to the database, this weakness is not externally exploitable in the current code.
