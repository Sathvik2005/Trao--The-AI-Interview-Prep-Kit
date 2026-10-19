# E2E and requirement check

Run against the live stack: Express API with MongoDB Atlas, real Gemini (`gemini-flash-lite-latest`, with fallback models), a real company site (posthog.com) and the Hacker News search API. Account: the demo login. Script: 28 checks, all passing on the latest run.

## Brief section by section

| Brief | Requirement | Evidence | Status |
|---|---|---|---|
| 1 Auth | Register/login/logout, own kits only, invalid sessions handled | 401 without or with a bad token; logout revokes the token; another user gets 404; UI clears an expired session and shows a message | Met |
| 2 Input and research | JD textarea, company URL, several roles, crawl, hiring page, public discussion, skip failures, rate limit and backoff | Single form plus JSON upload of several postings; 9 PostHog pages crawled via ranked links (handbook, about, careers); 6 Hacker News discussions; 400 ms spacing, 429/503 backoff; failed pages are recorded in `research_notes` | Met |
| 2 | Respect robots.txt | `User-agent: *` Disallow honoured (unit-tested); Crawl-delay and wildcards not parsed | Met, with limitation |
| 3 Generation | Extract, retrieve, crawl and rank, discussion, questions per requirement and category, schedule, coverage | Separate prompted calls per category; hiring-process text changes which categories exist; schedule and coverage are code | Met |
| 4 Second pass | Uncovered requirements are generated again and re-checked | `closeCoverageGaps`: up to 3 passes then a template fallback; `coverage.passes` records it. On the PostHog run the first pass covered everything, so the loop did not need to fire | Met (loop covered by logic, not triggered live) |
| 5 Structure | Appendix A fields, ids, must/nice, integer minutes | Zod schema with cross-reference checks; optional extension fields only | Met |
| 6 Builder | Edit, reorder, move category, add, delete, regenerate one section without losing edits | UI controls for all; server marks `edited`/`manual`; regenerating a category kept the edited and the hand-written question and left behavioural untouched (live test) | Met |
| 7 Practice | Step cards, confidence, covered/uncovered, least-confident first | Implemented; confidence persisted (live test) | Met |
| 8 Schedule | Exact day count, must-haves present, harder first, integer minutes | 1, 3, 5 and 60 days produced; rebuild to 3 days kept questions | Met |
| 9 Batch | `npm run evaluate`, Appendix B, continues after failure, uses the same pipeline | Run on 3 cases including an unreachable site and a stub (see below) | Met |
| 10 Edge cases | Invalid URL/404/timeout, no hiring page, stub JD, no discussion, bad JSON, rate limits, duplicate, 1 and 60 days | Dead site gives an honest minimal brief and a kit; stub gives 0 requirements and no invented ones; duplicate returns the existing kit; model errors retry across a model chain | Met |
| 11 Security | URL validation, private IPs, content types and size, page text as data | SSRF guard with DNS check and redirect limits; 1 MB truncation; JSON-wrapped untrusted text | Met |
| 12 Frontend | Next.js + Tailwind (or equivalent), components, loading/empty/error, immediate edits, keyboard and phone | Vite + React with hand-written CSS, justified in README; step-by-step progress, empty states, autosave, skip link, responsive breakpoints | Met (stack differs, justified) |
| 13 Backend | Separated concerns, validation, persistence, structured errors, slow generation | Module split; job id plus polling; nothing saved unless the kit validates | Met |
| 14 Quality | Tests for schedule, coverage, structure | 27 tests (domain, pipeline, regeneration, API, batch) | Met |
| Deployment | Public frontend and backend | Not yet deployed: needs Render, Vercel and Atlas credentials from the owner. `render.yaml`, `vercel.json` and the runbook are ready | Open |

## Real problems found and fixed during this run
- Gemini 2.5 models were removed for new keys (404); default is now `gemini-flash-lite-latest`.
- Reduced-thinking settings differ per model; a 400 now retries without it. Calls dropped from about 30 s to about 1 s each.
- Provider 503/429 bursts: process-wide concurrency cap, backoff, model fallback and a 45 s cooldown.
- Model output shape drift (list instead of string) used to discard a whole category; parsing is now tolerant.
- A page over 1 MB used to abort the crawl (PostHog's homepage); it is now truncated.
- Unreachable company site used to fail the kit; it is now an honest `ok` kit with notes.

## Known limitations
See the README. The notable ones: Hacker News is the only public-discussion source, job progress is held in memory on one backend instance, and a 10-minute demo on a sleeping free Render service needs a warm-up request.
