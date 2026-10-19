# Development guide

## Setup

Requirements: Node 20 or newer, npm, a free Gemini API key (https://aistudio.google.com/apikey). MongoDB is optional locally.

```bash
npm ci
cp .env.example .env
# set GEMINI_API_KEY and a JWT_SECRET of at least 32 characters
npm run dev        # API :3000 (tsx watch) and web :5173 (Vite, proxies /api)
```

Leave `MONGODB_URI` empty to use the in-memory store; accounts and kits disappear on restart. To use Atlas locally, set `MONGODB_URI`. If it is set but unreachable in development, the server warns and falls back to memory instead of crashing (production refuses to start).

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | API and web with reload |
| `npm run dev:api`, `npm run dev:web` | One side only |
| `npm run typecheck` | `tsc --noEmit`, strict |
| `npm test -- --run` | Vitest suite (28 tests) |
| `npm run build` | Typecheck and production web build into `dist/` |
| `npm start` | Run the API as in production |
| `npm run evaluate -- --input a.json --output b.json` | Batch entry point |

## Repository layout

```
src/domain/     pure rules: schema, coverage, schedule, requirements, reconcile
src/research/   crawl, link ranking, robots.txt, address safety, discussion search
src/llm/        Gemini client; prompted steps (requirements, role, brief, questions, flashcards)
src/pipeline/   generateInterviewKit, regenerateSection
src/api/        Express app, jobs, MongoDB and in-memory stores
src/cli/        batch entry point
src/web/        React UI (main.tsx, styles.css, extra.css)
test/           domain, pipeline, regenerate, api, evaluate tests
docs/           documentation
```

## Conventions

- **Dependency direction:** web, then API, then pipeline, then research and llm, then domain. Domain imports nothing else. New rules that decide correctness belong in `domain/` with a test.
- **Untrusted text** (job descriptions, crawled pages) must only reach a model inside JSON with the "data, not instructions" preamble used in `src/llm/`.
- **Model output** is never trusted: parse with Zod, filter ids to known values, and verify quotes against the source.
- **Errors** returned by the API use the shared `{ error: { code, message } }` shape; never return stack traces.
- **Schema changes** must keep the Appendix A fields named exactly; add new fields as optional extensions.
- TypeScript is strict; avoid `any`.

## Testing

| Layer | How |
|---|---|
| Domain | Pure unit tests: schedule allocation, coverage, schema invariants, requirement grounding |
| Pipeline | Injected `fetchPage`, `searchPublicDiscussion` and a stub `GenerationLlm`; no network |
| Regeneration | Real `regenerateSection` with a stub model: edits, pins, other categories and the schedule |
| API | Supertest against the real app with the in-memory store and a stub generator |
| Live | `GEMINI_API_KEY` set; run the batch command or exercise the deployed site |

Injectable seams (`llm`, `fetchPage`, `searchPublicDiscussion`, `generateKit`, `regenerate`) keep tests offline and deterministic.

## Adding a question category or a pipeline step

1. Extend the category type in `src/domain/kit-schema.ts` and the planner in `planCategories`.
2. Add the prompt in `src/llm/generation-llm.ts` with a tolerant Zod schema.
3. Emit a progress event so the UI shows the step (and add its label in `src/web/main.tsx`).
4. Add a unit test with the stub model.

## Troubleshooting

| Problem | Fix |
|---|---|
| `querySrv ECONNREFUSED` connecting to Atlas | Your network blocks SRV lookups: set `DNS_SERVERS=8.8.8.8,1.1.1.1` |
| Model returns 404 | The model was retired for new keys; set `GEMINI_MODEL` to a current one |
| Generation very slow | The provider is busy; calls retry and fall back automatically |
| `No space left on device` during builds | Free disk space; the build writes to `dist/` and `node_modules/` |
| Web cannot reach API in dev | Run `npm run dev` (Vite proxies `/api` to :3000) or set `VITE_API_URL` |
