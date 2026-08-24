#!/usr/bin/env node
/**
 * Permanently removes every record from the prototype Conversations and
 * Requests tables. The explicit --execute switch makes accidental use safe:
 *   node scripts/wipe-test-data.mjs --execute
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TABLES = ['Conversations', 'Requests'];
const MAX_PASSES = 25;

function loadLocalEnv() {
  const local = {};
  const file = path.join(projectRoot, '.env');
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      if (!line || /^\s*#/.test(line)) continue;
      const separator = line.indexOf('=');
      if (separator <= 0) continue;
      const key = line.slice(0, separator).trim();
      const value = line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '');
      local[key] = value;
    }
  }
  return local;
}

const localEnv = loadLocalEnv();
const apiKey = process.env.AIRTABLE_API_KEY || localEnv.AIRTABLE_API_KEY;
const baseId = process.env.AIRTABLE_BASE_ID || localEnv.AIRTABLE_BASE_ID;

if (!apiKey || !baseId) throw new Error('AIRTABLE_API_KEY and AIRTABLE_BASE_ID are required.');
if (!process.argv.includes('--execute')) {
  console.log('Dry-run safety stop. Re-run with --execute to permanently wipe Conversations and Requests.');
  process.exit(0);
}

function tableUrl(table, search = new URLSearchParams()) {
  const url = new URL(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}`);
  url.search = search.toString();
  return url;
}

async function request(url, options = {}, attempt = 0) {
  const response = await fetch(url, {
    ...options,
    headers: { Authorization: `Bearer ${apiKey}`, ...(options.headers || {}) },
  });
  if ((response.status === 429 || response.status >= 500) && attempt < 4) {
    const retryAfter = Number(response.headers.get('retry-after'));
    await new Promise((resolve) => setTimeout(resolve, Number.isFinite(retryAfter) ? retryAfter * 1000 : (attempt + 1) * 500));
    return request(url, options, attempt + 1);
  }
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Airtable request failed (${response.status}): ${detail.slice(0, 300)}`);
  }
  return response.json();
}

async function listRecordIds(table) {
  const ids = [];
  let offset = '';
  do {
    const query = new URLSearchParams({ pageSize: '100' });
    if (offset) query.set('offset', offset);
    const body = await request(tableUrl(table, query));
    ids.push(...(body.records || []).map((record) => record.id).filter(Boolean));
    offset = String(body.offset || '');
  } while (offset);
  return ids;
}

async function deleteBatch(table, ids) {
  const query = new URLSearchParams();
  for (const id of ids) query.append('records[]', id);
  await request(tableUrl(table, query), { method: 'DELETE' });
}

async function wipeTable(table) {
  let deleted = 0;
  for (let pass = 1; pass <= MAX_PASSES; pass += 1) {
    const ids = await listRecordIds(table);
    if (!ids.length) return deleted;
    for (let index = 0; index < ids.length; index += 10) {
      const batch = ids.slice(index, index + 10);
      await deleteBatch(table, batch);
      deleted += batch.length;
    }
  }
  throw new Error(`${table} did not stay empty after ${MAX_PASSES} wipe passes.`);
}

const before = Object.fromEntries(await Promise.all(TABLES.map(async (table) => [table, (await listRecordIds(table)).length])));
console.log(`Records found — Conversations: ${before.Conversations}; Requests: ${before.Requests}.`);

const deleted = {};
for (const table of TABLES) deleted[table] = await wipeTable(table);

const remaining = Object.fromEntries(await Promise.all(TABLES.map(async (table) => [table, (await listRecordIds(table)).length])));
if (Object.values(remaining).some(Boolean)) throw new Error(`Wipe verification failed: ${JSON.stringify(remaining)}`);

console.log(`Wipe complete — Conversations deleted: ${deleted.Conversations}; Requests deleted: ${deleted.Requests}; remaining: 0.`);
