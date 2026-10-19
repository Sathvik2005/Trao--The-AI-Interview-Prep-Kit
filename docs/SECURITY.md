# Security

The application fetches untrusted pages from the open internet and feeds both those pages and a user-pasted description to a language model. Everything below follows from treating all of that as hostile.

## Threats and controls

| Threat | Control |
|---|---|
| **SSRF**: a user supplies a company URL that points at internal infrastructure | Only `http`/`https`. In production, loopback, private, link-local and reserved ranges are rejected, checked again after DNS resolution and on every redirect (max 3). The check uses a maintained address library, including IPv4-mapped IPv6 |
| **Resource exhaustion** from huge or slow pages | 15 s timeout; response bodies truncated at 1 MB; only `text/html`, `text/plain` and `application/xhtml+xml`; at most 8 pages per run; 400 ms spacing |
| **Prompt injection** from a page or the posting | Page text and descriptions are passed to the model as JSON data with an explicit instruction that they are content to analyse, never instructions. The model's output is then validated by schema; requirement quotes are verified against the original text; ids are filtered to known values. The model has no tools and cannot take actions |
| **Invented content** | Requirements require a verbatim quote that code verifies; an empty result is allowed and reported |
| **Account takeover and credential theft** | Passwords hashed with bcrypt; weak passwords (under 12 characters) rejected; login and registration rate-limited; generic credential errors |
| **Session theft or reuse** | JWT with 2 h expiry; the SHA-256 of each token is stored server-side so logout revokes it; a TTL index purges expired sessions |
| **Cross-user access** | Every kit query filters by the owner's id; another user's resource returns 404 |
| **Cross-site abuse** | Strict CORS allow-list plus an origin check on every request; bearer tokens (not cookies), so classic CSRF does not apply |
| **Abuse of the free LLM quota** | Per-IP generation rate limit; two concurrent generations per user; process-wide model concurrency cap |
| **Header and clickjacking issues** | `helmet` defaults; `x-powered-by` removed; `Cache-Control: no-store` on API responses |
| **Secrets leakage** | Keys live in environment variables only; `.env` is git-ignored; the browser never sees the model key; the frontend receives only the public API URL |
| **Unsafe input** | Zod validation on every request body; 512 KB body limit; error responses never include stack traces |

## Residual risks (known and accepted)

- The session token is kept in `sessionStorage`. A cross-site scripting bug would expose it. React escapes by default and no raw HTML is rendered, but a stricter setup would use `HttpOnly` cookies with CSRF protection.
- There is no per-user cost budget beyond rate limits.
- `robots.txt` handling covers `User-agent: *` `Disallow`; it does not parse `Crawl-delay` or wildcards.
- A determined attacker could host a site that serves different content to the crawler to influence a brief. Briefs cite their sources so users can check.
- DNS rebinding between the check and the connection is narrowed by re-checking on redirects but not eliminated; pinning the resolved address into the connection would close it.

## Dependency hygiene

`npm audit --omit=dev --audit-level=moderate` reports 0 vulnerabilities for production dependencies. Dev-only advisories exist in build tooling and are not shipped.

## Reporting

For a security concern, contact the repository owner privately rather than opening a public issue.
