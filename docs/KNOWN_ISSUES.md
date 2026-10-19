# Known Issues

Updated 2026-10-18; ordered by impact.

1. **No persistent database or public deployment verified.** No Atlas URI/account access was supplied. Local no-Docker mode is ephemeral MemoryStore; production requires MongoDB. Provision Atlas/Render/Vercel and test real persistence.
2. **Question generation is still templated.** Gemini extracts requirements only; questions and flashcards are generic templates, and research evidence has little effect on them. This limits the central assessment value. Add model-backed category-specific generation with strict output schema and offline fixtures.
3. **Edit-preserving regeneration is missing.** Prompt edits/reordering persist, but add/delete/pin, provenance, and scoped regeneration are absent. Implement explicit generated/edited/pinned state and conditional update to prevent overwriting newer edits.
4. **Research policy gaps.** Production fetches bound timeout/body/content type/redirect count and reject private/reserved addresses, but do not enforce robots.txt or terms. DNS answers are checked but not pinned to the socket, leaving DNS-rebinding risk. Public discussion results are not verified as source content.
5. **JWT in sessionStorage.** Active token is exposed to JavaScript; XSS can steal it. No CSP/browser security review is completed. Consider an HttpOnly refresh-cookie design and deploy a strict CSP.
6. **Browser accessibility/responsiveness not fully audited.** The UI rendered locally, but mobile keyboard/screen-reader checks and end-to-end generation were not completed.
7. **Original PDF cross-check remains.** Requirements are based on the supplied audit summary and user prompt; verify Appendix A/B directly in the assessment PDF before final sign-off.
8. **Dependency audit is outstanding.** npm reported vulnerabilities in the full dependency tree; production-only audit needs a fresh run and applicable advisories should be reviewed.
