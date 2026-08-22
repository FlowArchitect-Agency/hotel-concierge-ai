# WhatsApp Business Cloud API connection

The concierge Worker now exposes a signed WhatsApp webhook at:

`https://conciergeflow-api.conciergeflow-worker.workers.dev/webhooks/whatsapp`

It accepts Meta's verification handshake, verifies each `X-Hub-Signature-256` request with the app secret, deduplicates message IDs, and routes supported text messages through the same concierge and Airtable conversation history used by the website. WhatsApp records use `whatsapp:<guest-number>` as their `UserID` and `whatsapp` as their channel.

## Required Meta setup

The Meta developer account needs a connected Business Portfolio before a WhatsApp Business app can be created. In the app, add the WhatsApp use case, register a phone number, and subscribe the webhook to the `messages` field.

The Worker needs these private secrets, never committed to GitHub:

- `WA_ACCESS_TOKEN`
- `WA_PHONE_NUMBER_ID`
- `WA_APP_SECRET`
- `WA_WEBHOOK_VERIFY_TOKEN`
- `WA_GRAPH_API_VERSION` (optional; defaults to `v24.0`)

Use the callback URL above and set the same private verification token in Meta and the Worker. `deploy-cloudflare-worker.ps1` uploads these values automatically when they are present in the ignored `.env` file.

## Current scope

This connector supports incoming text messages and text replies only. Proactive pre-arrival messages, template approvals, operational routing, human handoff, media, and post-stay messages are intentionally not enabled yet.
