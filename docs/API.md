# API reference

Base URL: `https://trao-interview-prep-kit-api.onrender.com`. JSON in and out. Authenticated routes need `Authorization: Bearer <token>` from login or registration. Browser calls must come from an origin listed in `FRONTEND_ORIGIN`.

## Errors

All errors share one shape:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Request data is invalid.", "details": [{ "path": "days", "message": "..." }] } }
```

| Status | Code | Meaning |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Body failed validation (details list the fields) |
| 401 | `UNAUTHENTICATED` | No token supplied |
| 401 | `INVALID_TOKEN` | Token malformed, wrong signature, or expired |
| 401 | `SESSION_REVOKED` | Token was revoked by logout |
| 401 | `INVALID_CREDENTIALS` | Wrong email or password |
| 403 | `ORIGIN_NOT_ALLOWED` | Browser origin not in the allow-list |
| 404 | `KIT_NOT_FOUND`, `JOB_NOT_FOUND`, `FLASHCARD_NOT_FOUND` | Not found, or not yours |
| 409 | `EMAIL_EXISTS` | Registration with an email already in use |
| 429 | (rate limiter) / `TOO_MANY_GENERATIONS` | Slow down; at most 2 running generations per user |
| 500 | `INTERNAL_ERROR` | Unexpected server error (details are logged, not returned) |
| 502 | `REGENERATION_FAILED` | Model provider failed; the kit is unchanged |

## Service

| Method and path | Auth | Description |
|---|---|---|
| `GET /` | no | Service banner |
| `GET /api/health` | no | `{ "status": "ok", "persistence": "mongodb" \| "memory" }` |

## Auth

| Method and path | Body | Response |
|---|---|---|
| `POST /api/auth/register` | `{ email, password }` (password 12 to 128 characters) | `201 { user, token, expires_at }` |
| `POST /api/auth/login` | `{ email, password }` | `200 { user, token, expires_at }` |
| `POST /api/auth/logout` | | `204`; the token is revoked |
| `GET /api/auth/me` | | `{ user }` |

Tokens last 2 hours. Auth routes are limited to 20 attempts per IP per 15 minutes.

## Kits

| Method and path | Description |
|---|---|
| `GET /api/kits` | List your kits, newest first |
| `POST /api/kits` | Start a generation. Body `{ jd (20 to 50000 chars), company_url, days (1 to 60) }`. Returns `202 { job }`, or `200 { kit, duplicate: true }` if you already built this exact posting, or `202 { job, duplicate: true }` if it is already running |
| `GET /api/jobs/:id` | Poll a generation: `{ job: { id, status: running\|done\|failed, steps[], kit_id?, error? } }`. Jobs are kept for an hour |
| `GET /api/kits/:id` | `{ kit: { id, kit, practice, created_at, updated_at } }` |
| `PUT /api/kits/:id` | Replace the kit with an edited one. The server assigns `origin`, reconciles coverage and the schedule, then validates. Rejected with 400 if it breaks a rule (for example no question left for a must-have) |
| `DELETE /api/kits/:id` | `204` |
| `POST /api/kits/:id/regenerate` | Body `{ section: company_brief\|questions\|flashcards\|schedule\|coverage, category?, days? }`. Returns `{ kit }` |
| `POST /api/kits/:id/practice` | Body `{ flashcard_id, confidence (1 to 5) }`. The id may be a flashcard or a question id. Returns `{ kit }` |

`job.steps[]` entries: `{ step, label, status: running\|done\|skipped\|failed, detail? }`, in the order `requirements`, `role`, `research`, `brief`, `questions`, `coverage`, `flashcards`, `schedule`.

## Limits

| Limit | Value |
|---|---|
| Request body | 512 KB |
| Generations | 30 per IP per 15 minutes (`GENERATION_RATE_LIMIT`), 2 running per user |
| Auth attempts | 20 per IP per 15 minutes |
| Job retention | 1 hour in memory |
