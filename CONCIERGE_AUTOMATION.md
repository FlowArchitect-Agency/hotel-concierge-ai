# ConciergeFlow automated validation

The production system is a Cloudflare Worker, not n8n. The hosted Worker reads the Airtable partner catalog, calls Groq for multilingual replies, searches ScrapingBee only when there is no matching hotel partner, and writes the conversation/request records to Airtable. It runs independently of this computer.

## Automated checks

```powershell
.\start-concierge-automation.ps1
```

That command does not start a local server. It runs two layers of validation:

1. `npm test` runs deterministic contract tests. They cover multilingual intent classification, the reported Indian-cuisine follow-up sequence, unsafe session IDs, response safety, and a no-write read-only request.
2. `npm run test:live` runs a controlled end-to-end smoke test using the private `.env`: a read-only Indian restaurant request plus one isolated Airtable write test. It validates the required request fields and deletes every test record it creates.

The live check exits non-zero on a provider failure, a stale/mismatched cuisine recommendation, a false booking confirmation, missing Airtable records, or incomplete request fields. It never prints credentials or guest data.

## Production deployment

The public browser is served by GitHub Pages and sends requests to the Cloudflare Worker. Provider keys are Cloudflare encrypted secrets and are not included in GitHub Pages, the Worker source, or the browser configuration.

To deploy an intentional Worker code change:

```powershell
.\deploy-cloudflare-worker.ps1
```

Then run the same verification command above. The previous n8n workflow files are retained as migration history only; no n8n process or Startup task is used by the production application.

## Safety rules enforced in code

- A named cuisine is a hard constraint across follow-up messages; a non-matching venue cannot be recommended.
- External results must explicitly prove the requested cuisine and must be direct venue results, not directory/listicle pages.
- Partner prices are shown only when supplied by Airtable; external price, availability, and booking claims are never invented.
- A booking is always a staff action. The agent never claims that a reservation or availability is confirmed.
