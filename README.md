# ConciergeFlow AI

A multilingual hotel-concierge experience with a responsive web chat, an n8n workflow export for local development, a code-native Cloudflare Worker for production, Airtable record keeping, structured web lookup, and an automated regression harness.

## Architecture

The static site posts a guest message to an HTTPS backend. For local development that backend can be the legacy n8n workflow; for production it is the code-native Cloudflare Worker in `cloudflare-worker/`. The backend classifies the request, reads the relevant hotel and partner-service information, performs a structured external lookup only when needed, validates that recommendations satisfy hard constraints (such as a requested cuisine), and records reservation-ready data in Airtable.

```text
Browser -> Cloudflare Worker -> validated concierge service -> Airtable / approved lookup providers
                                      ^
                                      | automated regression harness
```

## Repository safety

This repository deliberately contains no API keys, Airtable tokens, local execution logs, guest conversations, or provider credentials. Copy `.env.example` to a private `.env` file when running locally. `config.js` may contain only the public Cloudflare Worker URL; never put a secret in a browser file.

## Run locally

1. Install Node.js and the Python requirements in `requirements.txt`.
2. Add the required private values to `.env` (not committed) only if you are developing or redeploying the Worker.
3. Serve the site with a static server and open `index.html`.

For production and local browser testing, `config.js` uses the deployed Cloudflare Worker HTTPS endpoint. The old local n8n workflow is retained only as a migration reference; it is not required to run the product.

## Production deployment

The frontend is hosted on GitHub Pages. The production backend is the Cloudflare Worker, which executes server-side code and holds encrypted provider secrets without an n8n Cloud subscription. After the Worker is deployed:

1. Add the private Groq, Airtable, and optional ScrapingBee values as Worker secrets.
2. Set `window.CONCIERGE_WEBHOOK_URL` in `config.js` to the Worker URL plus `/api/chat`.
3. Run the regression harness against the public endpoint before enabling the live chat.

See `CLOUDFLARE_DEPLOYMENT.md` for the one-time account and deployment handoff.

## Quality controls

The automated test suite includes multilingual intent checks, cuisine-constraint checks, stale-recommendation prevention, scraper-relevance checks, latency checks, webhook response checks, and Airtable field assertions. See `CONCIERGE_AUTOMATION.md` for the exact regression procedure.
