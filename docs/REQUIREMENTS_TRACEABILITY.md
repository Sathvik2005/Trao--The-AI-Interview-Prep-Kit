# Requirements Traceability

Points below reflect the assessment summary and are not an awarded score. The original PDF still needs a direct final cross-check.

| ID | Requirement / points | Implementation | Verification | Status | Next action |
|---|---|---|---|---|---|
| R1 | Grounded requirements and priority / 20 | `src/domain/requirements.ts`, `src/llm/gemini-requirements.ts`, `src/pipeline/generate-kit.ts` | `test/domain.test.ts`; sparse JD test in `test/pipeline.test.ts` | PARTIAL | Broaden local fallback and add requirement-category fixtures. |
| R2 | Coverage and deterministic schedule / 15 | `src/domain/coverage.ts`, `src/domain/schedule.ts`, `src/domain/kit-schema.ts` | Domain tests verify coverage, references, one- and 60-day schedules | PASS for tested invariants | Add varied 1–60-day property-style cases. |
| R3 | Dynamic research and staged generation / 10 | `src/research/company-research.ts`, `src/pipeline/generate-kit.ts` | Local fixture-backed pipeline and batch run | PARTIAL | Honor robots/terms and make question generation evidence/model-backed. |
| R4 | Robustness and exact structure / 10 | `src/domain/kit-schema.ts`, `src/cli/evaluate.ts`, `src/api/app.ts` | `test/domain.test.ts`, `test/evaluate.test.ts`, `test/api.test.ts`; real batch output inspected | PARTIAL | Add malformed Gemini/429 fixtures and five representative successful cases. |
| R5 | Builder/edit/regeneration / 15 | `src/web/main.tsx`, `src/api/app.ts`, `src/api/store.ts` | Production build; API tests cover validation and owner isolation | PARTIAL | Add/delete/pin and section regeneration that preserves manual edits. |
| R6 | Responsive/accessibility / 10 | `src/web/main.tsx`, `src/web/styles.css` | Local browser displayed sign-up and saved-kit view | PARTIAL | Complete keyboard, mobile, screen-reader and error-state review. |
| R7 | Code quality and reasoning / 10 | Domain, pipeline, API, README, docs | Typecheck and automated tests | PARTIAL | Cross-check docs against original PDF and live Mongo setup. |
| R8 | Practice mode / 10 | `src/web/main.tsx`, `src/api/app.ts`, `src/api/store.ts` | Practice confidence API tests; local browser authenticated | PARTIAL | Verify weak-first behavior after reload and add question practice. |
| R9 | Appendix A exact contract | `src/domain/kit-schema.ts` | Domain tests and successful batch result validation | PASS for current schema | Verify each clause against original PDF. |
| R10 | Appendix B batch contract | `src/cli/evaluate.ts` | Required command wrote ordered output: one `ok`, two isolated `failed` | PASS for exercised contract | Expand timing fixture set to five valid local cases. |
| R11 | Auth, storage, user ownership | `src/api/app.ts`, `src/api/store.ts`, `src/api/memory-store.ts` | API tests use MemoryStore; local health reports memory | PARTIAL | Run MongoStore against Atlas/local Mongo to verify durable persistence and indexes. |
| R12 | Public deployment | `render.yaml`, `vercel.json` | No provider deployment or URL verified | NOT VERIFIED | Provision Atlas/Render/Vercel, configure secrets, run live smoke. |
