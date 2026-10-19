# Data model

## Kit (Appendix A structure plus optional extensions)

The assessment's required fields are present and named exactly. Extensions are optional and clearly marked.

```jsonc
{
  "source": {
    "company": "", "company_url": "", "role": "", "location": "",
    "jd_chars": 0, "researched_at": "", "pages_used": ["https://..."],
    "input_hash": ""                       // extension: de-duplication key
  },
  "company_brief": {
    "summary": "", "what_they_do": "", "sources": ["https://..."],
    "hiring_process": ""                   // extension: what the sources say about how they hire
  },
  "role": {
    "title": "", "seniority": "", "responsibilities": [""],
    "requirements": [
      { "id": "r-9f2a...", "text": "", "kind": "technical|behavioural|domain", "priority": "must|nice" }
    ]
  },
  "questions": [
    {
      "id": "q-1a2b3c4d", "requirement_ids": ["r-9f2a..."],
      "category": "technical|behavioural|system-design|company-fit",
      "prompt": "", "answer_outline": "", "difficulty": 2,
      "origin": "generated|edited|manual",  // extension
      "pinned": false                        // extension
    }
  ],
  "flashcards": [
    { "id": "f-5e6f7a8b", "front": "", "back": "", "requirement_ids": ["r-9f2a..."], "origin": "generated", "pinned": false }
  ],
  "schedule": {
    "days_available": 5,
    "days": [{ "day": 1, "focus": "", "question_ids": ["q-1a2b3c4d"], "minutes": 60 }]
  },
  "coverage": { "uncovered_requirement_ids": [], "passes": 2 },
  "research_notes": [""]                     // extension: honest record of gaps and skipped sources
}
```

### Invariants (enforced by `src/domain/kit-schema.ts`)

- Requirement, question and flashcard ids are unique within the kit.
- Every `requirement_ids` entry refers to a real requirement.
- `difficulty` is an integer 1 to 3; `minutes` is a non-negative integer.
- `coverage.uncovered_requirement_ids` equals the real set of requirements no question references.
- Every `must` requirement is referenced by a question **and** that question is scheduled.
- `schedule.days` has exactly `days_available` entries, numbered 1..N; every scheduled id is a real question; every question is scheduled.
- Unknown fields are rejected (`strict`).

### Ids
Requirement ids are `r-` plus a 12-character hash of the requirement text (stable across regenerations). Question and flashcard ids are `q-`/`f-` plus a short hash of their content, with a counter suffix on collision. Ids never change once created.

### Provenance
`origin` records who wrote an item (`generated`, `edited`, `manual`); `pinned` protects it from regeneration. Assigned server-side on save. See [ARCHITECTURE.md](ARCHITECTURE.md#5-state-model-generated-edited-pinned).

## MongoDB collections

| Collection | Fields | Indexes |
|---|---|---|
| `users` | `_id`, `email` (lower-case), `password_hash` (bcrypt), `created_at` | unique `email` |
| `sessions` | `_id`, `user_id`, `token_hash` (SHA-256 of the JWT), `expires_at` | unique `token_hash`; TTL on `expires_at` (expired sessions delete themselves) |
| `kits` | `_id`, `user_id`, `kit` (the document above), `practice` (`[{ flashcard_id, confidence }]`, ids may be flashcards or questions), `created_at`, `updated_at` | `{ user_id: 1, updated_at: -1 }` |

Every kit query filters by `user_id`, so one user can never read or change another's kit. A kit is a single document (well under the 16 MB limit).

## Batch output (Appendix B)

```json
{ "version": "1.0", "generated_at": "2026-10-19T14:48:38Z",
  "kits": [
    { "id": "case-01", "status": "ok", "kit": { }, "error": null },
    { "id": "case-04", "status": "failed", "kit": null, "error": { "code": "KIT_GENERATION_FAILED", "message": "..." } }
  ] }
```

One entry per input case, in input order. `failed` means no kit could be produced at all; a partly researched case is `ok` with the gaps in `research_notes`.
