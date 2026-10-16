# Local security and release model

## Intended boundary

Kavach is an educational, synthetic, single-user local simulator. The Python receiver controls validation and protected state. `POST /api/demo/issue` is a **privileged signing harness**, not a secure public identity service. Anyone able to call it can request signed operator fixtures. Sessions and evidence have no account authorization. Do not expose the MVP to an untrusted network.

The offline HTML is a separate, explicitly browser-only JavaScript demonstration. It creates fresh ephemeral browser keys, never reads Python keys, and cannot claim SQLite transactions, durable replay protection, process-restart guarantees, or server-side key isolation.

## Safe defaults

- `python -m backend`, `bash run.sh`, `npm run dev`, and `npm run preview` bind to **127.0.0.1** by default.
- The supported Python launcher refuses non-loopback binding unless `KAVACH_ALLOW_EXTERNAL=1` is explicitly set, and prints a warning.
- Vite rejects non-loopback `--host`/environment overrides without that acknowledgement, and uses exact allowed hostnames, never `allowedHosts: true` or wildcard suffix domains.
- Python rejects foreign Host headers and foreign-browser API origins. Same-origin calls and the standard loopback Vite origin are allowed. `Origin: null` and `Sec-Fetch-Site: cross-site` API requests are rejected. These are local-browser/DNS-rebinding protections, **not public authentication**. Non-browser clients can omit or forge these headers.
- Direct raw `uvicorn backend.app:app --host ...` can bypass the launcher's acknowledgement, as any manually overridden server command can. Use the supported launcher. This is a process configuration guard, not a firewall.

### Deliberate trusted-network exception

Only if required for an isolated presentation/preview network, configure exact hosts and origins deliberately:

```bash
export KAVACH_ALLOW_EXTERNAL=1
export KAVACH_HOST=0.0.0.0
export KAVACH_ALLOWED_HOSTS='your-exact-trusted-host.example'
export KAVACH_ALLOWED_ORIGINS='https://your-exact-trusted-host.example'
python -m backend
```

For Vite's separate preview hostname, add that exact hostname and origin too. No wildcard `*`, leading-dot domains, ports in host entries, or URL paths are accepted. Hostnames and origins are different settings. The local Vite proxy still targets the backend using loopback. A trusted tunnel/proxy's own access restrictions are additional requirements, not supplied by this app.

**Warning:** external access exposes a privileged fixture issuer, synthetic command execution, session history, and exported evidence. The exception does not turn this into a safe public deployment. Arena's authenticated iframe/ingress is a platform concern and is not verified by a local HTTP or Chromium test.

## If a workspace archive exposed keys

Treat the old synthetic key set as potentially compromised. A new demo session does **not** rotate keys.

1. Stop sharing the old workspace archive. Retain an access-restricted forensic copy if needed. Do not overwrite or silently remove existing keys, the database, or audit evidence.
2. Stop the old process before making a consistent private backup of its **whole runtime directory**, including any journals. Alternatively use SQLite's backup API with the running process. Keep the old keys with the corresponding database so historical evidence remains interpretable. Restrict the backup with OS permissions/ACLs; do not attach it to a submission.
3. Use a **new, empty, private directory**, not the old directory:

```bash
mkdir -m 700 "$HOME/kavach-fresh-private"
export KAVACH_DATA_DIR="$HOME/kavach-fresh-private"
python -m backend
```

4. The new environment generates a fresh synthetic key set and database. The old environment remains unchanged and must not be trusted for new demonstrations if its keys were exposed. This is a new environment, not in-place key rotation.
5. Never copy old keys into the fresh directory. Never delete only the key file to reset a demo. An existing database without its original keys now fails closed instead of silently generating replacement keys.

On POSIX, the engine enforces runtime-directory mode 0700 and key/database/journal/WAL/SHM mode 0600. Existing content is not rewritten by permission repair. On Windows, verify equivalent owner-only ACLs; POSIX mode tests do not establish Windows ACL security. Workspace restoration or archive extraction may reset metadata, so the engine rechecks permissions at initialization.

## Failure behavior

- Eight ordered stages, strict JSON/duplicate detection, canonical HMAC, time boundaries, permissions, and per-stream sequence semantics remain unchanged.
- Acceptance, protected state, accepted telemetry, replay records, and acceptance audit commit atomically. Operational failures never claim acceptance or successful audit persistence.
- Connection-open errors, write/commit failures, and lock contention return bounded SERVICE_ERROR. Default SQLite busy timeout is two seconds; `KAVACH_DB_TIMEOUT_S` is clamped to 0.01–5 seconds. This bounds contention waits, not every possible hardware/storage failure.
- Missing explicit sessions return bounded 404; the API does not create a session implicitly. No session ID is an authorization token.
- All POST request bodies are bounded at 8 KiB. `/api/messages` retains an 8193-byte oversize sentinel for a structured receiver rejection; the hash is explicitly labeled as a truncated-prefix hash in the persisted event. It is not claimed to cover the discarded body.
- Fixture JSON rejects duplicate keys/non-finite values and unsupported/deep payload types before signing. Validation errors omit submitted values and internal stack traces. Signed invalid ranges and unauthorised fixtures remain intentionally available for policy tests.
- Read-only evidence export uses one SQLite snapshot for state, events, and suite records. Persistent application logs are not immutable or cryptographically attested.

## Release procedure

Build the UI and fallback, run verification, then package:

```bash
npm ci
npm run build
npm run test:editor
python -m pip install -r requirements-dev.txt
python -m pytest -q
python preview/build_preview.py
python scripts/release.py --output ../Kavach-hardened-release.zip
python scripts/release.py --verify ../Kavach-hardened-release.zip
# Rerun the actual-archive pytest gate once the archive exists:
python -m pytest tests/test_release.py -q
```

The reviewed `release-files.json` is an **exact list**, not a directory walk or broad recursive glob. Missing files, unsafe paths, symlinks, unexpected ZIP entries, private-key markers, and known runtime secret values fail the build. Runtime paths are independently forbidden even if someone adds them to the allowlist. ZIP timestamps, file ordering, and file modes are deterministic. Reproducibility assumes the same input bytes and toolchain/compression implementation.

The builder scans every included byte and compiled frontend assets for the current known secret values in raw/hex/base64 forms. Add `--secret-file /private/archived/sender-secrets.json` for other known exposed historical key sets. Values are never printed. Known-secret scanning and private-key markers are **not a universal secret detector**: review the explicit allowlist and source before adding new assets/evidence. No runtime database, `.env`, dependencies, caches, uploads, nested ZIP, or credential files belong in the release.

Never submit a generic outer workspace export. Only distribute the independently validated release ZIP. The separate release-validation report records its SHA-256; the ZIP's RELEASE_MANIFEST.json records per-member hashes, not an immutable or signed attestation.

## If an isolated public demo becomes necessary

Not implemented in this local MVP. A defensible public-demo deployment would require:

- An independent disposable runtime per authenticated demo user/session, with no production or local-presenter key/data reuse.
- Disable `/api/demo/issue` publicly, or protect signing with server-side authorization limiting fixture capabilities to that user's isolated synthetic environment. Separate signer and receiver permissions; never accept client roles/secrets.
- Authentication and authorization for state, audit, export, scenario execution, session creation, and every session ID—not just signing. Do not treat UUID secrecy or Origin headers as authorization.
- TLS and a trusted reverse proxy with explicit hosts/origins. Cookie sessions need Secure/HttpOnly/SameSite settings plus CSRF tokens and Origin checks for state-changing routes. Avoid credential-bearing URLs.
- Rate/concurrency limits on issuance, validation, scenario suites, exports, and session creation; body/time/database/storage quotas and lifecycle expiry for disposable environments.
- Redacted logs, private backups, key lifecycle controls, abuse monitoring, and review of denial-of-service and cross-tenant isolation.

That model is a separate security/deployment project, not achieved by enabling external binding or by adding an ad-hoc login page.
