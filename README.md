# AI Interview Prep Kit

Turns a job description plus a company website into a personalised interview preparation kit: company brief, role breakdown, categorised question bank, flashcards and a day-by-day study schedule. Built for Trao assessment FS-AI-INTERVIEW-01.

> **Status: work in progress.** The core pipeline, API, auth, builder basics, practice mode and batch CLI work. Several brief items are not done yet; see [Known limitations](#known-limitations). This README describes what the code does today, not what it aims to do.

## Tech stack

| Layer | Choice | Why |
| --- | --- | --- |
| Frontend | React 19 + Vite (plain CSS) | **Deviation from Next.js + Tailwind.** The app is a single authenticated SPA with no SEO or SSR need, so Vite keeps the build small. |
| Backend | Node.js + Express 5, TypeScript | As suggested. |
| Database | MongoDB | As suggested. Stores users, sessions and kits. |
| LLM | Google Gemini, `gemini-2.5-flash` (configurable) | Genuine free tier; JSON response mode. |
| Validation | zod | One schema serves request validation, LLM output validation and kit validation. |
| Tests | vitest + supertest | |

## Architecture

```
src/
  domain/      kit-schema, requirements, coverage, schedule   (pure, deterministic, no I/O)
  research/    company-research                               (fetch, crawl, URL safety)
  llm/         gemini-requirements                            (the only model call)
  pipeline/    generate-kit                                   (orchestration)
  api/         app (Express routes), store (MongoDB)
  cli/         evaluate                                       (batch entry point)
  web/         main.tsx, styles.css                           (React UI)
```

Retrieval, extraction, generation, scheduling and persistence live in separate modules. The API, the CLI and the tests all call `generateInterviewKit` in `src/pipeline/generate-kit.ts`, so the batch command runs the same code path as the app.

## How a kit is generated

`generateInterviewKit` runs these steps in order:

1. **Research** (`researchCompany`): fetch the homepage, extract internal links, rank them, fetch the top ones, then look for public interview discussion. Unreachable pages are skipped; only an unreachable homepage fails the run.
2. **Extract requirements** (`extractRequirementsWithGemini`): the model returns candidates with `text`, `kind`, `priority` and a verbatim `source_quote`. The job description is passed as JSON data and the prompt says to ignore instructions inside it.
3. **Validate requirements** (`buildRequirements`, deterministic): a candidate whose `source_quote` is not found in the job description is rejected, so nothing can be invented. Duplicates are merged (the `must` wins) and each requirement gets a stable id, `r-` plus a hash of its text.
4. **Generate questions**: one question per requirement, categorised from the requirement's kind.
5. **Coverage check** (`analyzeCoverage`, deterministic): any requirement with no question referencing it is a gap.
6. **Second pass**: questions are generated for the gaps and coverage is re-checked.
7. **Schedule** (`createSchedule`, deterministic): distributes questions across exactly the requested days.
8. **Validate the kit** (`validateKit`): the finished kit is checked against the Appendix A structure and cross-checked before it is saved.

### Coverage passes

The loop runs at most **two passes**: the first draft, then one repair pass for gaps. If a must-have is still uncovered, `validateKit` and `createSchedule` throw and the kit is not saved, rather than shipping with an uncovered must-have. One repair pass is enough today because each requirement gets its own question; a stricter limit would matter once an LLM generates questions and can miss requirements.

### What the code decides, not the model

- Whether a requirement is real (the quote must exist in the description).
- Coverage and gaps.
- Schedule allocation and durations.
- Structural validity of the kit.

## Retrieval approach and sources

- **Company site:** the homepage is fetched, internal links (same origin, relative links resolved against the page) are collected and ranked by keyword in the URL: careers/jobs/hiring, engineering, handbook, about, interview, blog, team. The top 10 are fetched. There is no fixed path list and no assumption about host, so a local test server works.
- **Public discussion:** a DuckDuckGo HTML search for `"<company> interview process engineering"`; the result URLs are kept as `interviewEvidence`. On any failure it returns nothing.
- **Sources used** are recorded per kit in `source.pages_used` and `company_brief.sources`.
- **Not used:** job boards, paid APIs.

## Security

- External URLs must be `http(s)`. In production, loopback/private/reserved addresses are rejected, both by literal IP and after DNS resolution (`ipaddr.js`).
- Redirects are followed manually (max 3) and each hop is revalidated.
- Responses are limited to `text/html`, `text/plain` and `application/xhtml+xml`, and to 1 MB; requests time out after 15 s.
- Fetched text and the job description are treated as data in the model prompt.
- Passwords are hashed with bcrypt (cost 12). Sessions are JWTs (2 h) whose hash is also stored server-side, so logout invalidates them. Login does a dummy bcrypt compare for unknown users.
- `helmet`, CORS allow-list from `FRONTEND_ORIGIN`, 64 KB JSON body limit, rate limits (auth 20 / 15 min, kit creation 5 / 15 min).
- Every kit route is scoped to the signed-in user.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Liveness and active persistence mode (`memory` or `mongodb`) |
| POST | `/api/auth/register`, `/api/auth/login` | Create account / sign in |
| POST | `/api/auth/logout` | Invalidate the session |
| GET | `/api/auth/me` | Current user |
| GET / POST | `/api/kits` | List own kits / generate a kit |
| GET / PUT / DELETE | `/api/kits/:id` | Read / save edits / delete |
| POST | `/api/kits/:id/practice` | Record flashcard confidence |

Errors use `{ "error": { "code", "message", "details?" } }`. A generated kit is validated before it is saved.

## Schedule allocation

`createSchedule(requirements, questions, daysAvailable)`:

1. Rejects non-integer or `< 1` days, and refuses to run if a must-have has no question.
2. Sorts questions: must-have-linked first, then higher difficulty, then id (stable).
3. Splits the sorted list into `daysAvailable` contiguous buckets (`floor(index * days / count)`), so hard and must-have material lands on earlier days.
4. Each day gets a focus from its question categories and `minutes = sum(15 + 10 * difficulty)`, always an integer.

The schedule always has exactly the requested number of days. With more days than questions, the extra days get "Review company and role context" and 0 minutes. Every question is scheduled, so every must-have is.

## Generated, edited and pinned state

**Not implemented yet.** Currently a kit is a single document: `PUT /api/kits/:id` replaces it with the user's edited copy. There is no per-section regeneration, so the "regeneration must not clobber edits" requirement is not met. The planned design is to tag each question and flashcard with an `origin` (`generated` | `edited` | `manual`) and have regeneration replace only `generated` items within the target category.

## Practice mode

Flashcards are shown one at a time with reveal. The user rates confidence 1-5 per card (stored in `practice` on the saved kit). Cards are ordered **lowest confidence first**, with unrated cards first. This is a simple confidence-weighted sort, chosen over spaced repetition for transparency; it has no time decay.

## Edge cases

| Case | Behaviour |
| --- | --- |
| Invalid URL / wrong scheme / private address (production) | Rejected with a validation error |
| Homepage 404 or timeout | Run fails with a clear error (API returns `GENERATION_FAILED`; batch records `failed`) |
| Other pages unreachable | Skipped silently |
| Thin job description | Few or no requirements; the kit is thin and nothing is invented |
| No public discussion found | Empty evidence; kit still generated |
| Model returns invalid JSON / fails schema | Error; no kit saved |
| Same posting submitted twice | Not deduplicated; a second kit is created |
| 1-day or 60-day schedule | Valid; the UI clamps days to 1-60 |

## Setup

Requires Node 20+. Docker is **not** required. Pick one database option:

**A. No database (quickest, default).** Leave `MONGODB_URI` empty in `.env` (the checked-in `.env.example` does this). The API uses an in-memory store; accounts and kits are lost on restart. Not allowed when `NODE_ENV=production`.

**B. MongoDB without Docker.** Use a free [MongoDB Atlas](https://www.mongodb.com/atlas) cluster, or a locally installed `mongod`, and set `MONGODB_URI` to its connection string.

**C. MongoDB with Docker (optional).** `docker compose up -d mongo` starts MongoDB on `127.0.0.1:27017`; set `MONGODB_URI=mongodb://127.0.0.1:27017/interview_prep_kit` in `.env`.

```bash
npm install
cp .env.example .env     # set JWT_SECRET (32+ chars) and GEMINI_API_KEY; see the database options above
npm run dev              # API on :3000, web on :5173
npm test                 # tests use the in-memory store, no database needed
npm run typecheck
```

### Environment variables (`.env.example`)

| Variable | Purpose |
| --- | --- |
| `NODE_ENV` | `production` enables private-address rejection |
| `PORT` | API port |
| `MONGODB_URI`, `MONGODB_DATABASE` | MongoDB connection; leave `MONGODB_URI` empty to use the in-memory store (dev only) |
| `JWT_SECRET` | Session signing key, at least 32 random characters |
| `FRONTEND_ORIGIN` | Comma-separated allowed CORS origins |
| `GEMINI_API_KEY` | Gemini key (free from Google AI Studio) |
| `GEMINI_MODEL` | Defaults to `gemini-2.5-flash` |

If `GEMINI_API_KEY` is unset the pipeline falls back to a few hard-coded keyword patterns (React, TypeScript, mentoring, product design). That fallback exists for offline tests and is **not** a real extractor.

### Batch entry point

```bash
npm run evaluate -- --input cases.json --output kits.json
```

`cases.json` is an array of `{ "id", "jd", "company_url", "days" }`. The output is `{ version: "1.0", generated_at, kits: [{ id, status: "ok" | "failed", kit, error }] }`. A failing case is recorded and the run continues; two cases run concurrently. The CLI exits nonzero if any case failed. See `test/fixtures/evaluate-cases.json` for an example.

## Deployment

Not deployed yet. The included configuration targets Vercel for the static Vite frontend, Render for the persistent Node API, and MongoDB Atlas for durable storage. Set `VITE_API_URL` on Vercel and `MONGODB_URI`, `JWT_SECRET`, `FRONTEND_ORIGIN` and optional Gemini credentials on Render. Follow `docs/DEPLOYMENT_RUNBOOK.md`; no public deployment URL has been verified.

## Known limitations

What is missing or weak versus the brief:

- **Questions are template-based**, one per requirement, not generated per category by the model, so they don't change with the hiring process found. Flashcard backs are placeholders.
- **No retry or backoff** for Gemini rate limits or errors; no crawl rate limiting; **robots.txt is not checked**.
- **Public-discussion search** scrapes DuckDuckGo HTML, which is fragile, and keeps only URLs; page content is not read or used.
- **Role, company name and location** are guessed with regexes; the company name comes from the URL hostname.
- **Missing features:** multi-role upload, add/delete of questions and flashcards, per-section regeneration, preserved-edit state, deduplication, drag reordering (up/down buttons only), a creative feature, deployment, walkthrough video.
- Gemini failures other than HTTP status give little detail.
- Tests cover the domain, pipeline, API and batch CLI, but not the UI or live crawling.
