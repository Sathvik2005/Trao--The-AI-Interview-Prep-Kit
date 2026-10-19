# Known issues and limitations

- Generation progress is held in memory on a single backend instance. A restart mid-generation loses the progress view; the kit is only saved when complete. Scaling to several instances would need job state in MongoDB.
- Public discussion comes only from Hacker News. Companies rarely discussed there get an honest "nothing found" note.
- The crawler reads server-rendered HTML. Pages rendered purely client-side yield little text.
- `robots.txt` support covers `User-agent: *` Disallow rules, not Crawl-delay or wildcard patterns.
- Question quality depends on a free-tier model and is validated structurally (ids, requirement links, categories), not graded by a second model.
- The coverage second pass is unit-tested but only triggers live when the model omits a requirement; it did not fire on the PostHog run.
- The session token is stored in `sessionStorage`; an XSS bug would expose it. There is no per-user LLM cost budget beyond rate limits.
- Gemini model availability changes. The default is the `gemini-flash-lite-latest` alias with fallback models; set `GEMINI_MODEL` or `GEMINI_FALLBACK_MODELS` if a model is retired.
- The free Render tier sleeps when idle; the first request takes about 30-60 seconds.
- The UI has been built and type-checked but not recorded in a browser session in the development environment.
