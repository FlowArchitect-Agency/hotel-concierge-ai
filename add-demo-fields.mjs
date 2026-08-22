import { config } from 'dotenv';
import { resolve } from 'path';
import { writeFileSync, readFileSync } from 'fs';

config({ path: resolve(process.cwd(), '.env') });

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;

const META_BASE_URL = `https://api.airtable.com/v0/meta/bases/${AIRTABLE_BASE_ID}/tables`;

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

async function addDemoCheckboxFields() {
  console.log(`=== Adding Is_Demo safety lock fields to Base: ${AIRTABLE_BASE_ID} ===\n`);

  const baseMeta = await apiRequest(META_BASE_URL);
  const tables = baseMeta.tables || [];
  const targetTables = ['Guests', 'Conversations', 'Requests', 'Reservations'];

  for (const table of tables) {
    if (targetTables.includes(table.name)) {
      const existingField = (table.fields || []).find(f => f.name.toLowerCase() === 'is_demo');
      if (!existingField) {
        console.log(`➕ Adding Is_Demo checkbox to table "${table.name}" (${table.id})...`);
        try {
          const addUrl = `https://api.airtable.com/v0/meta/bases/${AIRTABLE_BASE_ID}/tables/${table.id}/fields`;
          await apiRequest(addUrl, {
            method: 'POST',
            body: JSON.stringify({
              name: 'Is_Demo',
              type: 'checkbox',
              options: { icon: 'check', color: 'greenBright' },
            }),
          });
          console.log(`  ✅ Added Is_Demo to "${table.name}"`);
        } catch (err) {
          console.warn(`  ⚠️ Could not add Is_Demo to "${table.name}":`, err.message);
        }
      } else {
        console.log(`  ✓ Is_Demo field already exists in "${table.name}" (${existingField.id})`);
      }
    }
  }

  // Update airtable-schema.json
  const finalMeta = await apiRequest(META_BASE_URL);
  const schemaPath = resolve(process.cwd(), 'cloudflare-worker/src/airtable-schema.json');
  const schemaMap = {
    baseId: AIRTABLE_BASE_ID,
    tables: {},
  };

  for (const t of finalMeta.tables) {
    if (['Guests', 'Reservations', 'Staff', 'Requests', 'Conversations', 'Services'].includes(t.name)) {
      schemaMap.tables[t.name] = {
        tableId: t.id,
        fields: {},
      };
      for (const f of t.fields) {
        schemaMap.tables[t.name].fields[f.name] = f.id;
      }
    }
  }

  writeFileSync(schemaPath, JSON.stringify(schemaMap, null, 2), 'utf-8');
  console.log(`\n💾 Updated schema JSON: ${schemaPath}`);
}

addDemoCheckboxFields().catch(console.error);
