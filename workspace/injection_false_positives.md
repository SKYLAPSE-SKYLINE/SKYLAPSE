# Injection False Positives

## SQL Injection - All Vectors

**Status:** NO SQL INJECTION VULNERABILITIES FOUND  
**Analysis Source:** injection_analysis_deliverable.md Section 4

All database queries use Drizzle ORM with parameterized queries (`eq()`, `gte()`, `lte()`, `inArray()`, `.values()`). No string concatenation into SQL was found. The single raw `sql` template literal at `storage.ts:450-458` contains no user-controlled values (hardcoded 7-day aggregation query only).

Specific vectors analyzed and confirmed safe:
- `email`/`senha` on `/api/admin/login` and `/api/client/login` — ORM parameterized + bcrypt
- `dataInicio`/`dataFim` on `/api/client/cameras/:id/captures` — Drizzle still parameterizes Invalid Date objects
- `nome`, `cidade`, `estado`, `pais` on admin creation endpoints — ORM `.values()` parameterized inserts
- `token` on `/api/client/reset-password` — parameterized `eq()` lookup

## Command Injection - All Vectors

**Status:** NO COMMAND INJECTION VULNERABILITIES FOUND  
**Analysis Source:** injection_analysis_deliverable.md Section 4

All ffmpeg/ffprobe invocations in `timelapse-job.ts` use `execFileAsync()` with array arguments and no `shell: true`. No user input reaches any command array. The `fps` parameter is validated as integer by Zod before use.

## Path Traversal - All Vectors

**Status:** NOT EXPLOITABLE  
**Analysis Source:** injection_analysis_deliverable.md Section 4

`isPathSafe()` applies `startsWith(UPLOADS_DIR)` checks before all file operations. All file paths are server-generated from UUIDs. Express.static normalizes `../` sequences and rejects paths outside root.
