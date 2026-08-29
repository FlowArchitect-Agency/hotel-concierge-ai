// Public browser configuration only. Never put API keys in this file.
// This Cloudflare Worker is the production backend; it runs independently of
// the visitor's computer and keeps all provider credentials server-side.
window.CONCIERGE_WEBHOOK_URL = window.CONCIERGE_WEBHOOK_URL || 'https://conciergeflow-api.conciergeflow-worker.workers.dev/api/chat';
window.CONCIERGE_DEMO_ENDPOINT = window.CONCIERGE_DEMO_ENDPOINT || 'https://conciergeflow-api.conciergeflow-worker.workers.dev/api/demo-chat';
window.CONCIERGE_METRICS_ENDPOINT = window.CONCIERGE_METRICS_ENDPOINT || 'https://conciergeflow-api.conciergeflow-worker.workers.dev/api/manager/metrics';
// This public scheduling link appears only after a hotel has submitted its discovery brief.
window.CONCIERGE_CALENDLY_URL = window.CONCIERGE_CALENDLY_URL || 'https://calendly.com/contact-mehdiai/30min?month=2026-08&date=2026-08-29';
