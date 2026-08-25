#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadEnv() {
  const env = {};
  const envPath = path.join(projectRoot, '.env');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      if (!line || /^\s*#/.test(line)) continue;
      const sep = line.indexOf('=');
      if (sep > 0) {
        const key = line.slice(0, sep).trim();
        const val = line.slice(sep + 1).trim().replace(/^['"]|['"]$/g, '');
        env[key] = val;
      }
    }
  }
  return {
    AIRTABLE_API_KEY: process.env.AIRTABLE_API_KEY || env.AIRTABLE_API_KEY,
    AIRTABLE_BASE_ID: process.env.AIRTABLE_BASE_ID || env.AIRTABLE_BASE_ID || 'appWUORad3wvaHttY',
  };
}

const config = loadEnv();

async function main() {
  const res = await fetch(`https://api.airtable.com/v0/${config.AIRTABLE_BASE_ID}/Services`, {
    headers: { Authorization: `Bearer ${config.AIRTABLE_API_KEY}` },
  });
  const data = await res.json();
  console.log(`Found ${data.records.length} total services in Airtable:\n`);

  // Define the Top 8 most luxury & premium core services
  const TOP_8_PREMIUM = new Set([
    'Le Jardin — Chef\'s Table (2 Michelin)',
    'Terrasse Lumière — Rooftop Dinner',
    'Private Chauffeur — CDG/ORY Transfer',
    'Private Chauffeur — Half-Day Disposal',
    'Lumière Spa — Couples Massage',
    'Lumière Spa — Signature Hammam Ritual',
    'VIP Louvre After-Hours Private Tour',
    'Versailles Private Day Trip',
  ]);

  for (const record of data.records) {
    const name = record.fields.Name;
    const isTop8 = TOP_8_PREMIUM.has(name);
    console.log(`- [${isTop8 ? 'KEEP ACTIVE' : 'DEACTIVATE'}] ${name} (${record.fields.Category}) — EUR ${record.fields['Price EUR']}`);
    
    // Update active status
    if (process.argv.includes('--execute')) {
      await fetch(`https://api.airtable.com/v0/${config.AIRTABLE_BASE_ID}/Services/${record.id}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${config.AIRTABLE_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          fields: {
            Active: isTop8,
          },
        }),
      });
    }
  }

  if (!process.argv.includes('--execute')) {
    console.log('\nRun with --execute to apply this curation to Airtable.');
  } else {
    console.log('\n✨ Curation applied: Top 8 luxury services are ACTIVE, others deactivated.');
  }
}

main().catch(console.error);
