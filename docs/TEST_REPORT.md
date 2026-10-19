# Test report

Last full run: 2026-10-19.

| Check | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run build` | pass |
| `npm test -- --run` | **28 tests, 5 files, all pass** |
| `npm audit --omit=dev --audit-level=moderate` | 0 vulnerabilities |
| Live end-to-end against Atlas, Gemini, posthog.com and Hacker News | **28 of 28 checks pass**, about 25 s per kit |
| Same end-to-end against the deployed Render and Atlas stack | 28 of 28 pass |
| Batch command from a fresh clone of GitHub (3 cases, environment variables only) | 3 of 3 `ok` in 71 s |
| Real-browser UI flow (headless Chrome) against the local build and the deployed Vercel site | 15 of 15 pass |
| On-demand coverage second pass against the deployed backend | verified (passes 1 to 2, gap closed) |

## What the automated suite protects

| File | Covers |
|---|---|
| `test/domain.test.ts` (8) | Requirement grounding and stable ids; coverage detection; schedule allocation (exact days, must-haves present, harder first, 1 and 60 days); schema invariants (unknown ids, duplicate ids, missing schedule entries) |
| `test/pipeline.test.ts` (4) | Company URL safety; a full kit from a realistic posting with injected network; no invented requirements from a stub |
| `test/regenerate.test.ts` (6) | Category regeneration keeps edited, hand-written and pinned items and other categories; schedule rebuild; **on-demand coverage pass closes a gap and records the pass**; crawl link ranking, `robots.txt`, dead sites recorded as notes; category planning from the hiring process |
| `test/api.test.ts` (7) | Authentication and ownership isolation; session revocation; weak passwords and invalid input; de-duplication; provenance assigned on save; health reports the real persistence |
| `test/evaluate.test.ts` (3) | Batch contract: shape, order, isolated failures |

## Live end-to-end script (28 checks)

Login; a signed-out request is refused; a full generation with step-by-step progress; every must-have has a question; the schedule has exactly the requested days; questions are model-written; more than the homepage was crawled; a bonus requirement is marked `nice`; a duplicate submission returns the existing kit; an edit is saved with provenance; regenerating a category keeps the edit and the hand-written question and replaces generated ones, leaves other categories alone and keeps the schedule consistent; a schedule rebuild keeps questions; practice confidence is stored; an unreachable company site still yields a kit with an honest brief; a two-line description yields a thin kit with no invented requirements.

## Real-browser flow (15 checks)

Dashboard shows today's plan; the skip link is first in tab order; typing shows an unsaved state then autosaves; the edited badge appears; adding a question works; regenerating a category keeps the edit and the added question; changes persist after reload; the mock timer runs; the outline reveals; rating advances to the next question; readiness is shown; the print sheet contains the edit; sign-out returns to the sign-in screen.

## Not covered by automated tests

Visual regression, load testing, and accessibility auditing beyond keyboard order and labels. Question quality depends on the model and is validated structurally, not graded.
