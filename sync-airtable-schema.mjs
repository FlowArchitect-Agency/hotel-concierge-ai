import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env') });

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;

if (!AIRTABLE_API_KEY || !AIRTABLE_BASE_ID) {
  console.error('Missing AIRTABLE_API_KEY or AIRTABLE_BASE_ID in .env');
  process.exit(1);
}

const META_BASE_URL = `https://api.airtable.com/v0/meta/bases/${AIRTABLE_BASE_ID}/tables`;

const field = (name, type, options) => ({
  name,
  type,
  ...(options ? { options } : {}),
});

const select = (choices) => ({
  type: 'singleSelect',
  options: { choices: choices.map((name) => ({ name })) },
});

// Desired Core Schema Definitions
const DESIRED_SCHEMA = [
  {
    name: 'Guests',
    fields: [
      field('WhatsApp Number', 'singleLineText'),
      field('Full Name', 'singleLineText'),
      field('Language', 'singleLineText'),
      { name: 'VIP Status', ...select(['Standard', 'VIP', 'Celebrity']) },
      field('Known Preferences', 'multilineText'),
      field('Room Number', 'singleLineText'),
      field('Notes', 'multilineText'),
    ],
  },
  {
    name: 'Reservations',
    fields: [
      field('Reservation ID', 'singleLineText'),
      field('Linked Guest', 'singleLineText'),
      field('Check-In Date', 'date', { dateFormat: { name: 'iso', format: 'YYYY-MM-DD' } }),
      field('Check-Out Date', 'date', { dateFormat: { name: 'iso', format: 'YYYY-MM-DD' } }),
      field('Room Number', 'singleLineText'),
      field('Guest Name', 'singleLineText'),
      field('Email', 'email'),
      field('Phone', 'phoneNumber'),
      field('Service Name', 'singleLineText'),
      { name: 'Status', ...select(['new', 'confirmed', 'cancelled', 'completed']) },
    ],
  },
  {
    name: 'Staff',
    fields: [
      field('Staff Name', 'singleLineText'),
      { name: 'Role', ...select(['Receptionist', 'Housekeeping', 'Concierge', 'Manager', 'Maintenance']) },
      field('WhatsApp Number', 'phoneNumber'),
      field('On-Duty', 'checkbox', { icon: 'check', color: 'greenBright' }),
    ],
  },
  {
    name: 'Requests',
    fields: [
      field('Request ID', 'singleLineText'),
      field('Linked Guest', 'singleLineText'),
      field('Linked Staff', 'singleLineText'),
      field('Task Details', 'multilineText'),
      { name: 'Status', ...select(['new', 'in_progress', 'completed', 'cancelled']) },
      field('Guest Name', 'singleLineText'),
      field('Is Upsell', 'checkbox', { icon: 'check', color: 'greenBright' }),
    ],
  },
  {
    name: 'Services',
    fields: [
      field('Service Name', 'singleLineText'),
      field('Description', 'multilineText'),
      field('Price', 'singleLineText'),
      field('Operating Hours', 'singleLineText'),
      field('URL Attachment', 'url'),
      { name: 'Category', ...select(['spa', 'restaurant', 'tour', 'transport', 'experience']) },
      field('Active', 'checkbox', { icon: 'check', color: 'greenBright' }),
    ],
  },
  {
    name: 'Conversations',
    fields: [
      field('Message ID', 'singleLineText'),
      field('Linked Guest', 'singleLineText'),
      field('Guest Name', 'singleLineText'),
      { name: 'Sender', ...select(['Guest', 'AI', 'Human']) },
      field('Message Content', 'multilineText'),
      field('Timestamp', 'singleLineText'),
    ],
  },
];

async function syncSchema() {
  console.log(`=== Fetching current Airtable schema for Base: ${AIRTABLE_BASE_ID} ===\n`);

  const res = await fetch(META_BASE_URL, {
    headers: {
      Authorization: `Bearer ${AIRTABLE_API_KEY}`,
      'Content-Type': 'application/json',
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch base meta: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  const existingTables = data.tables || [];
  const existingTableMap = new Map(existingTables.map((t) => [t.name, t]));

  console.log(`Existing tables found: ${existingTables.map((t) => t.name).join(', ')}\n`);

  for (const targetTable of DESIRED_SCHEMA) {
    const existing = existingTableMap.get(targetTable.name);

    if (!existing) {
      console.log(`➕ Creating missing table: "${targetTable.name}"...`);
      const createRes = await fetch(META_BASE_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${AIRTABLE_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: targetTable.name,
          fields: targetTable.fields,
        }),
      });

      if (!createRes.ok) {
        console.error(`❌ Error creating table "${targetTable.name}":`, createRes.status, await createRes.text());
      } else {
        console.log(`✅ Successfully created table "${targetTable.name}"!`);
      }
    } else {
      console.log(`🔍 Table "${targetTable.name}" exists. Checking missing fields...`);
      const existingFieldNames = new Set((existing.fields || []).map((f) => f.name));

      for (const fieldDef of targetTable.fields) {
        if (!existingFieldNames.has(fieldDef.name)) {
          console.log(`  ➕ Adding field "${fieldDef.name}" to table "${targetTable.name}"...`);
          const addFieldUrl = `https://api.airtable.com/v0/meta/bases/${AIRTABLE_BASE_ID}/tables/${existing.id}/fields`;
          const addRes = await fetch(addFieldUrl, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${AIRTABLE_API_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(fieldDef),
          });

          if (!addRes.ok) {
            console.error(`  ❌ Error adding field "${fieldDef.name}":`, addRes.status, await addRes.text());
          } else {
            console.log(`  ✅ Field "${fieldDef.name}" added successfully!`);
          }
        }
      }
    }
  }

  console.log('\n🎉 Airtable schema synchronization complete!');
}

syncSchema().catch((err) => console.error('Sync failed:', err));
