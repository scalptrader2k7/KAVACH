# Self-contained interactive prototype fallback

`/home/user/Kavach-interactive-prototype.html` opens directly in Arena's file viewer or as a downloaded local HTML file. All React code, CSS, typography, and a separately implemented browser-only validator are embedded. It makes no external requests and does not require a preview server.

This is explicitly **not the Python receiver**. It does not read, embed, or export the real application's runtime keys or database. Browser fixture keys are fresh ephemeral Web Crypto keys. State, replay records, audit events, and scenario results live only in memory and reset when the HTML is reopened.

Supported interactive workflows: command and telemetry generation, JSON editing, real browser HMAC verification, strict schema/range/time/permission checks, in-memory replay checks, trace and state comparison, audit filtering, evidence inspection/export, and eight actual browser scenarios. The HTML does not claim SQLite transactions, restart durability, concurrent receiver guarantees, or the 29-case Python scenario suite.

Arena's sandboxed file viewer blocks downloads. Export actions there show an on-screen JSON dialog with a Select JSON button. Download the HTML and open it in a browser to use ordinary file downloads.

## Rebuild

From the main project directory, after `npm ci`:

```bash
python preview/build_preview.py
```

The builder derives a separately labeled UI from the production React source, embeds local fonts, and adds the browser-only adapter. The original frontend and backend are not modified.

## Verified

`python preview/test_offline.py` runs the HTML in an iframe with exactly `sandbox="allow-scripts"`, without same-origin privileges. The observed check verifies valid command, tamper, replay, the eight-case suite, audit filtering, the evidence dialog, mobile width, zero external requests, and zero JavaScript runtime errors. See `reports/offline-prototype-tests.json`.

The backend can still be run separately on port 8000. This fallback avoids the authenticated server-preview ingress; it does not claim to repair Arena's preview authentication.

## Sprint changes

The builder and optional browser test are now import-safe. Generated output defaults to `preview/Kavach-interactive-prototype.html` inside an extracted release; `KAVACH_OFFLINE_OUTPUT` can select another output path. Run `python preview/build_preview.py` explicitly, then `python preview/test_offline.py` explicitly. Missing Playwright/Chromium produces BLOCKED (exit 2), not a success report. Core `python -m pytest -q` never launches a browser.

The fallback shares the lossless editor formatter and typed UI components, but its separate adapter still owns all browser-only decisions. Replay uses original accepted text and never runs an invisible status command. Attempt proof explicitly labels browser-only facts and in-memory rather than persisted audit. No current Python runtime key/database is read during generation. The release builder scans the resulting HTML for known server secret values.
