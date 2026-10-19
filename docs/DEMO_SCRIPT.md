# Demo Script (3–4 minutes)

Only demonstrate flows that have actually been verified in the environment.

1. **Account (25 sec):** register or sign in. Explain that local `MONGODB_URI=` selects ephemeral in-memory mode; a production deployment uses MongoDB and owner-scoped JWT sessions.
2. **Create a kit (35 sec):** enter job text, company URL and preparation days; show progress and resulting sources. Note that the current question generation is template-based.
3. **Review signals (35 sec):** inspect requirements, question links and deterministic schedule. Show the day count and coverage map.
4. **Edit (30 sec):** edit a prompt/outline, reorder, save, and reload to verify persistence when backed by MongoDB. Do not claim this persistence from memory mode.
5. **Practice (35 sec):** reveal a flashcard, rate confidence, and show weaker/unrated cards prioritized.
6. **Batch (35 sec):** run `npm run evaluate -- --input test/fixtures/evaluate-cases.json --output tmp/evaluate-results.json`; show the valid local-site kit and isolated invalid cases.
7. **Engineering decisions (30 sec):** strict Appendix A validation, deterministic scheduling, per-user authorization, and bounded research fetches. Close with the unverified deployment and missing section-regeneration behavior.

Live deployment is not verified; do not present an unverified URL.
