# Requirements traceability

Maps each scored area of the brief to where it is implemented and tested. Evidence is in [E2E_REPORT.md](E2E_REPORT.md).

| Scoring area (points) | Implementation | Tests |
|---|---|---|
| Requirement extraction (20) | `src/llm/gemini-requirements.ts`, `src/domain/requirements.ts`: verbatim-quote grounding, must/nice from wording, stable ids | `test/domain.test.ts`; live: bonus requirement marked `nice`, stub yields none |
| Coverage and schedule (15) | `src/domain/coverage.ts`, `src/domain/schedule.ts`, `closeCoverageGaps` in `src/pipeline/generate-kit.ts`, validation in `src/domain/kit-schema.ts` | `test/domain.test.ts`, `test/regenerate.test.ts` |
| Research and sequencing (10) | `src/research/company-research.ts` (crawl, ranking, robots, discussion), `src/pipeline/generate-kit.ts` (ordered steps, separate category calls, coverage loop) | `test/regenerate.test.ts`, `test/pipeline.test.ts` |
| Robustness (10) | `src/llm/gemini.ts` (retry, fallback, cooldown), tolerant parsing, research notes for unreachable sites, `src/cli/evaluate.ts` | `test/evaluate.test.ts`, live batch run, live dead-site and stub cases |
| Builder, edit, reorder, regenerate without losing edits (15) | `src/web/main.tsx`, `src/domain/reconcile.ts`, `regenerateSection` | `test/regenerate.test.ts`, `test/api.test.ts`, real-browser flow |
| Interaction design (10) | Step progress, skeletons, empty and error states, autosave status, skip link, labelled controls, responsive CSS | Real-browser flow |
| Code quality, separation of concerns, README (10) | Layered modules under `src/`; [ARCHITECTURE.md](ARCHITECTURE.md), [DECISIONS.md](DECISIONS.md), README | Typecheck, tests |
| Practice mode and creative feature (10) | Practice, mock interview, readiness, today's plan, print one-pager, on-demand coverage pass in `src/web/main.tsx` | Real-browser flow |

## Brief section to code

| Brief section | Code |
|---|---|
| 1 Authentication | `src/api/app.ts` (auth routes, token checks), `src/api/store.ts` |
| 2 Input and research | `src/web/main.tsx` (form, upload), `src/research/company-research.ts` |
| 3 Research and generation | `src/pipeline/generate-kit.ts`, `src/llm/generation-llm.ts` |
| 4 Second pass | `closeCoverageGaps`, section `coverage` of `regenerateSection` |
| 5 Kit structure | `src/domain/kit-schema.ts` |
| 6 Builder | `src/web/main.tsx`, `src/domain/reconcile.ts` |
| 7 Practice | `src/web/main.tsx`, `POST /api/kits/:id/practice` |
| 8 Schedule | `src/domain/schedule.ts` |
| 9 Batch entry point | `src/cli/evaluate.ts` |
| 10 Edge cases | `src/research/company-research.ts`, `src/pipeline/generate-kit.ts`, `src/api/app.ts` |
| 11 Security | `src/research/company-research.ts`, `src/llm/generation-llm.ts`, `src/api/app.ts`; [SECURITY.md](SECURITY.md) |
| 12 and 13 Front and back end | `src/web/`, `src/api/` |
| 14 Code quality | whole repository; `test/` |
