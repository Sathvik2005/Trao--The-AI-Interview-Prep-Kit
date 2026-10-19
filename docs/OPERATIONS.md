# Operations and handover

For whoever runs this after the original author.

## Environments

| | URL | Hosting | Notes |
|---|---|---|---|
| Frontend | https://trao-the-ai-interview-prep-kit.vercel.app | Vercel (free) | Static build; redeploys on push to `main` |
| API | https://trao-interview-prep-kit-api.onrender.com | Render (free web service) | Sleeps when idle; redeploys on push to `main` |
| Database | MongoDB Atlas M0 | Atlas (free) | Database `interview_prep_kit`; collections `users`, `sessions`, `kits` |
| Model | Google Gemini API | Google AI Studio free tier | Default `gemini-flash-lite-latest` with fallbacks |

## Secrets and who holds them

| Secret | Stored in | Rotation |
|---|---|---|
| `GEMINI_API_KEY` | Render environment | Create a new key in AI Studio, update Render, delete the old key |
| `MONGODB_URI` (contains the DB password) | Render environment | Change the Atlas database user's password, update the URI in Render |
| `JWT_SECRET` | Render environment (generated) | Changing it signs everyone out, which is safe |
| `TEST_PASSWORD` | Render environment | Optional reviewer login; remove the variable to stop seeding |

Nothing secret is committed. If a key was ever pasted into a chat, ticket or log, rotate it.

## Health checks

- `GET /api/health` returns `{"status":"ok","persistence":"mongodb"}`. Render polls this. `memory` means the database connection failed and the service should be treated as down.
- A failed Atlas connection at startup prints a `FATAL` message with a four-point checklist and exits, so the platform marks the deploy as failed instead of serving a broken service.

## Logs

Render dashboard, service, Logs. Useful lines:

| Line | Meaning |
|---|---|
| `Interview Prep Kit listening on port ...` | Started |
| `Seeded demo account for ...` | Reviewer login created |
| `Kit generation failed: ...` | A generation could not complete (provider error text follows) |
| `Regeneration failed: ...` | A section rebuild failed; the kit is unchanged |
| `FATAL: could not connect to MongoDB Atlas` | Network Access, paused cluster, URI or Node version |

Errors returned to users never include stack traces; details are in the logs only.

## Capacity and cost

- Free tiers only. Atlas M0 has 512 MB of storage; a kit is a few tens of kilobytes.
- Each kit uses about 7 to 10 model calls. The binding constraint is the model provider's free-tier rate limit, not hosting. The client retries with backoff and falls back across models.
- Render free: one instance, sleeps after about 15 minutes idle (30 to 60 s cold start), limited monthly hours. A paid instance removes the sleep.

## Common tasks

| Task | How |
|---|---|
| Change the model | Set `GEMINI_MODEL` (and optionally `GEMINI_FALLBACK_MODELS`) in Render; no code change |
| Allow another frontend origin | Add it, comma-separated, to `FRONTEND_ORIGIN` |
| Raise the generation rate limit | Set `GENERATION_RATE_LIMIT` |
| Create or reset the reviewer login | Set `TEST_EMAIL` / `TEST_PASSWORD`, redeploy |
| Delete a user's data | Delete their documents from `kits`, `sessions`, then `users` in Atlas |
| Run a batch of postings | `npm run evaluate -- --input cases.json --output kits.json` with `GEMINI_API_KEY` set |

## Incident checklist

1. `GET /api/health`. Not responding: check Render status and the latest deploy log.
2. `persistence: memory` or `FATAL` in the log: Atlas `Network Access` has `0.0.0.0/0` and is Active; the cluster is not paused; `MONGODB_URI` is correct; `NODE_VERSION` is 22.
3. Users see "origin not allowed": `FRONTEND_ORIGIN` matches the live frontend URL exactly.
4. Kits fail or are slow: check the Gemini quota in AI Studio; look for repeated `Gemini request failed on every model`; set a different `GEMINI_MODEL`.
5. Sign-in works but data is missing: confirm the API points at the intended `MONGODB_DATABASE`.

## Known operational limits

See [KNOWN_ISSUES.md](KNOWN_ISSUES.md). Most important: generation progress is held in memory on a single API instance, so a restart during a build loses that build's progress view (the user retries).

## Ownership

Source: https://github.com/Sathvik2005/Trao--The-AI-Interview-Prep-Kit (public). To transfer, move the repository and recreate the Render and Vercel projects from the blueprint and `vercel.json`; Atlas data can be moved with a standard dump and restore.
