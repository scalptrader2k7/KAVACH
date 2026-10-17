# KAVACH landing page — Phase 1

The production application now opens on a dedicated aerospace-style landing page. All hero text and capability summaries are editable React content in `web/src/components/LandingPage.tsx`; its styling is scoped in `web/src/landing.css`. Existing console styles and pages are retained.

## Entry and application safety

`Website` in `web/src/main.tsx` mounts the existing `App` only after an entry button is selected. The landing makes no API calls. Entry performs only the existing health/state/audit reads. The former automatic fixture issuance on `App` mount was removed because it advanced persistent issuer counters. Generate and Submit remain explicit user actions. No backend, API contract, validation, policy, database, or audit-chain implementation was changed. Previously audited QA defects remain outside this phase.

## Earth and assets

`EarthGlobe.tsx` owns React status and pause controls. It lazy-loads `earthScene.ts`, which uses Three.js, a textured sphere, directional sunlight, and a transparent atmosphere shell. It is an illustrative visual, not an orbital or live Earth model.

- Runtime dependency: `three` 0.186.1 (MIT).
- Development dependency: `@types/three` 0.186.0, plus its transitive type dependencies.
- Image: NASA Blue Marble land/ocean/ice composite, 2048 × 1024, 266,599 bytes.
- Source and usage terms: `web/src/assets/earth/ATTRIBUTION.md`.
- Vite emits the texture under `/assets`, supported by the existing Python server. No NASA/CDN requests occur at runtime.

Animation is capped at approximately 30 fps, uses elapsed time, and caps pixel ratio at 1.75. Rendering stops offscreen, when the document is hidden, or when paused. Reduced-motion preference starts with a static globe and preference changes are observed. Entry unmounts the scene, cancels rendering, disconnects observers/listeners, disposes geometry/materials/textures/renderer, and releases the WebGL context.

WebGL failure, context loss, a failed texture, and a 12-second texture timeout leave a static fallback and working entry controls. When the image itself is unavailable, the fallback retains the dark planet silhouette and explicitly labels 3D as unavailable. Text and controls do not depend on rendering success.

## Verification

Run against the existing local production server after `npm run build`:

```text
node node_modules/typescript/bin/tsc --noEmit --incremental false
npm run build
python -B tests/browser_landing.py --channel chrome
```

The browser suite permits only local GET/HEAD/OPTIONS requests. It never signs fixtures, submits commands, creates sessions, changes policies, or resets data. It checks rotation, pause/resume, reduced motion, visibility handling, GPU cleanup, responsive widths, capabilities scrolling, all entry controls, local attribution, existing console navigation, and unchanged state/audit totals. Failure cases are injected only in disposable browser contexts. It writes no report or screenshot files.

Desktop (1440 × 1000), tablet (768 × 1024), and mobile (390 × 844) screenshots were additionally inspected during implementation. The automated width checks also include 320 px.

Final browser run: **46 passed, 0 failed** in installed Chrome. No persistent requests were attempted, no external runtime requests occurred, and the normal path had no browser errors or failed HTTP responses. State and audit totals were unchanged. The hidden-document check exercises the visibility handler with a simulated hidden state; it does not measure physical-device background-tab behavior.

TypeScript and production build passed. Vite reports a >500 kB minified chunk warning for the lazily loaded Three.js renderer (approximately 132 kB gzip). The warning is retained. The texture is approximately 267 kB.

The existing `npm run test:editor` and `npm run test:csv` commands were executed and both failed on Windows at their pre-existing direct esbuild invocation (QA-10). Their original assertions were separately executed with in-memory TypeScript compilation: 12 editor and 10 CSV assertions passed. The original runners were not modified.

Browser verification uses existing Chrome and Playwright; Firefox/WebKit, physical mobile GPUs, exhaustive accessibility testing, and production command submission are not covered. The standalone HTML preview and release archive were not regenerated in Phase 1.
