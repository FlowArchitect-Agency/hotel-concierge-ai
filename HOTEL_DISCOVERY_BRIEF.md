# Hotel Discovery Brief

`hotel-discovery.html` is the public, post-appointment discovery experience for ConciergeFlow. It uses the existing `POST /api/discovery-lead` endpoint and the existing **Hotel Leads** Airtable base; it does not create a second lead pipeline.

## Airtable storage

The existing Hotel Leads mapping remains the source of truth:

- `Hotel Lead Name`
- `Contact Name`
- `Work Email`
- `Hotel Name`
- `Phone Number`
- `City` (legacy discovery-call submissions)
- `Number of Rooms`
- `Hotel Website`
- `Concierge Service Needs`
- `Lead Status`

For a Hotel Discovery Brief, `Concierge Service Needs` contains the generated, human-readable **Sales Brief**. It includes every submitted section and is deliberately suitable for a sales-preparation email. Legacy discovery-call submissions continue to store their original free-text message in that same existing field.

No Airtable field needs to be added for V1. This relies on `Concierge Service Needs` being an existing long-text field, as it is already used by the current lead-capture integration. No guest personal data, credentials, passwords, or API keys are collected.

## One-time Airtable Automation setup

The Worker stores the submission; Airtable sends the notification. No email provider is added to the application.

1. In the **Hotel Leads** table, create a view named `Discovery Briefs`.
2. Filter the view where `Concierge Service Needs` **contains** `Hotel Discovery Brief`.
3. Create an Automation with trigger **When record enters view** and select `Discovery Briefs`.
4. Add action **Send email**.
5. Set the recipient to `flowarchitect.agency@gmail.com`.
6. Set the subject to `New Hotel Discovery Brief — {Hotel Name}` using Airtable's field token for `Hotel Name`.
7. Set the email body to the field token for `Concierge Service Needs`. Optionally precede it with the `Contact Name` and `Work Email` field tokens for quick follow-up.
8. Test the Automation with a test record and turn it on.

The selected view prevents a standard, short discovery-call submission from being treated as a full hotel brief. The automation is the only notification delivery mechanism in this V1.

## Local visual QA

Use `hotel-discovery.html?mock=1` for the local success-state review. Mock mode changes only the page's submission behavior: it does not call the Worker, Airtable, or any external email service. The normal public page posts to `/api/discovery-lead` through the configured Cloudflare Worker endpoint.
