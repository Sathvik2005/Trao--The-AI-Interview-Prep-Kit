# Known issues and limitations

Stated plainly so nobody has to discover them.

## Architecture

- **Generation progress is in memory on one API instance.** A restart during a build loses that build's progress view and the kit is not saved (the user retries). Running several instances would need job state moved into MongoDB.
- **The UI is one large module** (`src/web/main.tsx`). It works and is tested, but it should be split into per-view components as it grows.

## Research

- **Public discussion comes only from Hacker News.** Companies rarely discussed there get an honest "nothing found" note.
- **The crawler reads server-rendered HTML.** Pages rendered entirely in the browser yield little text.
- **`robots.txt` support is partial:** `User-agent: *` `Disallow` rules only, not `Crawl-delay` or wildcard patterns.

## Model

- **Question quality depends on a small free-tier model** and is validated structurally (ids, requirement links, categories), not graded by a second model.
- **The coverage second pass fires only when the model omits a requirement.** It is unit-tested and can be triggered on demand from the UI, but it did not need to fire on the live PostHog run.
- **Model availability changes.** The default is the `gemini-flash-lite-latest` alias with fallbacks; set `GEMINI_MODEL` or `GEMINI_FALLBACK_MODELS` if one is retired. On a bad day (provider overloaded) kits can take a minute or more.

## Security

- **The session token is kept in `sessionStorage`**, so a cross-site scripting bug would expose it.
- **There is no per-user model cost budget** beyond rate limits.
- **DNS rebinding** between the address check and the connection is narrowed (re-checked on every redirect) but not eliminated.

## Hosting

- **The free Render tier sleeps when idle**; the first request takes 30 to 60 seconds.
- **Atlas must allow `0.0.0.0/0`** because Render's free tier has no fixed address; protection comes from the database credentials.
- **No license has been chosen** for the repository.

## Out of scope by design

Job search or aggregation, CV parsing, applying to jobs, audio or video simulation, payments, team and sharing features, email verification, password reset and role hierarchies.
