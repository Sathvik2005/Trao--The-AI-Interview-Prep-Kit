# AI Interview Prep Kit

Paste a job description and a company website; the app researches the company, extracts the role's requirements, and builds a kit you can reshape and practise against: company brief, role breakdown, categorised question bank, flashcards and a day-by-day study schedule.

## Live deployment

- App (Vercel): https://trao-the-ai-interview-prep-kit.vercel.app
- API (Render): https://trao-interview-prep-kit-api.onrender.com/api/health
- Reviewer login: create an account on the sign-in screen (password 12+ characters). The free Render service sleeps when idle, so the first request after a pause can take 30-60 seconds.

## Stack and why

| Layer | Choice | Why |
|---|---|---|
| Frontend | React 19 + Vite + plain CSS (TypeScript) | The brief prefers Next.js + Tailwind but allows equivalents. The UI is an authenticated single-page tool with no SEO or server-rendering need, so Vite gives a faster build and a simpler Vercel deploy. CSS is hand-written with design tokens. |
| Backend | Node 20+ / Express (TypeScript) | As specified. |
| Database | MongoDB (Atlas free tier) | As specified. An in-memory store is used for local development only when `MONGODB_URI` is unset or unreachable. Production refuses to start without Mongo. |
| LLM | Google Gemini, `gemini-flash-lite-latest` (free tier) | Genuine free tier, JSON mode, fast. Thinking is disabled to keep calls around 10 s. Override with `GEMINI_MODEL`. |
| Retrieval | `fetch` + a small HTML cleaner, Hacker News Algolia API | No paid search key. See "Retrieval". |
| Validation | Zod | One schema is the contract for the API, the batch CLI and the UI. |

## Architecture

```
src/
  domain/      schema + validation, coverage, schedule, requirement grounding, reconcile/provenance (pure, no I/O)
  research/    company crawl, link ranking, robots.txt, SSRF guard, public-discussion search
  llm/         Gemini client (retry/backoff) + the separately-prompted generation steps
  pipeline/    orchestration: generateInterviewKit, regenerateSection
  api/         Express routes, auth, background jobs, Mongo / in-memory stores
  cli/         batch entry point (calls the same pipeline as the API)
  web/         React UI
```

Retrieval, extraction, generation, scheduling and persistence are separate modules. The **batch CLI and the web app call the same `generateInterviewKit`**.

## Pipeline: what each step is responsible for

1. **Extract requirements** (LLM, then code). The model must return a *verbatim quote* for each requirement; code drops any candidate whose quote is not in the description, so nothing is invented. `must` vs `nice` comes from the posting's wording ("required" vs "bonus points").
2. **Describe the role** (LLM): title, seniority, location, responsibilities, only if stated.
3. **Research** (code, no LLM): crawl the homepage, rank internal links by path and anchor text (careers, interview, engineering, handbook, about…), fetch the best ones politely, and follow one level onward from a good hiring page. Then search public discussion. A fixed path list is not used.
4. **Company brief** (LLM over crawled text): summary, what they do, and how they hire. If nothing was retrieved, the brief says so instead of guessing.
5. **Questions, one call per category** (LLM): technical, behavioural, system-design and company-fit are generated separately. Categories are chosen by code from each requirement's kind; system-design is added when a requirement is architectural or the hiring-process text mentions a system-design round, so what was *found* changes what is asked.
6. **Coverage check and second pass** (code decides, LLM fills): code computes which requirements have no question. Those go back to the model for targeted generation. Up to 3 passes; anything still uncovered gets a plain template question and a note, so a must-have never ships uncovered. `coverage.passes` records how many passes ran.
7. **Flashcards** (LLM), then **schedule** (pure code).

Two steps are deliberately not given to the model: **schedule allocation** and **coverage comparison**.

### Retrieval and sources

- The company website: homepage, ranked internal links, and one level beyond a hiring/about page (up to 8 pages). `robots.txt` is honoured (`User-agent: *` disallows); requests are spaced 400 ms apart; 429/503 responses back off and retry.
- Public discussion: the **Hacker News Algolia search API** (keyless, intended for programmatic use), filtered to items that name the company and mention interviews. Used as evidence for the brief and for hiring-process hints; each source URL is listed in the kit.
- Not used: job boards, Glassdoor, LinkedIn (they block automated access and their terms prohibit scraping).

### Edge cases (what happens)

| Case | Behaviour |
|---|---|
| Company URL invalid / 404 / timeout | A kit is still produced; `research_notes` records the gap and the brief says nothing could be retrieved. Batch status stays `ok`. |
| No hiring page found | Recorded in `research_notes`; the rest of the kit is unaffected. |
| Two-line description | Zero or few requirements, a thin kit that says so; nothing is invented. |
| No public discussion | Recorded in `research_notes`. |
| Model returns bad JSON / is rate-limited | Zod validates every response; calls retry with exponential backoff and honour `Retry-After` (5 attempts). A failed category is retried by the coverage loop. |
| Same posting submitted twice | The submission is hashed (description + URL + days); the existing kit is returned instead of generating again, and an in-flight duplicate returns the running job. |
| 1-day or 60-day schedule | Both are valid; the schedule has exactly the requested number of days. |
| Generation takes ~90 s or fails halfway | `POST /api/kits` returns a job id immediately; the UI polls step-by-step progress and offers retry. Nothing is saved unless the whole kit validates. |

## Generated, edited and pinned state

Questions and flashcards carry an optional `origin` (`generated` | `edited` | `manual`) and `pinned` flag (extensions to Appendix A). The **server** assigns provenance on every save by diffing against the stored kit, so the client cannot forget to mark an edit. Regenerating a question category deletes only items that are `generated` and not pinned in that category; edited, hand-written and pinned items are kept, and generation is told their prompts so it does not duplicate them. The schedule is reconciled afterwards (stale ids removed, new questions placed on the lightest day). Other categories, flashcards and the brief are never touched by a category regeneration.

## Schedule allocation

Pure code (`src/domain/schedule.ts`). Questions are sorted must-have first, then by difficulty (hard first), then id, and split into exactly `days` contiguous groups, so harder and higher-priority material lands earlier. Minutes per question are `15 + 10 × difficulty`. Schedule creation refuses to run if a must-have requirement is uncovered. Changing the day count re-allocates without touching questions.

## Practice mode

Flashcards are shown least-confident first (unrated = 0, then 1–5). Confidence is stored per flashcard on the server. The panel shows how many cards are covered, lists the uncovered ones, and cards can be edited, pinned, added and deleted.

## Creative features

Interview prep fails in a few predictable places: people do not know *where they are weak*, they never rehearse out loud under time pressure, and they lose track of which day of the plan they are on. Three small features address those directly, and all reuse data the kit already has.

- **Readiness and weak spots.** Each requirement gets a readiness score from your own confidence ratings on the flashcards and questions linked to it (unrated counts as 0, must-haves count double). The overview shows an overall ring and the three weakest requirements, so the next hour of study is obvious instead of guessed.
- **Mock interview mode.** A timed round over the questions you are weakest on: start the clock (the target is 2-3 minutes), jot an answer, peek at the outline only if you are stuck, then rate yourself. Ratings are saved per question and feed readiness.
- **Today's plan.** The schedule follows the real calendar from the day the kit was created. The dashboard shows today's focus and how many days are left, and the schedule marks today.
- **Printable one-pager** (below).

## Creative feature: printable one-pager

**Print one-pager** (top of every kit) turns the kit into a clean, print-styled document: company brief, how they hire, requirements marked must/nice, the day-by-day plan with the actual questions, the question bank by category with answer outlines, and flashcards with your confidence scores. Use the browser's *Save as PDF*.

*Why:* interview prep happens away from a screen: on a commute, on paper, or in the last hour before the call. Everything the app builds is only useful if it can leave the app, and a one-page, offline copy of the plan with the questions already in it is what people actually carry into the day. It reuses the data already in the kit, so it needs no extra backend and never goes stale: it prints the current edited state.

## Security

Passwords are bcrypt-hashed; sessions are JWTs that are also stored hashed server-side so logout revokes them; every kit query is scoped to the owner. External URLs are validated before fetch (http/https only; private, loopback and link-local addresses rejected in production including after DNS resolution and redirects), responses are limited to text content types and 1 MB (truncated), and redirects are capped. Page text and job descriptions are passed to the model inside JSON with an explicit instruction that they are data, never instructions. Helmet, rate limits and strict CORS are on.

## Running locally

```bash
npm ci
cp .env.example .env      # then fill in GEMINI_API_KEY and JWT_SECRET (32+ chars)
npm run dev               # API on :3000, web on :5173
```

MongoDB is optional locally: leave `MONGODB_URI` empty to use the in-memory store (data is lost on restart).

### Tests

```bash
npm run typecheck
npm test -- --run
```

### Batch entry point

```bash
npm run evaluate -- --input <cases.json> --output <kits.json>
```

Input is an array of `{ "id", "jd", "company_url", "days" }`; output is `{ version, generated_at, kits: [{ id, status, kit, error }] }`. Cases run with limited concurrency and a failure never aborts the run. `failed` is reserved for a case where no kit could be produced; partial research is `ok` with notes. Only `GEMINI_API_KEY` is required (see `.env.example`). The process exits non-zero if any case failed.

## Deployment (free tiers)

Frontend on Vercel, backend on Render, database on MongoDB Atlas. See `docs/DEPLOYMENT_RUNBOOK.md` for click-by-click steps.

| Variable | Where | Purpose |
|---|---|---|
| `MONGODB_URI` | Render | Atlas connection string. Required in production. |
| `MONGODB_DATABASE` | Render | Database name (default `interview_prep_kit`). |
| `JWT_SECRET` | Render | Signs sessions; 32+ random characters (generated by `render.yaml`). |
| `GEMINI_API_KEY` | Render | LLM access. Required in production. Never exposed to the browser. |
| `GEMINI_MODEL` | Render | Model id (default `gemini-flash-lite-latest`). |
| `FRONTEND_ORIGIN` | Render | Comma-separated allowed browser origins, e.g. the Vercel URL. |
| `TEST_EMAIL`, `TEST_PASSWORD` | Render (optional) | Creates a reviewer login at boot (password 12+ chars). |
| `DNS_SERVERS` | local (optional) | Override resolvers if your network blocks MongoDB SRV lookups. |
| `GENERATION_RATE_LIMIT` | Render (optional) | Generations per user-IP per 15 minutes (default 30). |
| `VITE_API_URL` | Vercel | Public URL of the Render API; baked into the frontend build. |

Render's free tier sleeps after idle time; the first request can take ~30–60 s. Call `/api/health` before a demo.

## Key design decisions and trade-offs

- **What the model may not decide.** Coverage and scheduling are plain code. The model writes text; code decides which requirement lacks a question, which day a question lands on, and whether the kit is valid. A model asked "is everything covered?" will say yes; a set difference will not.
- **Nothing is invented.** Every extracted requirement must carry a verbatim quote from the description; code drops any candidate whose quote is not found. A two-line posting therefore yields a thin kit that says so, instead of padding.
- **How many coverage passes: up to 3, then a template.** One pass is a single shot, which is what the brief wants to avoid. In practice a miss is almost always an omission by the model, and a targeted retry for only the missing requirements fixes it on the first try. A third attempt catches a flaky provider response. Beyond that the model is unlikely to succeed, and spending more tokens on a free tier risks the rate limit, so the loop stops and a plain template question is added with a note. The invariant that matters, no uncovered must-have ships, holds either way.
- **The second pass can be run on demand.** If you delete the only question for a requirement, the overview shows the gap and **Close the gaps** re-runs exactly the generator's second pass for the missing requirements and increments `coverage.passes`. Deleting the only question for a must-have is refused with a clear message.
- **Partial research is a result, not a failure.** An unreachable site, a missing hiring page or no public discussion is recorded in `research_notes` and the kit is still produced. `failed` is reserved for a case where no kit can be made at all.
- **Provenance is assigned by the server.** The client never has to remember to mark an edit; the server diffs against the stored kit on every save. This keeps "edited" trustworthy and makes regeneration safe by construction.
- **Jobs instead of a long request.** Generation takes 10-90 seconds and can fail halfway, so the API returns a job id and the UI shows each step. The trade-off is that progress lives in server memory, which is fine for one instance and noted as a limitation.
- **One model chain, many guards.** Free-tier providers return 429/503 and retire models. Calls are capped process-wide, retried with backoff, fall back across models, and cool down a failing model. The trade-off is slightly higher latency on a bad day in exchange for kits that complete.
- **Vite instead of Next.js.** Chosen for build speed and a simple static deploy, since the app has no need for server rendering.
- **One repository.** The batch command and the web app must run the same pipeline, so they live together.

## Known limitations

- Job progress lives in server memory: a restart mid-generation loses the progress view (the kit is only saved when complete), and it assumes a single backend instance.
- Public discussion comes from Hacker News only; companies rarely discussed there get an honest "nothing found" note.
- The crawler reads server-rendered HTML; pages built entirely client-side yield little text.
- `robots.txt` handling covers `User-agent: *` Disallow rules, not Crawl-delay or wildcards.
- Question quality depends on a small free-tier model; categories are generated once per pass and spot-checked, not graded by a second model.
- The session token is kept in `sessionStorage`, so an XSS bug would expose it; there is no per-user LLM cost budget beyond rate limits.
- Vite + React replaces the preferred Next.js + Tailwind (justified above).
