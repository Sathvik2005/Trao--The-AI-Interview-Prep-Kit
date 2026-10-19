# Prep Kit: an AI interview preparation kit

**Paste a job description and a company website. Get a researched, editable, practisable preparation kit.**

[![Live app](https://img.shields.io/badge/live%20app-vercel-000?logo=vercel)](https://trao-the-ai-interview-prep-kit.vercel.app)
[![API](https://img.shields.io/badge/api-render-46e3b7?logo=render&logoColor=000)](https://trao-interview-prep-kit-api.onrender.com/api/health)
![Node](https://img.shields.io/badge/node-%E2%89%A520-339933?logo=nodedotjs&logoColor=fff)
![TypeScript](https://img.shields.io/badge/typescript-strict-3178c6?logo=typescript&logoColor=fff)
![React](https://img.shields.io/badge/react-19-61dafb?logo=react&logoColor=000)
![MongoDB](https://img.shields.io/badge/mongodb-atlas-47a248?logo=mongodb&logoColor=fff)
![Tests](https://img.shields.io/badge/tests-28%20passing-2ea44f)

![Overview of a generated kit: company brief, how they hire, sources, readiness and weak spots](docs/images/overview.jpg)

Prep Kit crawls the company's own site, looks for public discussion of how they interview, extracts what the posting actually asks for, and combines it all into a kit: a company brief, a role breakdown, a categorised question bank, flashcards and a day-by-day study schedule. Everything can be edited, reordered, pinned and regenerated section by section **without losing your work**, and you can practise inside the app.

- **Live app:** https://trao-the-ai-interview-prep-kit.vercel.app
- **API health:** https://trao-interview-prep-kit-api.onrender.com/api/health
- Render's free tier sleeps when idle; the first request after a pause can take 30 to 60 seconds.

## What it does

| | |
|---|---|
| **Research that responds to what it finds** | Crawls the company site, ranks links by how likely they are to describe the business or hiring, follows a careers page one level deeper, honours `robots.txt`, and searches public interview discussion. What is found changes which questions are asked. |
| **Requirements you can trust** | Every requirement must carry a verbatim quote from the posting; anything the model cannot quote is dropped. `must` versus `nice` comes from the posting's own wording. |
| **Coverage checked by code** | Code, not the model, finds requirements with no question and sends only those back for a targeted second pass (up to three), then falls back to a plain question so no must-have ships uncovered. |
| **A builder that respects your edits** | Edit, add, delete, pin, reorder, and move questions between categories. Regenerate one category, the brief, the flashcards or the schedule; edited, hand-written and pinned items are kept. |
| **Practice** | Flashcards least-confident first, a timed **mock interview** round, a **readiness score** with your weakest requirements, and a schedule that follows the calendar ("Today: day 2 of 5"). |
| **Honest about gaps** | Dead site, no hiring page, a two-line posting, no public discussion: each yields a thin kit that says so, never an invented one. |
| **Batch mode** | `npm run evaluate` runs the same pipeline over a file of postings. |
| **Print one-pager** | Export the whole plan to a clean, printable page. |

## Screenshots

| Question bank | Practice |
|---|---|
| ![Question bank with category tags, edit and pin controls](docs/images/questions.jpg) | ![Flashcard practice with confidence rating](docs/images/practice.jpg) |
| **Mock interview** | **Study schedule** |
| ![Timed mock interview with outline reveal](docs/images/mock.jpg) | ![Day by day schedule with today highlighted](docs/images/schedule.jpg) |

## How it works

```mermaid
flowchart LR
  JD[Pasted job description] --> R[Extract requirements<br/>LLM + verbatim-quote check]
  JD --> Role[Describe role<br/>LLM]
  URL[Company URL] --> C[Crawl company site<br/>ranked links, robots.txt]
  URL --> D[Search public discussion<br/>Hacker News]
  C --> B[Write company brief<br/>LLM over crawled text]
  D --> B
  R --> Q[Generate questions<br/>one call per category]
  B --> Q
  Q --> V{Coverage check<br/>code}
  V -- gaps --> G[Targeted second pass<br/>up to 3, then template]
  G --> V
  V -- covered --> F[Flashcards<br/>LLM]
  F --> S[Schedule<br/>code]
  S --> K[(Validated kit)]
```

Two steps are deliberately **not** given to the model: coverage comparison and schedule allocation. They are arithmetic, and a model asked "is everything covered?" will simply say yes. See [docs/PIPELINE.md](docs/PIPELINE.md).

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Frontend | React 19, Vite, TypeScript, hand-written CSS | An authenticated single-page tool with no server-rendering need; fast builds and a static deploy. The brief prefers Next.js with Tailwind but allows equivalents. |
| Backend | Node 20+, Express, TypeScript | As specified. |
| Database | MongoDB (Atlas free tier) | As specified. An in-memory store is used for local development only. |
| LLM | Google Gemini (`gemini-flash-lite-latest`, fallback models), free tier | Genuine free tier, JSON mode, fast. Calls are retried, rate-limited and fall back across models. |
| Retrieval | `fetch` and a small HTML cleaner, Hacker News Algolia API | No paid search key needed. |
| Validation | Zod | One schema is the contract for the API, the batch CLI and the UI. |
| Tests | Vitest, Supertest | 28 tests; plus live end-to-end and real-browser checks. |
| Hosting | Vercel (frontend), Render (API), MongoDB Atlas | All free tiers. |

## Quick start

```bash
git clone https://github.com/Sathvik2005/Trao--The-AI-Interview-Prep-Kit.git
cd Trao--The-AI-Interview-Prep-Kit
npm ci
cp .env.example .env     # set GEMINI_API_KEY and a JWT_SECRET of 32+ characters
npm run dev              # API on :3000, web on :5173
```

`MONGODB_URI` is optional locally: leave it empty and the app uses an in-memory store (data resets on restart). Get a free Gemini key at https://aistudio.google.com/apikey.

| Command | Purpose |
|---|---|
| `npm run dev` | API and web together with reload |
| `npm run build` | Typecheck and build the web bundle |
| `npm test -- --run` | Run the test suite |
| `npm run typecheck` | Type-check only |
| `npm run evaluate -- --input <cases.json> --output <kits.json>` | Batch entry point |
| `npm start` | Run the API (production) |

### Batch entry point

```bash
npm run evaluate -- --input cases.json --output kits.json
```

Input: an array of `{ "id", "jd", "company_url", "days" }`. Output: `{ "version": "1.0", "generated_at", "kits": [{ "id", "status", "kit", "error" }] }`. Cases run with limited concurrency and one failing case never stops the run. `failed` is reserved for a case where no kit could be produced; a partly researched case is `ok` with its gaps recorded in `research_notes`. The command exits non-zero if any case failed. Only `GEMINI_API_KEY` is required, and company sites may be local addresses (relative links are followed). Verified from a fresh clone.

## Configuration

| Variable | Where | Purpose |
|---|---|---|
| `GEMINI_API_KEY` | API, CLI | LLM access. Required in production. Never sent to the browser. |
| `GEMINI_MODEL` | API, CLI | Primary model (default `gemini-flash-lite-latest`). |
| `GEMINI_FALLBACK_MODELS` | API, CLI | Comma-separated fallbacks (default `gemini-3-flash-preview,gemini-3.1-flash-lite`). |
| `GEMINI_CONCURRENCY` | API, CLI | Max in-flight model calls (default 2). |
| `MONGODB_URI` | API | Atlas connection string. Required in production. |
| `MONGODB_DATABASE` | API | Database name (default `interview_prep_kit`). |
| `JWT_SECRET` | API | Signs sessions; 32+ random characters. |
| `FRONTEND_ORIGIN` | API | Comma-separated browser origins allowed to call the API. |
| `VITE_API_URL` | Web build | Public URL of the API, baked into the frontend build. |
| `GENERATION_RATE_LIMIT` | API | Generations per IP per 15 minutes (default 30). |
| `TEST_EMAIL`, `TEST_PASSWORD` | API | Optional reviewer login created at boot (12+ character password). |
| `DNS_SERVERS` | API (local) | Override resolvers when a network blocks MongoDB SRV lookups. |
| `NODE_ENV`, `PORT` | API | Standard. `production` enables strict address checks. |

## Documentation

| Document | What is in it |
|---|---|
| [Architecture](docs/ARCHITECTURE.md) | System context, components, data flow, state model, scaling |
| [Pipeline](docs/PIPELINE.md) | Research and generation step by step, retries, coverage loop, schedule maths |
| [API reference](docs/API.md) | Every endpoint, request, response and error |
| [Data model](docs/DATA_MODEL.md) | Kit schema (with extensions), MongoDB collections, provenance |
| [Security](docs/SECURITY.md) | Threat model and controls |
| [Deployment runbook](docs/DEPLOYMENT_RUNBOOK.md) | Atlas, Render, Vercel, and the failures actually hit |
| [Operations and handover](docs/OPERATIONS.md) | Running it, monitoring, secrets, costs, incident checklist |
| [Development guide](docs/DEVELOPMENT.md) | Layout, conventions, testing, troubleshooting |
| [Design decisions](docs/DECISIONS.md) | The choices and trade-offs, in decision-record form |
| [Test report](docs/TEST_REPORT.md), [E2E report](docs/E2E_REPORT.md) | What was verified and how |
| [Requirements traceability](docs/REQUIREMENTS_TRACEABILITY.md), [Known issues](docs/KNOWN_ISSUES.md) | Brief mapping; limitations |

## Project layout

```
src/
  domain/      schema, validation, coverage, schedule, requirement grounding, reconcile and provenance (pure)
  research/    company crawl, link ranking, robots.txt, address safety, public-discussion search
  llm/         Gemini client (retry, fallback, cooldown) and the separately prompted generation steps
  pipeline/    generateInterviewKit and regenerateSection
  api/         Express routes, auth, background jobs, MongoDB and in-memory stores
  cli/         batch entry point
  web/         React UI
test/          domain, pipeline, regeneration, API and batch tests
docs/          documentation
```

## Quality

- **28 automated tests** cover schedule allocation, coverage, schema validation, requirement grounding, regeneration preserving edits, research behaviour, the API and the batch contract.
- **Live end-to-end** against Atlas, real Gemini, posthog.com and Hacker News: 28 of 28 checks pass, about 25 seconds per kit.
- **Real-browser checks** (headless Chrome) against the deployed site: edit autosave, regeneration that keeps your edit, persistence after reload, mock round, print sheet, sign-out.
- **Security:** private-address blocking with DNS and redirect checks, size and content-type limits, page text treated strictly as data, hashed passwords, revocable sessions, owner-scoped queries. `npm audit` on production dependencies reports 0 vulnerabilities.

## Known limitations

Job progress lives in memory on one API instance; public discussion comes only from Hacker News; the crawler reads server-rendered HTML; the UI is a single large module that would be split as it grows; question quality depends on a free-tier model. The full list is in [docs/KNOWN_ISSUES.md](docs/KNOWN_ISSUES.md).

## Author

Built by Sathvik ([@Sathvik2005](https://github.com/Sathvik2005)). AI coding assistance was used throughout; every design decision above was reviewed and verified against running code.
