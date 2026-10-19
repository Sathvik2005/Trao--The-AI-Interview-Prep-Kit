# Deployment runbook (all free tiers)

Order matters: database, then backend, then frontend, then wire the frontend URL back into the backend.

## 1. MongoDB Atlas (database)
1. Create a free **M0** cluster. Database Access: create a user with a strong password (letters and digits avoid URL-encoding problems).
2. Network Access: add `0.0.0.0/0` (Render's outbound IPs change on the free tier).
3. Connect, Drivers, copy the `mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/` string and put the real password in it.

## 2. Render (backend API)
1. Push the repository to GitHub, then in Render choose **New, Blueprint** and select the repo; it reads `render.yaml`.
2. When prompted, set:
   - `MONGODB_URI` — the Atlas string above
   - `GEMINI_API_KEY` — from Google AI Studio (free)
   - `FRONTEND_ORIGIN` — leave blank for now; set in step 4
   - `TEST_EMAIL` / `TEST_PASSWORD` — optional reviewer login (password 12+ characters)
3. Deploy. Verify `https://<service>.onrender.com/api/health` returns `{"status":"ok","persistence":"mongodb"}`.
   `persistence` must say `mongodb`; `memory` means the database is not connected.

## 3. Vercel (frontend)
1. **Add New, Project**, import the same repo. Framework preset: Vite (build `npm run build`, output `dist`; already in `vercel.json`).
2. Environment variable: `VITE_API_URL` = `https://<service>.onrender.com` (no trailing slash).
3. Deploy and note the URL, e.g. `https://<project>.vercel.app`.

## 4. Connect them
In Render, set `FRONTEND_ORIGIN` to the Vercel URL (comma-separate multiple origins, no trailing slash) and let it redeploy. Browsers are refused by the API until this is set.

## 5. Smoke test (production)
1. Open the Vercel URL, sign in with the reviewer account or register.
2. Build a kit from a pasted description and a real company site; watch the step-by-step progress; open the kit.
3. Edit a question, then regenerate that category; the edit must survive.
4. Reload the page; the kit must still be there (database persistence).
5. Sign out; protected pages must be unreachable.

## Notes
- Render's free web service sleeps when idle: open `/api/health` a minute before a demo.
- Generation takes roughly 1–3 minutes depending on Gemini load; the UI shows progress.
- Rotate any key that has ever been pasted into a chat or committed.
