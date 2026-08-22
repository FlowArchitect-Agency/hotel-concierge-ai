import { config } from 'dotenv';
import { resolve } from 'path';
import { writeFileSync } from 'fs';

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

async function apiRequest(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${AIRTABLE_API_KEY}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Airtable API error ${res.status} on ${url}: ${text}`);
  }
  return res.json();
}

async function configureRelationalAirtable() {
  console.log(`=== Configuring Master Relational Schema for Base: ${AIRTABLE_BASE_ID} ===\n`);

  // 1. Fetch current tables
  const baseMeta = await apiRequest(META_BASE_URL);
  const tables = baseMeta.tables || [];
  const tableMap = new Map(tables.map((t) => [t.name, t]));

  console.log(`Found existing tables: ${Array.from(tableMap.keys()).join(', ')}\n`);

  // Ensure all 6 tables exist
  const coreTableNames = ['Guests', 'Reservations', 'Staff', 'Requests', 'Conversations', 'Services'];

  for (const name of coreTableNames) {
    if (!tableMap.has(name)) {
      console.log(`➕ Creating table "${name}"...`);
      const created = await apiRequest(META_BASE_URL, {
        method: 'POST',
        body: JSON.stringify({
          name,
          fields: [field('Name', 'singleLineText')],
        }),
      });
      tableMap.set(name, created);
      console.log(`✅ Created table "${name}" (${created.id})`);
    }
  }

  // Refetch base meta to get fresh table IDs
  const updatedMeta = await apiRequest(META_BASE_URL);
  const freshTableMap = new Map(updatedMeta.tables.map((t) => [t.name, t]));

  const guestsTableId = freshTableMap.get('Guests').id;
  const staffTableId = freshTableMap.get('Staff').id;

  // 2. Define Master Fields to add/ensure on each table
  const MASTER_FIELDS = {
    Guests: [
      field('Phone Number', 'singleLineText'),
      field('Name', 'singleLineText'),
      field('Language', 'singleLineText'),
      { name: 'VIP Status', ...select(['Standard', 'VIP', 'Celebrity']) },
      field('Known Preferences', 'multilineText'),
    ],
    Reservations: [
      field('Reservation ID', 'singleLineText'),
      field('Guest', 'multipleRecordLinks', { linkedTableId: guestsTableId }),
      field('Check-In Date', 'date', { dateFormat: { name: 'iso', format: 'YYYY-MM-DD' } }),
      field('Check-Out Date', 'date', { dateFormat: { name: 'iso', format: 'YYYY-MM-DD' } }),
      field('Room Number', 'singleLineText'),
      { name: 'Status', ...select(['new', 'confirmed', 'cancelled', 'completed']) },
    ],
    Staff: [
      field('Staff Name', 'singleLineText'),
      { name: 'Role', ...select(['Receptionist', 'Housekeeping', 'Concierge', 'Manager', 'Maintenance']) },
      field('WhatsApp Number', 'phoneNumber'),
      field('On-Duty', 'checkbox', { icon: 'check', color: 'greenBright' }),
    ],
    Requests: [
      field('Request ID', 'singleLineText'),
      field('Guest', 'multipleRecordLinks', { linkedTableId: guestsTableId }),
      field('Assigned Staff', 'multipleRecordLinks', { linkedTableId: staffTableId }),
      field('Task Details', 'multilineText'),
      { name: 'Status', ...select(['new', 'in_progress', 'completed', 'cancelled']) },
    ],
    Conversations: [
      field('Message ID', 'singleLineText'),
      field('Guest', 'multipleRecordLinks', { linkedTableId: guestsTableId }),
      { name: 'Sender', ...select(['AI', 'Human', 'Guest']) },
      field('Message', 'multilineText'),
      field('Timestamp', 'singleLineText'),
    ],
    Services: [
      field('Service Name', 'singleLineText'),
      field('Price', 'singleLineText'),
      field('Operating Hours', 'singleLineText'),
      field('Details/Attachments', 'multilineText'),
      { name: 'Category', ...select(['spa', 'restaurant', 'tour', 'transport', 'experience']) },
      field('Active', 'checkbox', { icon: 'check', color: 'greenBright' }),
    ],
  };

  for (const [tableName, fieldList] of Object.entries(MASTER_FIELDS)) {
    const table = freshTableMap.get(tableName);
    console.log(`\n📋 Configuring fields for "${tableName}" (${table.id})...`);
    const existingFieldNames = new Set((table.fields || []).map((f) => f.name));

    for (const f of fieldList) {
      if (!existingFieldNames.has(f.name)) {
        console.log(`  ➕ Adding field "${f.name}" (${f.type})...`);
        try {
          const addUrl = `https://api.airtable.com/v0/meta/bases/${AIRTABLE_BASE_ID}/tables/${table.id}/fields`;
          await apiRequest(addUrl, {
            method: 'POST',
            body: JSON.stringify(f),
          });
          console.log(`  ✅ Added field "${f.name}"`);
        } catch (err) {
          console.warn(`  ⚠️ Could not add field "${f.name}":`, err.message);
        }
      } else {
        console.log(`  ✓ Field "${f.name}" already exists.`);
      }
    }
  }

  // 3. Extract final Field IDs and Table IDs map
  console.log('\n--- Extracting Final Field ID Map ---');
  const finalMeta = await apiRequest(META_BASE_URL);
  const schemaMap = {
    baseId: AIRTABLE_BASE_ID,
    tables: {},
  };

  for (const t of finalMeta.tables) {
    if (coreTableNames.includes(t.name)) {
      schemaMap.tables[t.name] = {
        tableId: t.id,
        fields: {},
      };
      for (const f of t.fields) {
        schemaMap.tables[t.name].fields[f.name] = f.id;
      }
    }
  }

  const outPath = resolve(process.cwd(), 'cloudflare-worker/src/airtable-schema.json');
  writeFileSync(outPath, JSON.stringify(schemaMap, null, 2), 'utf-8');

  console.log(`\n💾 Saved Field ID schema mapping to: ${outPath}`);
  console.log(JSON.stringify(schemaMap, null, 2));
  console.log('\n🎉 Master relational schema configuration complete!');
}

configureRelationalAirtable().catch((err) => console.error('Configuration failed:', err));
