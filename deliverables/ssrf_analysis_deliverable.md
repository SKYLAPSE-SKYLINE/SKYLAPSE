# SSRF Analysis Report — SkyLapse IP Camera Management Platform

## 1. Executive Summary

- **Analysis Status:** Complete
- **Key Outcome:** Four high-confidence server-side request forgery vulnerabilities were identified across two root causes: (1) a nearly useless three-entry blocklist on the camera-test endpoint that leaves all private IP ranges and localhost unblocked, and (2) a complete absence of any SSRF guard on the camera creation/update pipeline and all snapshot/capture trigger paths. Together these allow an authenticated attacker to force the application server to make outbound HTTP requests to arbitrary internal services, cloud metadata endpoints, or any reachable host on the server's network.
- **Purpose of this Document:** This report provides the strategic context on the application's outbound request mechanisms, dominant flaw patterns, and key architectural details necessary to effectively exploit the vulnerabilities listed in the exploitation queue.

---

## 2. Dominant Vulnerability Patterns

### Pattern 1: Absent SSRF Guard on Stored-URL Trigger Paths

- **Description:** Camera objects in the database store a `hostname` and/or `streamUrl` value that are accepted via `POST /api/admin/cameras` and `PUT /api/admin/cameras/:id` with no URL validation whatsoever (`insertCameraSchema` enforces only `z.string()`). These stored values are then passed directly to outbound `fetch()` calls by three separate trigger paths — the admin snapshot endpoint, the client snapshot endpoint, and the automated 60-second capture job — none of which invoke `isSafeTarget()` or any other check before making the request.
- **Implication:** Any attacker who can create or update a camera record (admin auth required) can plant an arbitrary URL that the server will persistently fetch against on demand and on a 60-second schedule, effectively turning the application into a persistent HTTP proxy to internal services.
- **Representative Findings:** `SSRF-VULN-02`, `SSRF-VULN-03`, `SSRF-VULN-04`

### Pattern 2: Insufficient Blocklist on Camera-Test Endpoint

- **Description:** The only endpoint where `isSafeTarget()` is applied is `POST /api/admin/cameras/test`. The blocklist contains exactly three entries: `169.254.169.254`, `metadata.google.internal`, and `metadata.internal`. All other dangerous destinations are unblocked: `localhost`, `127.0.0.1`, `[::1]`, `0.0.0.0`, any RFC 1918 address (10.x, 172.16–31.x, 192.168.x), `169.254.170.2` (AWS ECS Task Metadata), `100.100.100.200` (Alibaba Cloud), IPv6-mapped IPv4 addresses, and octal/decimal IP encodings.
- **Implication:** An attacker with admin credentials can immediately probe any port on the application server itself or any host on the server's network, and the full response body is base64-encoded and returned to the caller — making this a **non-blind** SSRF with immediate response exfiltration.
- **Representative Finding:** `SSRF-VULN-01`

---

## 3. Strategic Intelligence for Exploitation

- **HTTP Client Library:** Node.js global `fetch` (undici, built-in since Node 18) used in all outbound request paths. No proxy configuration detected. 15-second abort timeout on all calls.
- **Request Architecture:**
  - **Path A (go2rtc stream mode):** `streamUrl` → `fetchSnapshotFromGo2rtc()` → `fetch(\`${streamUrl}/api/frame.jpeg?src=...\`)` at `camera-service.ts:137`. Pure string concatenation; zero validation.
  - **Path B (direct hostname mode):** `hostname` → `isCompleteUrl()` check → if URL contains `?`, `/cgi-bin/`, or `/ISAPI/`, the raw value is returned verbatim to `fetchRawImage()` at `camera-service.ts:92` with no further processing. Otherwise, `cleanHostname()` strips the protocol prefix and constructs `http://{host}:{portaHttp}/cgi-bin/api.cgi?...`.
  - **`isCompleteUrl()` bypass:** Setting `hostname = "http://127.0.0.1:6379/?ping"` satisfies the `?` check, causing the raw string to be passed directly to `fetch()` — allowing any host:port combination to be targeted.
  - **Capture job:** `server/capture-job.ts:32-39` calls `fetchSnapshot()` every 60 seconds for every camera in the database regardless of camera status (with a 5-minute backoff for offline cameras). No SSRF guard in the job.
- **Internal Services of Interest:**
  - PostgreSQL on `127.0.0.1:5432` (TCP — unlikely to yield HTTP responses but detectable by timeout vs. connection-refused distinction)
  - Replit infrastructure endpoints potentially accessible on internal ranges
  - Any other services on the Docker/container internal network (`host.docker.internal` and adjacent addresses)
- **Response Exfiltration Mechanism:**
  - **Camera-test endpoint:** Base64-encoded response body returned inline in JSON response — immediate non-blind read.
  - **Snapshot endpoints:** Response binary returned as HTTP body with `Content-Type: image/jpeg`.
  - **Capture job:** Response saved to disk at `uploads/captures/{cameraId}/{date}/{filename}.jpg`, then accessible unauthenticated... wait — via `/api/captures/**` with `isAnyAuthenticated` guard. Any authenticated user can retrieve the file by constructing the path.
- **Authentication Barrier:** All SSRF-triggering endpoints require either admin or client JWT authentication. The application seeds a default admin account (`server/index.ts:102-120`). The development JWT secret is the hardcoded literal `"skylapse-dev-secret-insecure"`.

---

## 4. Detailed Vulnerability Traces

### SSRF-VULN-01 — Camera Test Endpoint: Weak Blocklist Bypass (Non-Blind)

**Source:** `POST /api/admin/cameras/test` — `streamUrl` or `hostname` POST body fields.

**Sink:** `server/camera-service.ts:169` (`fetch(url)` in `testGo2rtcConnection`) or `server/camera-service.ts:92` (`fetch(url)` in `fetchRawImage`).

**Sanitizer Encountered:** `isSafeTarget()` at `server/routes.ts:512` (streamUrl) and `server/routes.ts:523` (hostname).

**Sanitizer Analysis:**
```
BLOCKED_HOSTS = { "169.254.169.254", "metadata.google.internal", "metadata.internal" }
```
Not blocked: `localhost`, `127.0.0.1`, `[::1]`, `0.0.0.0`, any RFC1918 address, `169.254.170.2`, `100.100.100.200`, IPv6-mapped addresses, octal encodings.

**Data Flow (streamUrl path):**
```
POST /api/admin/cameras/test
  body.streamUrl
    → isSafeTarget(streamUrl) → passes for localhost/127.0.0.1/RFC1918
      → testGo2rtcConnection(streamUrl)               [routes.ts:515]
        → url = `${streamUrl}/api/streams`             [camera-service.ts:164]
          → fetch(url)                                  [camera-service.ts:169]
            → response.json() returned to caller        [routes.ts:516]
```

**Data Flow (hostname path):**
```
POST /api/admin/cameras/test
  body.hostname
    → isSafeTarget(hostname) → passes for localhost/127.0.0.1/RFC1918
      → testCameraConnection({hostname, portaHttp, ...})  [routes.ts:527]
        → fetchSnapshot(config)                            [camera-service.ts:204]
          → buildSnapshotUrl(config)                       [camera-service.ts:193]
            → isCompleteUrl(hostname) → if URL contains ?  [camera-service.ts:47-49]
              → returns hostname verbatim                   [camera-service.ts:64]
            → OR constructs http://{clean_host}:{portaHttp}/cgi-bin/...
          → fetchRawImage(url)                             [camera-service.ts:201]
            → fetch(url)                                   [camera-service.ts:92]
              → imageBuffer returned as base64 to caller   [routes.ts:536-540]
```

**Witness Payload:** `{"streamUrl": "http://127.0.0.1:5432/"}` → server connects to PostgreSQL, returns partial TCP data as base64.

---

### SSRF-VULN-02 — Stored SSRF via Admin Snapshot Trigger

**Source:** `POST /api/admin/cameras` or `PUT /api/admin/cameras/:id` — `hostname`/`streamUrl` fields stored in DB.

**Trigger:** `GET /api/admin/cameras/:id/snapshot` — fetches camera from DB and calls `fetchSnapshot()` without SSRF guard.

**Sink:** `server/camera-service.ts:92` or `server/camera-service.ts:137`.

**Data Flow:**
```
POST /api/admin/cameras
  body.hostname / body.streamUrl
    → insertCameraSchema.parse(req.body)  [routes.ts:494] — z.string() only, no URL validation
      → storage.createCamera(data)        [routes.ts:495] — stored in cameras table

GET /api/admin/cameras/:id/snapshot
  → storage.getCamera(req.params.id)     [routes.ts:582]
    → fetchSnapshot({streamUrl: camera.streamUrl, hostname: camera.hostname, ...})  [routes.ts:587]
      → NO isSafeTarget() call
        → fetchSnapshotFromGo2rtc(streamUrl) [camera-service.ts:186]
          → fetch(`${streamUrl}/api/frame.jpeg?src=camera1_hd`) [camera-service.ts:137]
        OR
        → buildSnapshotUrl(config)           [camera-service.ts:193]
          → fetch(url)                       [camera-service.ts:92]
            → imageBuffer returned as HTTP body [routes.ts:600]
```

---

### SSRF-VULN-03 — Stored SSRF via Client Snapshot Trigger

**Source:** Same as SSRF-VULN-02 (admin-set camera URL stored in DB).

**Trigger:** `GET /api/client/cameras/:id/snapshot` — client user triggers fetch on admin-configured camera.

**Authorization:** Checks only that camera ID is in client's allowed list — does NOT validate camera's `hostname`/`streamUrl`.

**Data Flow:**
```
GET /api/client/cameras/:id/snapshot
  → allowedIds = storage.getClientCameraIds(clientAccountId)  [routes.ts:1175]
    → allowedIds.includes(req.params.id)  [routes.ts:1176] — camera ownership only
      → storage.getCamera(req.params.id)  [routes.ts:1179]
        → fetchSnapshot({streamUrl: camera.streamUrl, hostname: camera.hostname, ...})  [routes.ts:1181]
          → NO isSafeTarget() call
            → fetch() at camera-service.ts:92 or 137
              → imageBuffer returned as HTTP body [routes.ts:1192]
```

---

### SSRF-VULN-04 — Stored SSRF via Automated Capture Job

**Source:** Same admin-set camera URL in DB.

**Trigger:** Automated 60-second interval capture job — no user interaction required post-creation.

**Data Flow:**
```
startCaptureJob() → setInterval(runCaptureRound, 60000)   [capture-job.ts:147]
  → storage.getCameras()                                   [capture-job.ts:107]
    → for each camera with streamUrl or hostname:
      → captureCamera(camera)                              [capture-job.ts:128]
        → fetchSnapshot({streamUrl, hostname, ...})        [capture-job.ts:32]
          → NO isSafeTarget() call
            → fetch() at camera-service.ts:92 or 137
              → result.imageBuffer written to disk         [capture-job.ts:57]
                → accessible via GET /api/captures/**      [routes.ts:160]
```

**Exfiltration:** Response bytes written to `uploads/captures/{cameraId}/{date}/{filename}.jpg` and served via `/api/captures/**` (requires `isAnyAuthenticated` — any valid token).

---

## 5. Secure by Design: Validated Components

These components were analyzed and found to have no SSRF exposure:

| Component/Flow | Endpoint/File Location | Defense Mechanism Implemented | Verdict |
|---|---|---|---|
| Password Reset Email | `server/email-service.ts` → `api.resend.com` | Hardcoded destination (Resend SDK); no user input influences the destination host | SAFE |
| Static File Serving | `/api/captures/**`, `/api/videos/**` (`server/routes.ts:160-161`) | `express.static` built-in path traversal protection; destination is always filesystem, not network | SAFE (no SSRF surface) |
| ffmpeg Invocation | `server/timelapse-job.ts` | `execFile` (not `exec`) prevents shell injection; destination is filesystem concat list, not network | SAFE (no SSRF surface) |
| Database Access | `server/storage.ts` | All queries via Drizzle ORM parameterized helpers; connection string from env var, not user input | SAFE (no SSRF surface) |
| JWT Verification | `server/routes.ts:64-132` | Uses `jsonwebtoken.verify()` with fixed secret; no outbound requests made | SAFE |

---

## 6. isSafeTarget() Bypass Reference

The `isSafeTarget()` function at `server/camera-service.ts:15-29` is the only SSRF control in the codebase. It is applied **only** at `POST /api/admin/cameras/test`. Even where applied, the following inputs bypass it:

| Bypass Technique | Example Input | Result |
|---|---|---|
| Localhost by name | `http://localhost:80/` | Not in BLOCKED_HOSTS → passes |
| Loopback IP | `http://127.0.0.1:22/` | Not in BLOCKED_HOSTS → passes |
| IPv6 loopback | `http://[::1]:80/` | Not in BLOCKED_HOSTS → passes |
| All-zeros address | `http://0.0.0.0:80/` | Not in BLOCKED_HOSTS → passes |
| RFC1918 Class A | `http://10.0.0.1:80/` | Not in BLOCKED_HOSTS → passes |
| RFC1918 Class B | `http://172.16.0.1:80/` | Not in BLOCKED_HOSTS → passes |
| RFC1918 Class C | `http://192.168.1.1:80/` | Not in BLOCKED_HOSTS → passes |
| AWS ECS metadata | `http://169.254.170.2/` | Not in BLOCKED_HOSTS → passes |
| Alibaba metadata | `http://100.100.100.200/` | Not in BLOCKED_HOSTS → passes |
| IPv6-mapped IPv4 | `http://[::ffff:169.254.169.254]/` | hostname = `::ffff:169.254.169.254`, not in BLOCKED_HOSTS → passes |
| isCompleteUrl() bypass | hostname = `http://127.0.0.1:6379/?ping` | Contains `?` → used verbatim, no host/port check |

---

## 7. Methodology Coverage Summary

| Methodology Check | Result |
|---|---|
| 1. HTTP Client Usage Patterns | ✅ Traced all user-input-to-fetch() paths |
| 2. Protocol and Scheme Validation | ❌ Only `http:`/`https:` validated in isSafeTarget(); applied to test endpoint only; creation/snapshot paths have no check |
| 3. Hostname and IP Address Validation | ❌ Only 3 hosts blocked; localhost/RFC1918 completely unblocked |
| 4. Port Restriction | ❌ No port restrictions; any port reachable via hostname:port or isCompleteUrl() bypass |
| 5. URL Parsing Bypass | ❌ isCompleteUrl() returns verbatim URL for `?`-containing hostnames; no parsing normalization |
| 6. Request Modification / Headers | No sensitive header injection found; credentials added programmatically from DB, not from user input |
| 7. Response Handling | ❌ Full response body returned at test endpoint (non-blind); responses saved to disk at capture job (semi-blind) |
