# Requirement check: brief against evidence

Evidence comes from the live stack: Express API, MongoDB Atlas, real Gemini, a real company site (posthog.com) and the Hacker News search API, plus a real-browser run against the deployed frontend. See [TEST_REPORT.md](TEST_REPORT.md).

## Brief section by section

| Brief | Requirement | Evidence | Status |
|---|---|---|---|
| 1 Auth | Register, login, logout; own kits only; invalid sessions handled | 401 with no or a bad token; logout revokes the token; another user gets 404; the UI clears an expired session with a message | Met |
| 2 Input and research | JD textarea and URL; several roles; crawl; hiring page; public discussion; skip failures; rate limit and backoff | Form plus JSON upload of several postings; 9 PostHog pages crawled through ranked links (handbook, about, careers); 6 Hacker News discussions; 400 ms spacing and 429/503 backoff; failures recorded in `research_notes` | Met |
| 2 | Respect `robots.txt` | `User-agent: *` `Disallow` honoured (unit-tested). `Crawl-delay` and wildcards not parsed | Met, with limitation |
| 3 Generation | Extract, retrieve, crawl and rank, discussion, questions per requirement and category, schedule, coverage | Separate prompted steps; the hiring-process text changes which categories exist; schedule and coverage are code | Met |
| 4 Second pass | Uncovered requirements generated again and re-checked | Targeted loop, up to 3 passes, then a template; `coverage.passes` recorded. Verified live by deleting a question and closing the gap (passes 1 to 2) | Met |
| 5 Structure | Appendix A fields, stable ids, must/nice, integer minutes | Zod schema with cross-reference checks; extensions optional | Met |
| 6 Builder | Edit, reorder, move category, add, delete; regenerate one section without losing edits | All in the UI; the server marks `edited`/`manual`; a category regeneration kept the edited and the hand-written question (live and real-browser tests) | Met |
| 7 Practice | Step through cards, record confidence, show covered, least-confident first | Implemented and persisted; plus a mock interview and a readiness score | Met |
| 8 Schedule | Exact day count, must-haves present, harder first, integer minutes | 1, 3, 4, 5 and 60 days produced; rebuild keeps questions | Met |
| 9 Batch | `npm run evaluate`, Appendix B, continues after failure, same pipeline, five cases in fifteen minutes, env credentials, runs from a clean clone | Fresh clone, 3 cases in 71 s, only `GEMINI_API_KEY` needed, local site with relative links followed | Met |
| 10 Edge cases | Invalid URL/404/timeout, no hiring page, stub, no discussion, bad JSON, rate limits, duplicate, 1 and 60 days | Dead site gives an honest minimal brief and an `ok` kit; stub gives zero invented requirements; duplicate returns the existing kit; model errors retry across a model chain | Met |
| 11 Security | URL validation, private addresses, content type and size, page text as data | Address guard with DNS and redirect checks; 1 MB truncation; JSON-wrapped untrusted text | Met |
| 12 Frontend | Next.js and Tailwind (or equivalent); reusable components; loading, empty, error states; immediate edits; laptop, phone, keyboard | Vite and React with hand-written CSS (justified); step progress, skeletons, empty states, autosave; responsive; skip link and labelled controls | Met (stack differs, justified) |
| 13 Backend | Separated concerns; validation; persistence; structured errors; slow generation | Layered modules; job id and polling; nothing saved unless valid | Met |
| 14 Code quality | Tests for schedule, coverage, structure; meaningful commits | 28 tests; commit history shows the development path | Met |
| Creative | One custom feature (optional) | Readiness and weak spots, mock interview, today's plan, printable one-pager, on-demand coverage pass | Delivered |
| Deployment | Public frontend and backend, env vars documented, free tiers | Vercel, Render, Atlas; variables in the README and runbook | Met |

## Problems found and fixed during verification

- Gemini 2.5 models were retired for new keys (404); the default is now an alias with fallbacks.
- Reduced-thinking options differ per model (a 400); the client retries without it, and calls dropped from about 30 s to about 1 s each.
- Provider 503/429 bursts: process-wide concurrency cap, backoff, model fallback and a cooldown.
- Model output shape drift (a list where a string was asked for) discarded whole categories; parsing is now tolerant.
- A page over 1 MB aborted the crawl (PostHog's homepage); bodies are now truncated.
- An unreachable company site failed the kit; it is now an honest `ok` kit with notes.
- Deployment: Atlas rejected Render's address until `0.0.0.0/0` was allowed; the API rejected the frontend until `FRONTEND_ORIGIN` was set. Both are in the runbook.
- UX: clipped question text, a misleading "0 saved kits" flash while loading, wrong plurals and unclear source labels.

## Residual risks

Hidden test postings and the free-tier model are the main unknowns. Question quality is validated structurally, not graded. See [KNOWN_ISSUES.md](KNOWN_ISSUES.md).
