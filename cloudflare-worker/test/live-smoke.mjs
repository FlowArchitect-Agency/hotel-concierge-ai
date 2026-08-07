/**
 * Exercises the production Worker code with real provider credentials from the
 * private project .env. It is intentionally excluded from npm test so ordinary
 * unit tests never spend provider credits. The sole write test deletes its own
 * Airtable records before exiting.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { default: worker } = await import(pathToFileURL(path.join(projectRoot, 'cloudflare-worker', 'src', 'index.js')).href);

function loadPrivateEnv() {
  const values = {};
  for (const line of fs.readFileSync(path.join(projectRoot, '.env'), 'utf8').split(/\r?\n/)) {
    if (!line || /^\s*#/.test(line)) continue;
    const separator = line.indexOf('=');
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '');
    values[key] = value;
  }
  for (const key of ['GROQ_API_KEY', 'AIRTABLE_API_KEY', 'AIRTABLE_BASE_ID']) {
    assert.ok(values[key] && !/^(your_|replace-with)/i.test(values[key]), `${key} is required in the private .env.`);
  }
  return {
    ...values,
    ALLOWED_ORIGIN: 'https://flowarchitect-agency.github.io',
    HOTEL_CITY: values.HOTEL_CITY || 'Paris',
    HOTEL_NAME: values.HOTEL_NAME || 'H\u00f4tel Lumi\u00e8re Paris',
    GROQ_MODEL: values.GROQ_MODEL || 'qwen/qwen3.6-27b',
    GROQ_FALLBACK_MODEL: values.GROQ_FALLBACK_MODEL || 'openai/gpt-oss-20b',
  };
}

const env = loadPrivateEnv();
const origin = 'https://flowarchitect-agency.github.io';

async function chat(message, sessionId, testMode, waitUntil = () => undefined) {
  const response = await worker.fetch(new Request('https://worker.local/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({ message, sessionId, testMode }),
  }), env, { waitUntil });
  return { response, body: await response.json() };
}

async function streamChat(message, sessionId) {
  const response = await worker.fetch(new Request('https://worker.local/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', Origin: origin },
    body: JSON.stringify({ message, sessionId, testMode: 'read_only' }),
  }), env, { waitUntil() { throw new Error('A read-only test must not schedule Airtable writes.'); } });
  assert.match(response.headers.get('content-type') || '', /text\/event-stream/);
  const events = (await response.text()).split('\n\n').map((block) => {
    const data = block.split('\n').find((line) => line.startsWith('data:'))?.slice(5).trim();
    try { return data ? JSON.parse(data) : null; } catch { return null; }
  }).filter(Boolean);
  const body = events.find((item) => item.type === 'final');
  assert.ok(body, 'The event stream did not contain a final response.');
  return { response, body, statuses: events.filter((item) => item.type === 'status') };
}

function noFalseConfirmation(reply) {
  return !/\b(booked|booking is confirmed|availability is confirmed)\b/i.test(String(reply || ''));
}

async function airtableRows(table, userId) {
  const url = new URL(`https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${encodeURIComponent(table)}`);
  url.searchParams.set('filterByFormula', `{UserID}='${userId}'`);
  const response = await fetch(url, { headers: { Authorization: `Bearer ${env.AIRTABLE_API_KEY}` } });
  assert.equal(response.status, 200, `Could not read ${table} test records.`);
  return (await response.json()).records || [];
}

async function deleteRows(table, rows, baseId = env.AIRTABLE_BASE_ID) {
  for (const row of rows) {
    const response = await fetch(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}/${row.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${env.AIRTABLE_API_KEY}` },
    });
    assert.equal(response.status, 200, `Could not remove ${table} test record ${row.id}.`);
  }
}

async function airtableLeadRows(email) {
  const url = new URL(`https://api.airtable.com/v0/${env.LEADS_AIRTABLE_BASE_ID}/${encodeURIComponent('Hotel Leads')}`);
  url.searchParams.set('filterByFormula', `{Work Email}='${email}'`);
  const response = await fetch(url, { headers: { Authorization: `Bearer ${env.AIRTABLE_API_KEY}` } });
  assert.equal(response.status, 200, 'Could not read Hotel Leads test records.');
  return (await response.json()).records || [];
}

const report = { readOnly: false, airtableWrite: false, bookingEnquiry: false, discoveryLead: false };

const readOnly = await streamChat('I am looking for fancy Spanish restaurants near the Eiffel Tower.', `qa_readonly_${Date.now()}`);
assert.equal(readOnly.response.status, 200);
assert.equal(readOnly.body.provider_failure || null, null);
assert.ok(readOnly.statuses.some((item) => /Searching current Paris addresses/i.test(item.message)), 'The concierge did not stream a search status.');
assert.ok((readOnly.body.recommendations || []).length > 0, 'Expected verified Spanish external options.');
assert.ok((readOnly.body.recommendations || []).every((item) => item.name && item.description && item.website_url && item.image_url), 'Each recommendation must contain the card fields.');
assert.ok(!(readOnly.body.recommendations || []).some((item) => /mission locale|our italian restaurants/i.test(item.name)), 'A generic or unrelated result leaked into recommendations.');
assert.ok(!/Le Jardin/i.test(String(readOnly.body.reply || '')), 'The stale French recommendation leaked into the cuisine response.');
assert.ok(noFalseConfirmation(readOnly.body.reply), 'The concierge claimed a booking or availability confirmation.');

const finalDay = await streamChat('What do you suggest for me? It is my last day in Paris.', `qa_itinerary_${Date.now()}`);
assert.equal(finalDay.body.provider_failure || null, null);
assert.ok(finalDay.statuses.some((item) => /Searching current Paris addresses/i.test(item.message)), 'The final-day request did not trigger an external search.');
assert.ok((finalDay.body.recommendations || []).length > 0, 'Expected verified Paris itinerary options.');
assert.match(String(finalDay.body.reply || ''), /For your final day in Paris/i, 'Expected a concrete final-day suggestion.');
assert.ok(noFalseConfirmation(finalDay.body.reply), 'The concierge claimed a booking or availability confirmation.');

const unfamiliarDiscovery = await streamChat('A perfumery workshop in Paris, please.', `qa_discovery_${Date.now()}`);
assert.equal(unfamiliarDiscovery.body.provider_failure || null, null);
assert.ok(unfamiliarDiscovery.statuses.some((item) => /Searching current Paris addresses/i.test(item.message)), 'The unfamiliar request did not trigger an external search.');
assert.ok((unfamiliarDiscovery.body.recommendations || []).length > 0, 'Expected verified external options for an unfamiliar request.');
assert.ok((unfamiliarDiscovery.body.recommendations || []).every((item) => item.name && item.description && item.website_url && item.image_url), 'Each unfamiliar-request card must contain the required fields.');
assert.ok(noFalseConfirmation(unfamiliarDiscovery.body.reply), 'The concierge claimed a booking or availability confirmation.');
report.readOnly = true;

const sessionId = `qa_write_${Date.now()}`;
const userId = `web:${sessionId}`;
const scheduled = [];
let conversations = [];
let requests = [];
try {
  const write = await chat('Please arrange a couples massage tomorrow afternoon for two guests.', sessionId, 'write_verified', (promise) => scheduled.push(promise));
  assert.equal(write.response.status, 200);
  assert.equal(write.body.provider_failure || null, null);
  assert.ok(noFalseConfirmation(write.body.reply), 'The concierge claimed a booking or availability confirmation.');
  await Promise.all(scheduled);
  conversations = await airtableRows('Conversations', userId);
  requests = await airtableRows('Requests', userId);
  assert.ok(conversations.length >= 2, 'Expected separate inbound and assistant conversation records.');
  assert.ok(requests.length > 0, 'Expected a concierge request record.');
  assert.ok(requests.every(({ fields }) => fields.UserID === userId && fields.RequestSummary && fields.ServiceType && fields.Status), 'Airtable request fields are incomplete.');
  report.airtableWrite = true;
} finally {
  await deleteRows('Conversations', conversations);
  await deleteRows('Requests', requests);
}

const bookingSessionId = `qa_booking_${Date.now()}`;
const bookingUserId = `web:${bookingSessionId}`;
let bookingRequests = [];
try {
  const bookingResponse = await worker.fetch(new Request('https://worker.local/api/booking-enquiry', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({
      guestName: 'QA Concierge Guest',
      email: 'qa-concierge@example.invalid',
      preferredDate: '2026-12-20',
      preferredTime: '19:30',
      partySize: 2,
      notes: 'Automated verification only.',
      serviceName: 'Le Jardin \u2014 Chef\u2019s Table',
      serviceType: 'restaurant',
      sessionId: bookingSessionId,
      language: 'en',
      consent: true,
    }),
  }), env, { waitUntil() {} });
  const bookingBody = await bookingResponse.json();
  assert.equal(bookingResponse.status, 201);
  assert.equal(bookingBody.ok, true);
  bookingRequests = await airtableRows('Requests', bookingUserId);
  assert.equal(bookingRequests.length, 1, 'Expected exactly one booking enquiry record.');
  assert.equal(bookingRequests[0].fields.GuestName, 'QA Concierge Guest');
  assert.match(bookingRequests[0].fields.RequestSummary, /qa-concierge@example\.invalid/);
  report.bookingEnquiry = true;
} finally {
  await deleteRows('Requests', bookingRequests);
}

const discoveryEmail = `qa-discovery-${Date.now()}@example.invalid`;
let discoveryRequests = [];
try {
  const discoveryResponse = await worker.fetch(new Request('https://worker.local/api/discovery-lead', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({
      contactName: 'QA Hotelier',
      hotelName: 'QA Maison Paris',
      email: discoveryEmail,
      phone: '+33 1 00 00 00 00',
      city: 'Paris',
      roomCount: 42,
      website: 'https://example.invalid',
      message: 'Automated verification only.',
      consent: true,
    }),
  }), env, { waitUntil() {} });
  const discoveryBody = await discoveryResponse.json();
  assert.equal(discoveryResponse.status, 201);
  assert.equal(discoveryBody.ok, true);
  discoveryRequests = await airtableLeadRows(discoveryEmail);
  assert.equal(discoveryRequests.length, 1, 'Expected exactly one sales discovery record.');
  assert.equal(discoveryRequests[0].fields['Contact Name'], 'QA Hotelier');
  assert.equal(discoveryRequests[0].fields['Hotel Name'], 'QA Maison Paris');
  report.discoveryLead = true;
} finally {
  await deleteRows('Hotel Leads', discoveryRequests, env.LEADS_AIRTABLE_BASE_ID);
}

console.log(JSON.stringify({ ok: true, ...report }));
