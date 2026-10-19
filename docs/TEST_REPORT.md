# Test report (2026-10-19)

| Check | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run build` (Vite production bundle) | pass |
| `npm test -- --run` | 27 tests in 5 files, all pass |
| `npm audit --omit=dev --audit-level=moderate` | 0 vulnerabilities |
| Live e2e against Atlas, Gemini, posthog.com and Hacker News | 28 of 28 checks pass, about 25 s per kit |
| `npm run evaluate` on a real site, a stub description and an unreachable site (60 days) | 3 of 3 `ok`, Appendix B shape |

## What the automated tests protect
- Schedule allocation: exact day count, must-haves present, harder first, 1 and 60 days.
- Coverage: uncovered requirements are detected by code and scheduling refuses uncovered must-haves.
- Structure: unknown ids, duplicate ids and a schedule that omits questions are rejected.
- Requirement grounding: a requirement whose quote is not in the description is rejected.
- Regeneration: edited, hand-written and pinned questions survive; other categories stay; the schedule reconciles.
- Research: ranked links, robots.txt, dead sites recorded as notes, private addresses rejected in production.
- API: authentication, ownership isolation, session revocation, de-duplication, provenance on save.

The live e2e script exercises login, a signed-out request, a full generation with progress, de-duplication, an edit, a category regeneration, a schedule rebuild, practice confidence, an unreachable company site and a two-line description.
