#!/usr/bin/env node
/**
 * Creates a compact, clearly marked Airtable dataset for the sales demo.
 * It is safe to re-run: it refuses to duplicate an existing pitch dataset.
 *
 * Usage: node scripts/generate-pitch-data.mjs --execute
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requiredArgument = '--execute';

function loadEnv() {
  const values = {};
  const file = path.join(projectRoot, '.env');
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      if (!line || /^\s*#/.test(line)) continue;
      const at = line.indexOf('=');
      if (at > 0) values[line.slice(0, at).trim()] = line.slice(at + 1).trim().replace(/^['"]|['"]$/g, '');
    }
  }
  return {
    apiKey: process.env.AIRTABLE_API_KEY || values.AIRTABLE_API_KEY,
    baseId: process.env.AIRTABLE_BASE_ID || values.AIRTABLE_BASE_ID,
  };
}

const config = loadEnv();
if (!config.apiKey || !config.baseId) throw new Error('AIRTABLE_API_KEY and AIRTABLE_BASE_ID are required.');
if (!process.argv.includes(requiredArgument)) {
  console.log(`Safety stop. Re-run with ${requiredArgument} to create the five pitch-demo interactions.`);
  process.exit(0);
}

function tableUrl(table, query = new URLSearchParams()) {
  const url = new URL(`https://api.airtable.com/v0/${config.baseId}/${encodeURIComponent(table)}`);
  url.search = query.toString();
  return url;
}

async function airtable(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Airtable request failed (${response.status}): ${detail.slice(0, 280)}`);
  }
  return response.json();
}

async function listRows(table) {
  const rows = [];
  let offset = '';
  do {
    const query = new URLSearchParams({ pageSize: '100' });
    if (offset) query.set('offset', offset);
    const payload = await airtable(tableUrl(table, query));
    rows.push(...(payload.records || []));
    offset = String(payload.offset || '');
  } while (offset);
  return rows;
}

async function createRows(table, records) {
  for (let index = 0; index < records.length; index += 10) {
    await airtable(tableUrl(table), {
      method: 'POST',
      body: JSON.stringify({ records: records.slice(index, index + 10), typecast: true }),
    });
  }
}

const now = Date.now();
const at = (minutesAgo) => new Date(now - minutesAgo * 60_000).toISOString();
const interactions = [
  {
    id: 'pitch_jean_luc_picard',
    guest: 'Jean-Luc Picard',
    channel: 'whatsapp',
    serviceType: 'Housekeeping',
    serviceRef: 'Extra Towels',
    revenue: 0,
    isUpsell: false,
    minutesAgo: 42,
    user: 'Could you please send two extra towels to my suite? Thank you.',
    assistant: 'Certainly, Mr Picard. I have alerted Housekeeping to deliver two fresh towels to your suite right away.',
    summary: 'Priority in-stay request: deliver two extra towels to Jean-Luc Picard’s suite.',
  },
  {
    id: 'pitch_marie_dubois',
    guest: 'Marie Dubois',
    channel: 'web',
    serviceType: 'Spa & Wellness',
    serviceRef: 'Lumière Spa — Couples Massage',
    revenue: 220,
    isUpsell: true,
    minutesAgo: 34,
    user: 'Please arrange the Couples Massage for two tomorrow afternoon.',
    assistant: 'With pleasure, Ms Dubois. I have recorded your Couples Massage request for two; our spa team will confirm the preferred time shortly.',
    summary: 'Premium add-on: Couples Massage for two, requested for tomorrow afternoon.',
  },
  {
    id: 'pitch_arthur_pendelton',
    guest: 'Arthur Pendelton',
    channel: 'whatsapp',
    serviceType: 'Transport',
    serviceRef: 'Airport Transfer — CDG',
    revenue: 130,
    isUpsell: true,
    minutesAgo: 26,
    user: 'Could you arrange an airport transfer to CDG for tomorrow morning?',
    assistant: 'Absolutely, Mr Pendelton. I have logged your private airport-transfer request and our concierge will confirm the collection time with you.',
    summary: 'Premium airport transfer to CDG requested for tomorrow morning.',
  },
  {
    id: 'pitch_elena_rostova',
    guest: 'Elena Rostova',
    channel: 'web',
    serviceType: 'Maintenance',
    serviceRef: 'In-Room Air Conditioning',
    revenue: 0,
    isUpsell: false,
    minutesAgo: 18,
    user: 'The air conditioning in my room is not cooling. Could someone please help?',
    assistant: 'I am sorry for the inconvenience, Ms Rostova. Engineering has been notified with priority and will attend to the air conditioning promptly.',
    summary: 'Priority maintenance: investigate and repair in-room air conditioning for Elena Rostova.',
  },
  {
    id: 'pitch_kenji_sato',
    guest: 'Kenji Sato',
    channel: 'whatsapp',
    serviceType: 'General Manager',
    serviceRef: 'General Manager Escalation — Noise Complaint',
    revenue: 0,
    isUpsell: false,
    minutesAgo: 9,
    user: 'The noise all night ruined my stay. I am leaving a one-star review.',
    assistant: 'Mr Sato, I sincerely apologize. I have escalated your feedback directly to our General Manager for immediate private follow-up.',
    summary: 'URGENT service recovery: one-star review risk following overnight noise complaint from Kenji Sato.',
    priority: 'high',
  },
];

const userIds = new Set(interactions.map((item) => `demo:${item.id}`));
const [existingConversations, existingRequests] = await Promise.all([listRows('Conversations'), listRows('Requests')]);
const duplicates = [...existingConversations, ...existingRequests].filter((row) => userIds.has(row.fields?.UserID));
if (duplicates.length) throw new Error('Pitch data already exists; refusing to create duplicate demo records.');

const conversations = interactions.flatMap((item) => {
  const userId = `demo:${item.id}`;
  return [
    { fields: { UserID: userId, Channel: item.channel, Role: 'user', 'Guest Name': item.guest, Message: item.user, Language: 'en', Timestamp: at(item.minutesAgo + 1), Is_Demo: true } },
    { fields: { UserID: userId, Channel: item.channel, Role: 'assistant', 'Guest Name': item.guest, Message: item.assistant, Language: 'en', Timestamp: at(item.minutesAgo), Is_Demo: true } },
  ];
});
const requests = interactions.map((item) => ({
  fields: {
    UserID: `demo:${item.id}`,
    Channel: item.channel,
    GuestName: item.guest,
    ServiceType: item.serviceType,
    RequestSummary: item.summary,
    Source: 'pitch_demo',
    ServiceRef: item.serviceRef,
    Status: 'new',
    Revenue: item.revenue,
    IsUpsell: item.isUpsell,
    Language: 'en',
    HandoverAt: at(item.minutesAgo),
    'Priority (AI)': item.priority || 'normal',
    Is_Demo: true,
  },
}));

await createRows('Conversations', conversations);
await createRows('Requests', requests);

const [createdConversations, createdRequests] = await Promise.all([listRows('Conversations'), listRows('Requests')]);
const conversationRows = createdConversations.filter((row) => userIds.has(row.fields?.UserID));
const requestRows = createdRequests.filter((row) => userIds.has(row.fields?.UserID));
assert.equal(conversationRows.length, 10, 'Expected ten pitch-demo conversation messages.');
assert.equal(requestRows.length, 5, 'Expected five pitch-demo requests.');
assert.ok([...conversationRows, ...requestRows].every((row) => row.fields?.Is_Demo === true), 'Every pitch record must be marked Is_Demo.');
assert.deepEqual(requestRows.map((row) => row.fields?.ServiceType).sort(), ['General Manager', 'Housekeeping', 'Maintenance', 'Spa & Wellness', 'Transport']);
assert.equal(requestRows.reduce((total, row) => total + Number(row.fields?.Revenue || 0), 0), 350, 'Expected €350 in pitch add-on revenue.');

console.log(JSON.stringify({
  result: 'PASS',
  demo_requests: requestRows.length,
  demo_conversations: conversationRows.length,
  categories: requestRows.map((row) => row.fields?.ServiceType).sort(),
  add_on_revenue_eur: requestRows.reduce((total, row) => total + Number(row.fields?.Revenue || 0), 0),
  all_records_marked_demo: true,
}, null, 2));
