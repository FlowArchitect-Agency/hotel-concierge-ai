import { toolResult } from './schemas.js';

// A request is only successful when the injected deterministic writer confirms
// it. The response model never gets to claim that a request exists by itself.
export async function runGuestRequest({ input, mode = '', create = null }) {
  if (mode === 'read_only') return toolResult('guest_request', 'read_only', { errorCode: 'read_only_mode' });
  if (typeof create !== 'function') return toolResult('guest_request', 'prepared', { data: { request: input } });
  try {
    const created = await create(input);
    return created
      ? toolResult('guest_request', 'success', { data: { request: input, request_id: String(created.id ?? created.recordId ?? '') || null } })
      : toolResult('guest_request', 'error', { errorCode: 'request_write_unconfirmed' });
  } catch {
    return toolResult('guest_request', 'error', { errorCode: 'request_write_failed' });
  }
}
