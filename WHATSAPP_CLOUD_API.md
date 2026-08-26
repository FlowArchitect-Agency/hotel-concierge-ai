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

Use the callback URL above and set the same private verification token in Meta and the Worker. For local development, create the ignored `cloudflare-worker/.dev.vars` from `cloudflare-worker/.dev.vars.example` and use these exact `WA_*` names. `deploy-cloudflare-worker.ps1` uploads these values automatically when they are present in the ignored `.env` file.

The repository intentionally does not read legacy `WHATSAPP_*` variable names. Do not put real values in `.env.example`, `.dev.vars.example`, or any tracked file.

## Twilio compatibility webhook

`POST /webhooks/twilio` is retained for incoming-message compatibility and validates `X-Twilio-Signature` with one secret:

- `TWILIO_AUTH_TOKEN`

The Worker does not consume `TWILIO_ACCOUNT_SID` or `TWILIO_FROM_NUMBER`, and it does not use Twilio’s outbound REST API.

## Current scope

This connector supports incoming text messages and text replies through the same concierge resolver and request-persistence path as website chat. It does not send native Meta documents/media, proactive pre-arrival messages, approved templates, or provide a real staff-takeover channel. Request persistence is asynchronous and is not proof that a staff member has been notified.
