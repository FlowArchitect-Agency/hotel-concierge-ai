#!/usr/bin/env node
/**
 * Exercises a real, persisted four-message conversation against the deployed
 * Worker. It verifies both replies and Airtable state, not just model text.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const turns = [
  'Hi, we arrive on Friday. Can we get an airport transfer from CDG?',
  'Yes, book it for 2 people.',
  'Actually, cancel the taxi. But I do want to book a couples massage.',
  'Wait, did you cancel the taxi like I asked?',
];

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
    airtableKey: process.env.AIRTABLE_API_KEY || values.AIRTABLE_API_KEY,
    baseId: process.env.AIRTABLE_BASE_ID || values.AIRTABLE_BASE_ID,
    endpoint: process.env.CONCIERGE_API_URL || values.CONCIERGE_API_URL || 'https://conciergeflow-api.conciergeflow-worker.workers.dev/api/chat',
  };
}

const config = loadEnv();
if (!config.airtableKey || !config.baseId) throw new Error('AIRTABLE_API_KEY and AIRTABLE_BASE_ID are required.');

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function airtableRows(table, userId) {
  const records = [];
  let offset = '';
  do {
    const url = new URL(`https://api.airtable.com/v0/${config.baseId}/${encodeURIComponent(table)}`);
    url.searchParams.set('filterByFormula', `{UserID}='${userId.replace(/'/g, "\\'")}'`);
    url.searchParams.set('pageSize', '100');
    url.searchParams.set('sort[0][field]', table === 'Conversations' ? 'Timestamp' : 'HandoverAt');
    url.searchParams.set('sort[0][direction]', 'asc');
    if (offset) url.searchParams.set('offset', offset);
    const response = await fetch(url, { headers: { Authorization: `Bearer ${config.airtableKey}` } });
    if (!response.ok) throw new Error(`Airtable ${table} read failed (${response.status}).`);
    const body = await response.json();
    records.push(...(body.records || []));
    offset = String(body.offset || '');
  } while (offset);
  return records;
}

async function waitFor(label, predicate, timeoutMs = 12_000) {
  const until = Date.now() + timeoutMs;
  let value;
  do {
    value = await predicate();
    if (value) return value;
    await delay(300);
  } while (Date.now() < until);
  throw new Error(`Timed out waiting for ${label}.`);
}

async function sendTurn(message, sessionId) {
  const response = await fetch(config.endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      sessionId,
      guestName: 'Context Tester',
      isDemo: true,
      testMode: 'write_verified',
    }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`Turn failed (${response.status}): ${body.error || 'unknown error'}`);
  return body;
}

const sessionId = `context_tester_${Date.now()}`;
const userId = `web:${sessionId}`;
const replies = [];

for (let index = 0; index < turns.length; index += 1) {
  replies.push(await sendTurn(turns[index], sessionId));
  await waitFor(`turn ${index + 1} conversation records`, async () => {
    const conversations = await airtableRows('Conversations', userId);
    return conversations.length >= (index + 1) * 2 ? conversations : null;
  });
  if (index === 1) {
    await waitFor('transport booking request', async () => {
      const rows = await airtableRows('Requests', userId);
      return rows.some((row) => row.fields?.ServiceType === 'Transport') ? rows : null;
    });
  }
  if (index === 2) {
    await waitFor('transport cancellation and spa request', async () => {
      const rows = await airtableRows('Requests', userId);
      const transportCancelled = rows.some((row) => row.fields?.ServiceType === 'Transport' && String(row.fields?.Status || '').toLowerCase() === 'cancelled');
      const spaRequested = rows.some((row) => row.fields?.ServiceType === 'Spa & Wellness');
      return transportCancelled && spaRequested ? rows : null;
    });
  }
}

const [conversations, requests] = await Promise.all([
  airtableRows('Conversations', userId),
  waitFor('transport cancellation and spa request', async () => {
    const rows = await airtableRows('Requests', userId);
    const transportCancelled = rows.some((row) => row.fields?.ServiceType === 'Transport' && String(row.fields?.Status || '').toLowerCase() === 'cancelled');
    const spaRequested = rows.some((row) => row.fields?.ServiceType === 'Spa & Wellness');
    return transportCancelled && spaRequested ? rows : null;
  }),
]);

const userMessages = conversations
  .filter((row) => row.fields?.Role === 'user')
  .map((row) => row.fields?.Message);
const transport = requests.filter((row) => row.fields?.ServiceType === 'Transport');
const spa = requests.filter((row) => row.fields?.ServiceType === 'Spa & Wellness');

assert.deepEqual(userMessages, turns, 'The saved conversation must contain all four turns in order.');
assert.ok(transport.some((row) => String(row.fields?.Status || '').toLowerCase() === 'cancelled'), 'The airport transfer must be cancelled in Airtable.');
assert.ok(spa.length >= 1, 'The couples-massage intent must create a Spa & Wellness request.');
assert.match(String(replies[3]?.reply || ''), /cancelled|canceled/i, 'The final reply must confirm the taxi cancellation.');

console.log(JSON.stringify({
  result: 'PASS',
  session_id: sessionId,
  turns: turns.length,
  conversation_records: conversations.length,
  transport_statuses: transport.map((row) => row.fields?.Status),
  spa_requests: spa.length,
  final_reply: String(replies[3]?.reply || '').replace(/\s+/g, ' ').slice(0, 220),
}, null, 2));
