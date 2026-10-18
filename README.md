# AI Interview Prep Kit

Turns a job description plus a company website into a personalised interview preparation kit: company brief, role breakdown, categorised question bank, flashcards and a day-by-day study schedule.

## Stack
- **Frontend:** React + Vite (`src/web`)
- **Backend:** Node.js + Express 5, TypeScript (`src/api`, `src/server.ts`)
- **Database:** MongoDB
- **LLM:** Google Gemini (`gemini-2.5-flash` by default, free tier)
- **Validation:** zod

## Layout
| Path | Responsibility |
| --- | --- |
| `src/research` | Company site crawl and retrieval |
| `src/llm` | Gemini requirement extraction |
| `src/domain` | Kit schema, requirements, coverage check, schedule allocation (deterministic, no model) |
| `src/pipeline` | Orchestrates the generation steps |
| `src/api` | Express app and persistence |
| `src/cli/evaluate.ts` | Batch entry point |

Requirements are only accepted when their `source_quote` appears verbatim in the job description, so nothing is invented. Coverage checking and schedule allocation are plain code.

## Setup
```bash
npm install
cp .env.example .env   # set JWT_SECRET and GEMINI_API_KEY
npm run dev            # API + web
npm test
```

## Batch run
```bash
npm run evaluate -- --input cases.json --output kits.json
```

## Environment variables
See `.env.example`: `PORT`, `MONGODB_URI`, `MONGODB_DATABASE`, `JWT_SECRET`, `FRONTEND_ORIGIN`, `GEMINI_API_KEY`, `GEMINI_MODEL`.

## Status
Work in progress; the README will be extended with architecture, retrieval sources, regeneration/edit-state design and known limitations.
