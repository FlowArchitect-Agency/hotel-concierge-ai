/*
 * ConciergeFlow AI — Airtable base setup
 *
 * Requires Node.js 18+ (native fetch) and an Airtable Personal Access Token
 * with schema.bases:read and schema.bases:write access to AIRTABLE_BASE_ID.
 * Run: node setup-airtable.js
 */

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY || 'YOUR_AIRTABLE_PERSONAL_ACCESS_TOKEN';
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID || 'YOUR_AIRTABLE_BASE_ID';

const API_ROOT = `https://api.airtable.com/v0/meta/bases/${AIRTABLE_BASE_ID}`;
const EURO_CURRENCY = { precision: 2, symbol: '€' };
const PARIS_DATE_TIME = {
  dateFormat: { name: 'iso', format: 'YYYY-MM-DD' },
  timeFormat: { name: '24hour', format: 'HH:mm' },
  timeZone: 'Europe/Paris',
};

const select = (choices) => ({
  type: 'singleSelect',
  options: { choices: choices.map((name) => ({ name })) },
});

const multiSelect = (choices) => ({
  type: 'multipleSelects',
  options: { choices: choices.map((name) => ({ name })) },
});

const field = (name, type, options) => ({
  name,
  type,
  ...(options ? { options } : {}),
});

const tables = [
  {
    name: 'Conversations',
    fields: [
      field('MessageID', 'autoNumber'),
      field('UserID', 'singleLineText'),
      { name: 'Channel', ...select(['whatsapp', 'instagram', 'sms', 'web']) },
      { name: 'Role', ...select(['user', 'assistant']) },
      field('Message', 'multilineText'),
      field('Language', 'singleLineText'),
      field('Timestamp', 'dateTime', PARIS_DATE_TIME),
      field('Is_Demo', 'checkbox'),
      field('Created', 'createdTime'),
    ],
  },
  {
    name: 'Requests',
    fields: [
      field('RequestID', 'autoNumber'),
      field('UserID', 'singleLineText'),
      { name: 'Channel', ...select(['whatsapp', 'instagram', 'sms', 'web']) },
      field('GuestName', 'singleLineText'),
      { name: 'ServiceType', ...select(['spa', 'restaurant', 'tour', 'transport', 'experience', 'other']) },
      field('RequestSummary', 'multilineText'),
      { name: 'Source', ...select(['partner', 'external']) },
      field('ServiceRef', 'singleLineText'),
      { name: 'Status', ...select(['new', 'in_progress', 'confirmed', 'cancelled']) },
      field('EstValueEUR', 'currency', EURO_CURRENCY),
      field('IsUpsell', 'checkbox'),
      field('Language', 'singleLineText'),
      field('Is_Demo', 'checkbox'),
      field('CreatedAt', 'createdTime'),
      field('HandoverAt', 'dateTime', PARIS_DATE_TIME),
    ],
  },
  {
    name: 'Services',
    fields: [
      field('Name', 'singleLineText'),
      { name: 'Category', ...select(['spa', 'restaurant', 'tour', 'transport', 'experience']) },
      field('SubType', 'singleLineText'),
      field('Description', 'multilineText'),
      field('PriceEUR', 'currency', EURO_CURRENCY),
      field('DurationMins', 'number', { precision: 0 }),
      field('Location', 'singleLineText'),
      field('PhoneNumber', 'phoneNumber'),
      field('Availability', 'singleLineText'),
      { name: 'Tags', ...multiSelect(['couples', 'vegan', 'view', 'luxury', 'family', 'arrival']) },
      field('IsPartner', 'checkbox'),
      field('Active', 'checkbox'),
    ],
  },
  {
    name: 'Guests',
    fields: [
      field('UserID', 'singleLineText'),
      field('GuestName', 'singleLineText'),
      field('PreferredLanguage', 'singleLineText'),
      field('RoomNumber', 'singleLineText'),
      field('Notes', 'multilineText'),
      field('Is_Demo', 'checkbox'),
      field('FirstSeen', 'createdTime'),
    ],
  },
  {
    name: 'Settings',
    fields: [
      field('Key', 'singleLineText'),
      field('Value', 'multilineText'),
    ],
  },
];

function assertConfiguration() {
  if (AIRTABLE_API_KEY.startsWith('YOUR_') || AIRTABLE_BASE_ID.startsWith('YOUR_')) {
    throw new Error('Set AIRTABLE_API_KEY and AIRTABLE_BASE_ID at the top of setup-airtable.js before running it.');
  }
}

async function airtable(path, options = {}, attempt = 0) {
  const response = await fetch(`${API_ROOT}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${AIRTABLE_API_KEY}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  if (response.status === 429 && attempt < 4) {
    const retryAfter = Number(response.headers.get('retry-after')) || (attempt + 1);
    await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
    return airtable(path, options, attempt + 1);
  }

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = body?.error?.message || body?.error?.type || response.statusText;
    throw new Error(`${options.method || 'GET'} ${path} failed (${response.status}): ${detail}`);
  }
  return body;
}

function compareFields(table, expectedFields) {
  const actual = new Map((table.fields || []).map((item) => [item.name, item.type]));
  return expectedFields
    .filter((expected) => actual.has(expected.name) && actual.get(expected.name) !== expected.type)
    .map((expected) => `${expected.name} (expected ${expected.type}; found ${actual.get(expected.name)})`);
}

async function addMissingFields(table, expectedFields) {
  const actualNames = new Set((table.fields || []).map((item) => item.name));
  const missing = expectedFields.filter((expected) => !actualNames.has(expected.name));
  for (const fieldDefinition of missing) {
    const created = await airtable(`/tables/${table.id}/fields`, {
      method: 'POST',
      body: JSON.stringify(fieldDefinition),
    });
    console.log(`✓ Added ${created.name} to ${table.name}.`);
  }
}

async function main() {
  assertConfiguration();
  const schema = await airtable('/tables');
  const existing = new Map((schema.tables || []).map((table) => [table.name, table]));

  for (const table of tables) {
    const prior = existing.get(table.name);
    if (prior) {
      await addMissingFields(prior, table.fields);
      const mismatches = compareFields(prior, table.fields);
      if (mismatches.length) {
        console.warn(`⚠ ${table.name} already exists but differs: ${mismatches.join(', ')}`);
      } else {
        console.log(`✓ ${table.name} already exists and matches the required field types.`);
      }
      continue;
    }

    const created = await airtable('/tables', {
      method: 'POST',
      body: JSON.stringify(table),
    });
    console.log(`✓ Created ${created.name} (${created.id}) with ${created.fields.length} fields.`);
  }

  console.log('\nConciergeFlow AI Airtable setup is complete.');
}

main().catch((error) => {
  console.error(`\nSetup failed: ${error.message}`);
  process.exitCode = 1;
});
