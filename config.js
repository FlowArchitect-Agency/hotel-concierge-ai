// Public browser configuration only. Never put API keys in this file.
// This Cloudflare Worker is the production backend; it runs independently of
// the visitor's computer and keeps all provider credentials server-side.
window.CONCIERGE_WEBHOOK_URL = window.CONCIERGE_WEBHOOK_URL || 'https://conciergeflow-api.conciergeflow-worker.workers.dev/api/chat';
