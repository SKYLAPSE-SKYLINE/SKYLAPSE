# Cross-Site Scripting (XSS) Analysis Report

## 1. Executive Summary

- **Analysis Status:** Complete
- **Key Outcome:** Three high-confidence Stored XSS vulnerabilities were identified and confirmed with live execution proof-of-concept. All findings have been passed to the exploitation phase via `deliverables/xss_exploitation_queue.json`.
- **Purpose of this Document:** This report provides strategic context, dominant vulnerability patterns, environmental intelligence (CSP, cookie flags), and a complete list of analyzed input vectors for the exploitation phase.

**Vulnerability Counts:**
| Type | Count | Confirmed Execution |
|------|-------|---------------------|
| Stored XSS | 3 | Yes (all three) |
| Reflected XSS | 0 | N/A |
| DOM-based XSS | 0 | N/A |

---

## 2. Dominant Vulnerability Patterns

### Pattern 1: Unvalidated URL Field (`streamUrl`) Used Directly in Anchor `href` and Iframe `src`

**Description:** The `streamUrl` field in the `cameras` database table accepts any string value — including `javascript:` URIs — because neither the server-side Zod schema (`insertCameraSchema` in `shared/schema.ts`) nor the client-side forms apply any URL scheme validation. This field is subsequently rendered **without sanitization** in two distinct dangerous HTML sink types across both the admin and client interfaces:

1. As an `<a href={…}>` attribute (settings.tsx line 332-335) — click-triggered XSS
2. As an `<iframe src={…}>` attribute (camera-live.tsx line 124-129 and cliente/dashboard.tsx line 93-100) — auto-triggered XSS upon stream activation

**Root Cause:** `insertCameraSchema` is derived from the Drizzle ORM table definition via `createInsertSchema`, which generates only `z.string()` for text columns. No `.url()`, `.startsWith("https://")`, regex constraint, or scheme allowlist exists anywhere in the stack.

**Implication:** A single admin account compromise allows an attacker to inject a `javascript:` payload into any camera's `streamUrl` field via the REST API, which then persists in the database and executes silently in the browsers of every admin or client user who subsequently visits affected pages.

**Representative Findings:** XSS-VULN-01, XSS-VULN-02, XSS-VULN-03.

---

## 3. Strategic Intelligence for Exploitation

### 3.1 Content Security Policy (CSP) Analysis

**Live CSP Header:**
```
Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; frame-src 'self' https://*.ts.net; connect-src 'self' https://*.ts.net; font-src 'self' data:;
```

**Critical Analysis:**
- **`script-src 'unsafe-inline' 'unsafe-eval'`**: The CSP offers no meaningful protection against inline script execution. Any injected `<script>` tag or `javascript:` URI will execute freely.
- **`frame-src 'self' https://*.ts.net`**: This directive was tested against `javascript:` URIs in `<iframe src>`. Chromium **does NOT block** `javascript:` URIs under this directive — the URI executes and fires the alert dialog. Confirmed live.
- **`javascript:` in `<a href>`**: The `script-src` directive does not restrict anchor `href` navigation. `javascript:` URIs in `<a href>` execute upon user click regardless of CSP.
- **Overall CSP Assessment:** The CSP provides essentially zero protection. `'unsafe-inline'` and `'unsafe-eval'` make the policy trivially bypassable for any injected content.

### 3.2 Cookie Security Analysis

**Session Cookie Flags (confirmed from `server/routes.ts:883-888` and `:935-940`):**
```
httpOnly: true
SameSite: strict
secure: true (production only; false in development)
```

**Critical Notes for Exploitation:**
- **`httpOnly: true`**: The session cookies (`skylapse-admin-token`, `skylapse-client-token`) are NOT accessible via `document.cookie`. Direct cookie theft is not possible.
- **`SameSite: strict`**: Cross-site request forgery is mitigated, but **XSS bypasses SameSite entirely** because injected JavaScript runs same-origin and can make authenticated API calls directly using the browser's existing cookies.
- **Exploitation path**: Use the XSS to make authenticated API calls (`fetch('/api/admin/...')`) in the victim's session context to exfiltrate data (camera credentials, client PII) or escalate privileges (create new admin accounts, modify camera configurations).

### 3.3 JWT Secret Exposure

**Development JWT Secret:** `SESSION_SECRET=RK7hv4GWJ9_fs6LSg6LEBSH_k29c1qFy2DfPjbawbRWsDpJ6kNK3ARHf2xuQgft3`
- Admin JWT secret: `SESSION_SECRET + "_admin"`
- Client JWT secret: `SESSION_SECRET + "_client"`
- This allows token forgery for any known account ID, used in this analysis to obtain admin access for test setup.

### 3.4 React 18 Warning — Not a Block

When a `javascript:` URI is passed to an `<iframe src>`, React 18 logs:

> `Warning: A future version of React will block javascript: URLs as a security precaution.`

**This is a warning only.** React 18 does NOT block the URL. The iframe src is set and the script executes. Only a future React version will block this.

---

## 4. Confirmed Vulnerability Details

### XSS-VULN-01: Stored XSS — `streamUrl` → `<a href>` — Admin Settings Page

| Field | Value |
|-------|-------|
| ID | XSS-VULN-01 |
| Type | Stored XSS |
| Source | `cameras.streamUrl` DB field (set via `POST /api/admin/cameras` or `PUT /api/admin/cameras/:id`) |
| Sink | `<a href={\`${cam.streamUrl}/\`}>` in `settings.tsx:332-335` |
| Render Context | HTML_ATTRIBUTE (href) |
| Encoding | None |
| Verdict | **Vulnerable** |
| Confidence | **High** |

**Data Flow:** `POST /api/admin/cameras` → `insertCameraSchema.parse(req.body)` (z.string() only) → stored in `cameras.streamUrl` → `GET /api/admin/system-info` returns `{cameras: [{streamUrl},...]}` → `settings.tsx` renders `` <a href={`${cam.streamUrl}/`}> `` → click executes `javascript:` payload

**Witness Payload:** `javascript:alert(document.domain)//`
**Rendered href:** `javascript:alert(document.domain)///` (appended `/` from template)
**Execution proof:** Alert dialog appeared with message `"host.docker.internal"` confirming code execution in the application's domain context.

---

### XSS-VULN-02: Stored XSS — `streamUrl` → `<iframe src>` — Admin Camera Live Page

| Field | Value |
|-------|-------|
| ID | XSS-VULN-02 |
| Type | Stored XSS |
| Source | `cameras.streamUrl` DB field |
| Sink | `<iframe src={liveStreamUrl}>` in `camera-live.tsx:124-129` |
| Render Context | HTML_ATTRIBUTE (src of iframe) |
| Encoding | None |
| Verdict | **Vulnerable** |
| Confidence | **High** |

**Data Flow:** `cameras.streamUrl` in DB → `GET /api/admin/cameras/:id` → `camera-live.tsx` computes `liveStreamUrl = \`${streamUrl.replace(/\/$/, "")}/stream.html?src=camera1&mode=mse\`` → rendered as `<iframe src={liveStreamUrl}>` when admin activates stream → `javascript:` URI executes

**Witness Payload:** `javascript:alert(document.domain)//`
**Rendered iframe src:** `javascript:alert(document.domain)//stream.html?src=camera1&mode=mse`
**Trigger:** Admin visits `/admin/cameras/{id}/live`, clicks "Ao Vivo", clicks "Iniciar transmissão"
**Execution proof:** Alert dialog appeared with message `"host.docker.internal"`.
**React warning observed** (non-blocking): `"A future version of React will block javascript: URLs as a security precaution."`

---

### XSS-VULN-03: Stored XSS — `streamUrl` → `<iframe src>` — Client Dashboard (HIGH IMPACT)

| Field | Value |
|-------|-------|
| ID | XSS-VULN-03 |
| Type | Stored XSS |
| Source | `cameras.streamUrl` DB field (controlled by admin, executed in client context) |
| Sink | `<iframe src={liveStreamUrl}>` in `cliente/dashboard.tsx:93-100` |
| Render Context | HTML_ATTRIBUTE (src of iframe) |
| Encoding | None |
| Verdict | **Vulnerable** |
| Confidence | **High** |

**Data Flow:** Admin stores malicious `streamUrl` → client's camera access via `clientCameraAccess` table → `GET /api/client/cameras` → `cliente/dashboard.tsx` LiveDialog computes `liveStreamUrl = \`${camera.streamUrl.replace(/\/$/, "")}/stream.html?src=camera1&mode=mse\`` → `<iframe src={liveStreamUrl}>` rendered when client activates stream → executes in client's browser session

**Witness Payload:** `javascript:alert(document.domain)//`
**Trigger:** Client visits dashboard, opens "Ao Vivo" dialog on any assigned camera, clicks "Iniciar transmissão"
**Execution proof:** Alert dialog appeared with message `"host.docker.internal"`.
**Impact Escalation:** Admin → Client privilege chain. Admin sets payload, all clients with that camera assigned are affected.

---

## 5. Vectors Analyzed and Confirmed Secure

These input vectors were traced and confirmed to have sufficient defenses or non-exploitable data flows.

| Source (Parameter/Key) | Endpoint/File Location | Defense Mechanism | Render Context | Verdict |
|------------------------|------------------------|-------------------|----------------|---------|
| `camera.nome`, `location.nome`, `client.nome` | All list/detail views | React JSX text node (automatic HTML entity escaping) | HTML_BODY | SAFE |
| `timelapse.videoUrl` | `timelapses.tsx:202, 396` | Server-generated path (`/api/videos/...`) — excluded from `insertTimelapseSchema`, never user-supplied | HTML_ATTRIBUTE (href/src) | SAFE (no user-control) |
| `capture.imagemUrl` | `camera-gallery.tsx:174`, `camera-captures.tsx:184` | Server-generated path (`/api/captures/...`) — set by capture job, not user input | HTML_ATTRIBUTE (src/href) | SAFE (no user-control) |
| `sysInfo.portalUrl` | `settings.tsx:292-295` | Sourced from `process.env.PORTAL_URL` (environment variable) — not settable via API | HTML_ATTRIBUTE (href) | SAFE (no user-control via API) |
| URL parameters (route params, query strings) | All pages | Used only as API path segments, never rendered as HTML | N/A | SAFE |
| `password reset token` | `reset-senha.tsx` | Only sent to API as string; never rendered in DOM | N/A | SAFE |
| `ChartStyle dangerouslySetInnerHTML` | `chart.tsx:80-99` | `ChartContainer` is defined but never imported/used in any application page | N/A | SAFE (dead code) |
| API error messages | All API endpoints | JSON Content-Type; errors are string literals not reflecting user input | N/A | SAFE |

---

## 6. Analysis Constraints and Blind Spots

- **Development Environment**: The application runs in development mode (`NODE_ENV != "production"`). Cookie `Secure` flag is disabled, and Vite DevTools are active. Results reflect development configuration.
- **React 18 vs Future Versions**: React 18 warns but does not block `javascript:` URIs in attribute sinks. An upgrade to React 19+ may automatically remediate XSS-VULN-02 and XSS-VULN-03, but XSS-VULN-01 (`<a href>`) is not handled by React's built-in checks.
- **Admin-Gated Attack Surface**: All three vulnerabilities require admin credentials or a forged admin JWT to inject the payload. The known `SESSION_SECRET` in the `.env` file enables token forgery, lowering this barrier significantly.
- **CSP is Ineffective**: The `unsafe-inline` and `unsafe-eval` directives in `script-src` render the CSP non-protective. Any payload beyond `javascript:alert()` (e.g., `javascript:fetch('/api/admin/accounts')`) is fully executable.
