# Code-native deployment: Cloudflare Worker

## Why this replaces n8n Cloud

n8n Cloud blocks its public API during the trial and requires a paid plan for automation through that API. Its Cloud plans also don't provide custom environment variables, while the legacy workflow relies on private provider values. The Worker replaces the live n8n path with ordinary version-controlled JavaScript.

The frontend remains on GitHub Pages. The Worker exposes `POST /api/chat` and the isolated simulator route `POST /api/demo-chat`, holds all provider credentials as encrypted secrets, reads and writes Airtable, calls Groq, and uses ScrapingBee only when no matching hotel partner exists.

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
- `WA_ACCESS_TOKEN`, `WA_PHONE_NUMBER_ID`, `WA_APP_SECRET`, `WA_WEBHOOK_VERIFY_TOKEN` (all required to enable the Meta WhatsApp webhook)
- `WA_GRAPH_API_VERSION` (optional; the Worker defaults to `v24.0`)
- `TWILIO_AUTH_TOKEN` (only for Twilio webhook signature verification; no outbound Twilio REST credentials are consumed)

The non-secret settings are `ALLOWED_ORIGIN`, `DEMO_ALLOWED_ORIGIN`, `HOTEL_NAME`, `HOTEL_CITY`, `GROQ_MODEL`, and `GROQ_FALLBACK_MODEL` in `wrangler.jsonc`. Set both origin values to the exact GitHub Pages origin, with no trailing slash.

## Simulator data isolation

Before deploying the demo route, run the Airtable schema migration once from the repository root:

```powershell
node setup-airtable.js
```

It adds an `Is_Demo` checkbox to `Guests`, `Conversations`, and `Requests` when those fields are missing. The `/api/demo-chat` route rejects `is_demo: false`, sets `Is_Demo` on every demo record, and only responds to the configured GitHub Pages origin. It then calls the same concierge resolver as the WhatsApp webhook and `/api/chat`.

## Local verification

```powershell
Set-Location cloudflare-worker
node --test
```

The tests cover the reported cuisine regression, external-result filtering, input validation, strict simulator CORS, and demo record marking. The production deployment test additionally sends the multilingual and Airtable test suite to the Worker endpoint before the public website is switched over.

## Manager metrics limitation

`GET /api/manager/metrics` returns only aggregate operational-ticket counts and calculated time saved; it excludes records marked `Is_Demo`. It intentionally does not return guest names, request text, or Airtable record IDs. The route is not authenticated, so it must be protected with an authenticated staff boundary before a production manager dashboard is exposed outside the trusted hotel environment. This hardening pass does not add that authentication layer.
