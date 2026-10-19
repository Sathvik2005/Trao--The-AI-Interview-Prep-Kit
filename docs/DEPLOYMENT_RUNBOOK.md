# Deployment runbook

Everything runs on free tiers: MongoDB Atlas (database), Render (API), Vercel (frontend). Order matters: database, API, frontend, then wire the frontend URL back into the API.

## 1. MongoDB Atlas

1. Create a free **M0** cluster.
2. **Database Access:** create a user with a strong password. Prefer letters and digits; special characters must be URL-encoded in the connection string.
3. **Network Access:** add **`0.0.0.0/0`** and leave it permanent. Render's free tier has no fixed outbound address, and Atlas silently drops connections from addresses not on the list. Keep your own address too if you develop locally.
4. **Connect, Drivers:** copy the `mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/` string and put the real password in it.

## 2. Render (API)

1. **New, Blueprint**, choose the repository. Render reads `render.yaml` (free plan, `npm ci --include=dev`, `npm start`, health check `/api/health`).
2. Connect GitHub as the account that owns the repository.
3. Set the secret variables when prompted:

| Variable | Value |
|---|---|
| `MONGODB_URI` | the Atlas string |
| `GEMINI_API_KEY` | key from Google AI Studio |
| `FRONTEND_ORIGIN` | leave empty until step 4 |
| `TEST_EMAIL`, `TEST_PASSWORD` | optional reviewer login (password 12+ characters) |

`JWT_SECRET` is generated, and `NODE_ENV=production`, `NODE_VERSION=22`, `MONGODB_DATABASE` and `GEMINI_MODEL` are preset by the blueprint.

4. After the first deploy, open `https://<service>.onrender.com/api/health`. It must return `{"status":"ok","persistence":"mongodb"}`. `memory` means the database is not connected and production will not run on it.

## 3. Vercel (frontend)

1. **Add New, Project**, import the repository. Leave **Root Directory empty** (the repository root, not `src`).
2. Framework preset **Vite**. Build `npm run build`, output `dist` (already in `vercel.json`, which also rewrites all paths to `index.html`).
3. Environment variable `VITE_API_URL` = the Render URL, no trailing slash. It is baked in at build time; changing it needs a redeploy.
4. Deploy and copy the URL.

## 4. Connect them

In Render set `FRONTEND_ORIGIN` to the Vercel URL **exactly** as the browser shows it (scheme and host, no trailing slash, no quotes). Comma-separate several origins. Render redeploys; wait for "Your service is live". Until this is set the API answers browsers with 403.

## 5. Smoke test

1. `GET /api/health` shows `mongodb`.
2. `OPTIONS /api/auth/register` with `Origin: <vercel url>` returns 204.
3. Open the Vercel URL, create an account, build a kit from a pasted description and a real company site, and watch the progress steps.
4. Edit a question, regenerate that category, and confirm the edit survives.
5. Reload; the kit is still there. Sign out; the kit is no longer reachable.

## Troubleshooting (all seen in practice)

| Symptom | Cause | Fix |
|---|---|---|
| Render log: `tlsv1 alert internal error` or `MongoServerSelectionError` | Atlas is refusing Render's address | Add `0.0.0.0/0` under Network Access, wait until Active, redeploy |
| Log shows Node v26 and odd TLS behaviour | Render picked the newest Node | Set `NODE_VERSION=22` (preset in `render.yaml`) and clear the build cache |
| Site loads but sign-in or registration fails with "origin not allowed" | `FRONTEND_ORIGIN` unset or mismatched | Set it to the exact Vercel URL; redeploy |
| `Cannot GET /` on the API address | Normal for an API-only service | Use `/api/health`; the app is on Vercel |
| Vercel build cannot find `package.json` | Root Directory set to `src` | Clear Root Directory |
| Kit fails with provider errors | Gemini overloaded or a model retired | Retries and fallbacks handle most cases; set `GEMINI_MODEL` or `GEMINI_FALLBACK_MODELS` to a current model |
| First request takes 30 to 60 s | Free Render service was asleep | Open `/api/health` before a demo |
| Local `querySrv ECONNREFUSED` | Local network blocks SRV DNS | Set `DNS_SERVERS=8.8.8.8,1.1.1.1` |

## Rollback

Both hosts redeploy from `main`. To roll back, revert the commit and push, or use Render's and Vercel's "redeploy previous deployment" buttons.
