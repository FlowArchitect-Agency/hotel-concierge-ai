import { toolResult } from './schemas.js';

// Ownership is intentionally backend-owned. In the current demo architecture
// this tool can recommend/prep a handoff but cannot imply that a staff member
// has accepted it unless an injected ownership controller confirms that state.
export async function runHumanTakeover({ input, mode = '', conversationOwner = 'ai', takeOver = null }) {
  if (conversationOwner === 'staff') return toolResult('human_takeover', 'success', { data: { owner: 'staff', already_owned: true } });
  if (mode === 'read_only') return toolResult('human_takeover', 'read_only', { errorCode: 'read_only_mode' });
  if (typeof takeOver !== 'function') return toolResult('human_takeover', 'prepared', { data: { owner: 'ai', reason: input.reason } });
  try {
    const outcome = await takeOver(input);
    return outcome?.owner === 'staff'
      ? toolResult('human_takeover', 'success', { data: { owner: 'staff', handoff_id: String(outcome.id ?? '') || null } })
      : toolResult('human_takeover', 'error', { errorCode: 'handoff_unconfirmed' });
  } catch {
    return toolResult('human_takeover', 'error', { errorCode: 'handoff_failed' });
  }
}
