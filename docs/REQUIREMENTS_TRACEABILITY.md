# Requirements traceability

The brief-section-by-section mapping with evidence lives in [E2E_REPORT.md](./E2E_REPORT.md). Architecture, retrieval approach, state model and schedule allocation are described in the root [README](../README.md).

| Scoring area | Where it is implemented |
|---|---|
| Requirement extraction (20) | `src/llm/gemini-requirements.ts`, `src/domain/requirements.ts` (verbatim-quote grounding, must/nice) |
| Coverage and schedule (15) | `src/domain/coverage.ts`, `src/domain/schedule.ts`, `closeCoverageGaps` in `src/pipeline/generate-kit.ts` |
| Research and sequencing (10) | `src/research/company-research.ts`, `src/pipeline/generate-kit.ts` |
| Robustness (10) | `src/llm/gemini.ts` (retry, fallback), tolerant parsing, `notes` for unreachable sites, `src/cli/evaluate.ts` |
| Builder and regeneration (15) | `src/web/main.tsx`, `src/domain/reconcile.ts`, `regenerateSection` |
| Interaction design (10) | progress steps, empty and error states, autosave, skip link, responsive CSS |
| Code quality and README (10) | module split under `src/`, `README.md` |
| Practice mode (10) | practice view in `src/web/main.tsx`, `/api/kits/:id/practice` |
