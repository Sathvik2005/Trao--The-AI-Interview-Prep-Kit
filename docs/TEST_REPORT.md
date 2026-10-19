# Test Report

Updated 2026-10-18. Record only executed results below.

## Verified

- `npm run typecheck` — passed after frontend/backend integration; re-run after latest API health change.
- `npm run build` — passed; Vite generated the production frontend bundle.
- `npm test -- --run` — previously passed 15 tests across API, domain and pipeline suites. The API suite was rerun after health reporting changed: 4 tests passed.
- `npm run evaluate -- --input test/fixtures/evaluate-cases.json --output tmp/evaluate-results.json` — output inspected; one local case succeeded, invalid-days and invalid-url failed independently. Top level was version 1.0 with ISO generated_at and ordered kits. Exit is nonzero when any case fails.
- Local browser opened `http://localhost:5173/`; sign-up screen and authenticated saved-kit view rendered.
- `GET http://127.0.0.1:3000/api/health` returned `200 {"status":"ok","persistence":"memory"}`.

## Not verified / blocked

- No-Docker API state is process-memory only; MongoDB durability not tested.
- Live Gemini not tested; no API key supplied.
- Vercel, Render and Atlas deployment/smoke not done; no URLs available.
- Keyboard/mobile/screen-reader testing not completed.
- Lint script is not configured.
- `npm audit` must be rerun after final dependency changes.
