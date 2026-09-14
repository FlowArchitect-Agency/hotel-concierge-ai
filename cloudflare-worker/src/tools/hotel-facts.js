import { toolResult } from './schemas.js';

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function relevantEntries(entries, category) {
  if (category === 'general' || category === 'hotel') return entries;
  const needles = category.replace(/_/g, ' ').split(' ');
  return entries.filter((entry) => needles.some((needle) => clean(entry.key).toLowerCase().includes(needle)));
}

// `source` is supplied by the Airtable integration. This tool deliberately
// knows nothing about the database or any provider-specific record shape.
export async function runHotelFacts({ input, source }) {
  try {
    const facts = source && typeof source === 'object' ? source : null;
    if (!facts?.hotelName) return toolResult('hotel_facts', 'unavailable', { errorCode: 'facts_source_unavailable' });
    const entries = Array.isArray(facts.entries) ? facts.entries
      .map((entry) => ({ key: clean(entry?.key), value: clean(entry?.value) }))
      .filter((entry) => entry.key && entry.value)
      : [];
    const found = relevantEntries(entries, input.category);
    if (input.category !== 'general' && input.category !== 'hotel' && !found.length) {
      return toolResult('hotel_facts', 'not_found', { data: { hotel_name: facts.hotelName, facts: [] } });
    }
    return toolResult('hotel_facts', 'success', {
      data: {
        hotel_name: facts.hotelName,
        facts: found,
        text: found.map((entry) => `- ${entry.key}: ${entry.value}`).join('\n') || clean(facts.text),
      },
    });
  } catch {
    return toolResult('hotel_facts', 'error', { errorCode: 'facts_source_error' });
  }
}
