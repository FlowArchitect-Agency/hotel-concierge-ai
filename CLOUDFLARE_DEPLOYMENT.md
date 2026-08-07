# Code-native deployment: Cloudflare Worker

## Why this replaces n8n Cloud

n8n Cloud blocks its public API during the trial and requires a paid plan for automation through that API. Its Cloud plans also don't provide custom environment variables, while the legacy workflow relies on private provider values. The Worker replaces the live n8n path with ordinary version-controlled JavaScript.

The frontend remains on GitHub Pages. The Worker exposes `POST /api/chat`, holds all provider credentials as encrypted secrets, reads and writes Airtable, calls Groq, and uses ScrapingBee only when no matching hotel partner exists.

## One-time account handoff

Create or sign in to a free Cloudflare account. In **My Profile > API Tokens**, create a token using the **Edit Cloudflare Workers** template, then add only this value to the private project `.env` file:

```env
CLOUDFLARE_API_TOKEN=<private value>
```

Do not paste the token in chat or commit it. The deployment process can discover the account ID from the token, so you don't need to find it manually.

## Secrets configured in Cloudflare

The deployment adds these as encrypted Worker secrets, never to GitHub or browser JavaScript:

- `GROQ_API_KEY`
- `AIRTABLE_API_KEY`
- `AIRTABLE_BASE_ID`
- `SCRAPINGBEE_API_KEY` (optional; without it, unavailable external recommendations are safely deferred to the hotel team)

The non-secret settings are `ALLOWED_ORIGIN`, `HOTEL_NAME`, `HOTEL_CITY`, `GROQ_MODEL`, and `GROQ_FALLBACK_MODEL` in `wrangler.jsonc`.

## Local verification

```powershell
Set-Location cloudflare-worker
node --test
```

The tests cover the reported cuisine regression, external-result filtering, and input validation. The production deployment test additionally sends the multilingual and Airtable test suite to the Worker endpoint before the public website is switched over.
