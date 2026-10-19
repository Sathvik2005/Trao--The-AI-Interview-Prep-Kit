# Research and generation pipeline

`generateInterviewKit(input, deps)` in `src/pipeline/generate-kit.ts`. Each step emits a progress event (`running`, `done`) that the UI shows as it happens.

## Principle

Use the model for language and judgement over text; use code for anything that is arithmetic or a rule. The model never decides whether everything is covered, which day a question lands on, or whether the kit is valid.

## Steps

### 1. Extract requirements
The model returns candidates `{ text, source_quote, kind, priority }`. Code keeps a candidate **only if its `source_quote` appears verbatim** (case and whitespace-insensitive) in the description. `must` versus `nice` follows the posting's wording ("required", "must", "minimum" versus "preferred", "bonus"). Ids are a hash of the requirement text, so they are stable. A two-line posting therefore produces zero or few requirements and the kit says so.

### 2. Describe the role
Title, seniority, location and up to six responsibilities, only where stated. A heuristic fallback is used if the call fails.

### 3. Research the company (no model)
- Validate the URL (http/https only; private, loopback and link-local addresses rejected in production, including after DNS resolution and every redirect).
- Fetch `robots.txt` and respect `User-agent: *` `Disallow` rules.
- Fetch the homepage and rank internal links by path and anchor text. Strong signals: careers, jobs, hiring, interview, engineering, handbook, culture, about. Negative signals: login, pricing, legal, assets.
- Fetch up to 8 pages, spaced 400 ms apart, with 429/503 backoff. From a good careers or about page (score 6 or more) follow up to three promising links one level deeper.
- Responses must be `text/html`, `text/plain` or `application/xhtml+xml`; bodies are truncated at 1 MB (a large homepage is read, not rejected).
- Search public discussion: the Hacker News Algolia API for `<company> interview`, kept only if the item names the company and mentions interview vocabulary.
- Anything that fails is recorded in `research_notes`; nothing here aborts the run.

### 4. Company brief
The model summarises only the supplied page text and discussion snippets: `summary`, `what_they_do`, `hiring_process`. If nothing was retrieved the brief states that plainly and no model call is made. Page text is passed inside JSON with an explicit instruction that it is data to analyse, never instructions.

### 5. Questions, one call per category
Categories are chosen by code from each requirement's kind: technical, behavioural, company-fit (domain). **System-design** is added when a requirement is architectural or the hiring-process text mentions a system-design round. So what research found changes what is asked. Each category is its own prompt, with the requirement ids it may reference. Output is validated and ids are filtered to known requirements.

### 6. Coverage check and second pass
Code computes the requirements that no question references. Those, and only those, are sent back for targeted generation (grouped by category), up to **three** passes. If anything is still uncovered, a plain template question is added with a note, so a must-have can never ship uncovered. `coverage.passes` records the number of passes (the first draft counts as one).

Why three: one pass is a single shot; a miss is almost always an omission and a targeted retry fixes it; a third attempt absorbs a flaky response. Beyond that the model is unlikely to succeed and further calls only spend a rate-limited free tier.

### 7. Flashcards
One call over all requirements; any requirement without a card gets a plain card so every requirement is represented.

### 8. Schedule (no model)
`createSchedule` in `src/domain/schedule.ts`:
1. Refuse to run if a must-have requirement is uncovered.
2. Sort questions: must-have first, then difficulty (hard first), then id for determinism.
3. Split into exactly `days` contiguous groups, so harder and higher-priority material lands earlier.
4. `minutes = sum(15 + 10 × difficulty)` per day; `focus` names the categories on that day.

### 9. Validate
Zod structure plus cross-reference rules: unique ids, known requirement ids, coverage matches the real analysis, every must-have has a question and a scheduled question, exactly `days_available` schedule days, every scheduled id exists.

## Model access (`src/llm/gemini.ts`)

- JSON mode; reduced "thinking" for speed; 60 s timeout.
- Process-wide concurrency cap (default 2).
- Up to 3 attempts per model with exponential backoff, honouring `Retry-After`.
- Model chain: `GEMINI_MODEL`, then `GEMINI_FALLBACK_MODELS`. A model that exhausts its retries is cooled down for 45 s and tried last.
- A 400 caused by an unsupported thinking setting is retried once without it.
- Parsing is tolerant (a list where a string was asked for is joined) so a harmless shape variation does not discard a whole category.

## Regeneration (`regenerateSection`)

| Section | Behaviour |
|---|---|
| `company_brief` | Re-research and rewrite the brief and sources; nothing else changes |
| `questions` (optionally one category) | Keep edited, manual and pinned items and every other category; regenerate the rest; run the coverage loop; reconcile the schedule |
| `flashcards` | Keep protected cards; regenerate cards for requirements left without one |
| `schedule` (optional `days`) | Recompute the allocation; questions untouched |
| `coverage` | Run only the second pass for requirements with no question |

## Edge cases

| Case | Result |
|---|---|
| Invalid or unreachable company URL, 404, timeout | `ok` kit, note recorded, minimal honest brief |
| No hiring or about page found | Note recorded; rest unaffected |
| Two-line description | Few or no requirements; thin kit that says so |
| No public discussion | Note recorded |
| Model rate limit or bad JSON | Retry, fall back, coverage loop retries the category |
| Same posting submitted twice | The existing kit is returned (input hash) |
| 1-day and 60-day schedules | Exactly the requested number of days |
