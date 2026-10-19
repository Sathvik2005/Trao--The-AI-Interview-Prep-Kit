# Design decisions

Short decision records: context, choice, consequence.

## D1. Coverage and scheduling are code, not model output
**Context.** Both are well-defined: a set difference and an allocation. A model asked "is every requirement covered?" tends to say yes.
**Decision.** Code computes uncovered requirements and builds the schedule. The model only writes text.
**Consequence.** Deterministic, testable, and the "no uncovered must-have" invariant is enforced by validation, not hoped for.

## D2. Requirements must carry a verbatim quote
**Context.** Models invent plausible requirements, which is worse than reporting few.
**Decision.** Each extracted requirement carries a `source_quote`; code drops any candidate whose quote is not in the posting. `must` versus `nice` follows the posting's wording.
**Consequence.** A thin posting gives a thin kit that says so. Occasionally a legitimate paraphrase is dropped; that is the intended trade.

## D3. Up to three coverage passes, then a template
**Context.** One pass is a single shot; unbounded loops waste a rate-limited free tier.
**Decision.** Targeted retries for only the uncovered requirements, at most three, then a plain template question with a note.
**Consequence.** The invariant holds in every case; `coverage.passes` records the effort. See [PIPELINE.md](PIPELINE.md#6-coverage-check-and-second-pass).

## D4. Partial research is a result, not a failure
**Context.** Companies block crawlers, have no hiring page, or are unknown.
**Decision.** Research never throws; gaps go into `research_notes` and the brief says plainly what could not be found. `failed` is reserved for no kit at all.
**Consequence.** Users always get something honest; batch runs rarely fail.

## D5. Provenance assigned by the server
**Context.** Regeneration must not destroy user work, and that requires knowing what the user touched.
**Decision.** On every save the server diffs against the stored kit and sets `origin`; `pinned` is a user flag. Regeneration removes only unprotected generated items in the chosen category.
**Consequence.** The client cannot forget to mark an edit; safety is by construction.

## D6. Background jobs with polling
**Context.** A kit takes 10 to 90 seconds and may fail halfway; hosting platforms time out long requests.
**Decision.** `POST /api/kits` returns a job id; the UI polls step-level progress; nothing is saved unless the kit validates.
**Consequence.** Visible progress and clean failure, at the cost of in-memory job state (single instance).

## D7. One model chain with guards
**Context.** Free-tier models return 429/503, change names, and vary in output shape.
**Decision.** A process-wide concurrency cap, retries with backoff and `Retry-After`, a fallback chain, a cooldown for failing models, a fallback for unsupported options, and tolerant output parsing.
**Consequence.** Kits complete on bad days; latency rises when the primary is down.

## D8. Hacker News as the public-discussion source
**Context.** The brief asks for public discussion of how a company interviews. General web search needs a paid key or scrapes against terms; review sites prohibit scraping.
**Decision.** Use the keyless Hacker News Algolia search API, filtered to items that name the company and mention interview vocabulary.
**Consequence.** Legitimate and reproducible; coverage is limited to companies discussed there, reported honestly otherwise.

## D9. Vite and React instead of Next.js and Tailwind
**Context.** The brief prefers Next.js with Tailwind and allows equivalents with justification.
**Decision.** Vite, React and hand-written CSS with design tokens.
**Consequence.** The app is an authenticated single-page tool with no server-rendering need; builds are fast and Vercel serves a static bundle. SEO and server components are not available (not needed).

## D10. One repository, two deployments
**Context.** The batch command and the web app must run the same pipeline.
**Decision.** A single repository; the frontend deploys to Vercel and the API to Render.
**Consequence.** No duplicated pipeline code; each side scales and redeploys independently.

## D11. Readiness, mock interview and today's plan
**Context.** Preparation fails where people do not know their weak areas, never rehearse under time pressure, and lose track of the plan.
**Decision.** Compute readiness per requirement from the user's own ratings (must-haves weighted double), add a timed mock round that writes ratings back, and anchor the schedule to the calendar.
**Consequence.** The kit becomes something to work through. All three reuse existing data; no extra service.

## D12. Client-side edits are immediate; the server repairs derived data
**Context.** Typing must not wait on a round trip, but schedule, coverage and provenance are derived.
**Decision.** Local state updates instantly and saves after a short debounce; the server reconciles and the client merges back only the derived fields.
**Consequence.** Editing feels instant and typing is never overwritten.
