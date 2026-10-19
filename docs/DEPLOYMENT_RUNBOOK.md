# Deployment Runbook

## Local modes

No Docker is required for a local UI/API demo. Copy `.env.example` to `.env`, keep `MONGODB_URI` blank, set a local `JWT_SECRET` of at least 32 characters, run `npm ci` and `npm run dev`, then open `http://localhost:5173`. The API uses MemoryStore; accounts and kits disappear when the API process restarts.

For persistent local storage, set `MONGODB_URI` to MongoDB Atlas or a locally installed MongoDB URI. Docker is optional (`docker compose up -d mongo`) if the Docker Engine is available.

## Production target

- Frontend: Vercel static Vite site (`npm run build`, output `dist`).
- API: Render persistent Node service (`npm start`).
- Database: MongoDB Atlas. Production fails startup if `MONGODB_URI` is absent; never use MemoryStore for production.

## Provision and verify

1. Create an Atlas cluster and restricted database user; configure network access for the API host. Avoid unrestricted `0.0.0.0/0` for production.
2. Deploy Render service from the root using `render.yaml`. Configure `MONGODB_URI`, `MONGODB_DATABASE`, a new random `JWT_SECRET` (32+ chars), `FRONTEND_ORIGIN`, and optional server-only `GEMINI_API_KEY`.
3. Verify `https://<render-service>/api/health` returns status 200 and persistence `mongodb`.
4. Import the root project into Vercel. Use `npm run build`, output `dist`. Set `VITE_API_URL=https://<render-service>` for production and preview environments.
5. Set the exact Vercel origin in Render `FRONTEND_ORIGIN`, redeploy, then verify registration, kit generation, edit/save, practice update, reload persistence, and owner isolation.
6. Run the batch command from a clean clone and record results in `PROJECT_STATUS.md`.

## Recovery

Redeploy the prior known-good Vercel/Render deployment from provider history. Take an Atlas snapshot before schema changes. The app currently creates indexes at startup and has no destructive migrations. Never use database deletion as a rollback.

## Current deployment status

No provider resources or credentials were supplied and no deployment has been attempted. There are no verified public URLs. Local in-memory mode has been verified; it is not a production database.
