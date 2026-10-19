# Demo script (3-4 minutes)

Warm the backend first: open `https://<render-service>.onrender.com/api/health` a minute before recording (free tier sleeps). Use a fresh job description each take; an identical posting is de-duplicated and returns the old kit instantly.

| Time | Show | Say |
|---|---|---|
| 0:00 | Sign in, prep desk | One private workspace per user; kits are owner-scoped. |
| 0:15 | Paste a real job description and `https://posthog.com`, 5 days, **Build my kit** | The description is pasted text; only the company site needs retrieval. |
| 0:30 | Watch the progress steps | Requirements, then role, then a real crawl with ranked links and a public-discussion search, then the brief, then questions generated per category, then the coverage check, flashcards and the schedule. Each step depends on what the previous one found. |
| 1:15 | Open the kit, **Brief & coverage** | Sources are listed; "How they hire" comes from what was found; research notes list gaps honestly. Every extracted requirement is must or nice, taken from the posting's wording. |
| 1:45 | Say how coverage works | Coverage is computed by code, not the model. Any requirement without a question goes back for a second, targeted pass (up to 3), and a must-have can never ship uncovered. |
| 2:00 | **Question bank**: edit a prompt, add a question, pin one, move one to another category, reorder | Edits save automatically; the server marks each item generated, edited or manual. |
| 2:30 | Click **Regenerate technical** | Only unpinned, unedited technical questions are replaced. The edited and hand-written ones stay, other categories are untouched, and the schedule is reconciled. |
| 3:00 | **Practice**: reveal a card, rate confidence; show covered vs not covered | Least-confident cards come first. |
| 3:20 | **Schedule**: change days, rebuild | Allocation is plain arithmetic in code: must-have and harder first, exactly the requested days. |
| 3:40 | Defend one decision | Schedule and coverage are deterministic on purpose: what the model must not decide. Or: a dead company site produces an honest thin kit, not a failure. |

Optional proof of the edge cases: build a kit for a non-existent site (honest minimal brief) and a two-line description (thin kit, nothing invented).
