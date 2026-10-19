# E2E and Requirement Check (2026-10-19)

Run locally with the API on :3000 and the frontend built with `VITE_API_URL=http://localhost:3000` (separate origin, CORS preflight verified), a fixture company site on :4381, the seeded demo account and live Gemini (`gemini-3.1-flash-lite`).

## Verified working
- Auth: login, 401 without or with a bad token, token revoked on logout, another user gets 404 on my kit. CORS allows the separate frontend origin.
- Requirement extraction (live LLM): must/nice marked from wording ("required" vs "bonus points"), quotes verified verbatim, nothing invented. A 2-line stub JD returns 0 requirements.
- Company crawl: home page plus careers and engineering pages found by following links. Schedule spans exactly the requested days (1, 3, 5, 60). 61 days gets a 400.
- Batch CLI `npm run evaluate`: Appendix B shape, a failed case does not abort the run, order preserved, 3 cases in about 40 s.
- Kit edits via PUT are validated and persisted. 20 tests, typecheck and build pass.

## Fixed during this run
- Gemini model `gemini-2.5-flash` returns 404 for new keys; switched to `gemini-3.1-flash-lite`, timeout raised to 90 s.
- One non-verbatim LLM quote used to fail the whole generation; such candidates are now dropped.
- Generation rate limit is configurable via `GENERATION_RATE_LIMIT` (default 5 per 15 min).

## Gaps against the brief (not yet met)
| Brief section | Gap |
|---|---|
| 3 Research | No search for public discussion of the company's interviews. No ranking of crawl links by likely hiring pages (candidate pages are chosen without an LLM or scoring check). robots.txt/terms not honored. |
| 3 Generation | Questions and flashcards are fixed templates ("Describe how you have worked with <requirement>"), not generated per requirement and category. Hiring-process evidence does not change questions. Only technical/behavioural categories were produced. |
| 4 Second pass | The code path exists, but the template generator always covers every requirement, so it never closes a real gap. |
| 6 Builder | No regenerate endpoint for a section (brief, one category, schedule) and no generated/edited/pinned provenance. UI add/delete question and flashcard is incomplete. |
| 8 Schedule | Verify that every must requirement lands in the schedule, since scheduled question ids come from templated questions. |
| 10 Edge cases | A 404/unreachable company site fails the whole kit (API 502, batch "failed"). The brief says this must give an `ok` kit with an honest brief. Identical submissions are saved as two kits (no dedupe). Gemini 429/503 has no retry or backoff. |
| 13 Backend | Generation is synchronous (up to 90 s): no progress, no job id, no protection against double submission. |
| 12 Frontend | Next.js + Tailwind not used (Vite + React; justify in the README). Not exercised in a real browser in this run. |
| Deployment | Frontend and backend are not deployed. Needs Render and Vercel accounts. |
