import assert from 'node:assert/strict';
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
    ENDPOINT: 'https://conciergeflow-api.conciergeflow-worker.workers.dev/api/demo-chat',
    ORIGIN: 'https://flowarchitect-agency.github.io',
  };
}

const config = loadEnv();

async function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function airtableQuery(table, filterFormula) {
  const url = new URL(`https://api.airtable.com/v0/${config.AIRTABLE_BASE_ID}/${encodeURIComponent(table)}`);
  if (filterFormula) {
    url.searchParams.set('filterByFormula', filterFormula);
  }
  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${config.AIRTABLE_API_KEY}`,
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Airtable query failed (${res.status}): ${errText}`);
  }
  return await res.json();
}

async function runTest1_PositiveReview() {
  console.log('\n======================================================');
  console.log('TEST 1: Positive Post-Checkout Review (Google Review Route)');
  console.log('======================================================');
  const sessionId = `demo_qa_pos_${Date.now()}`;
  const guestName = 'Reviewer Positive';
  const payload = {
    guestName: guestName,
    language: 'English',
    scenario: 'post_checkout',
    is_demo: true,
    sessionId: sessionId,
    chatHistory: [
      { role: 'user', content: 'Loved it! Everything was wonderful, 5 stars!' }
    ],
  };

  console.log(`[1.1] Sending POST to live endpoint: ${config.ENDPOINT}`);
  console.log('Payload:', JSON.stringify(payload, null, 2));

  const response = await fetch(config.ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: config.ORIGIN,
      Accept: 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const status = response.status;
  const json = await response.json();

  console.log(`\n[1.2] Live Worker Response (HTTP ${status}):`);
  console.log(JSON.stringify(json, null, 2));

  assert.equal(status, 200, `Expected HTTP 200, got ${status}`);
  assert.match(json.reply, /Thank you so much|thrilled|wonderful/i, 'Expected warm thank you reply');
  assert.match(json.reply, /https:\/\/g\.page\/r\/hotel-lumiere-paris\/review/, 'Expected Google Review public link');
  assert.equal(json.requires_human, false, 'Positive review should not require human escalation');
  assert.equal(json.escape_hatch_triggered, false, 'Positive review should not trigger escape hatch');
  console.log('✅ Positive review correctly routed to public Google Review link.');

  console.log('\n[1.3] Polling Airtable Guests table for "Reviewer Positive"...');
  const userId = `web:${sessionId}`;
  let guestRecord = null;
  for (let attempt = 1; attempt <= 6; attempt++) {
    console.log(`  Attempt ${attempt}/6: Querying Guests for UserID='${userId}'...`);
    const res = await airtableQuery('Guests', `{UserID} = '${userId}'`);
    if (res.records && res.records.length > 0) {
      guestRecord = res.records[0];
      break;
    }
    await delay(2000);
  }

  assert.ok(guestRecord, `Guest record for UserID '${userId}' was not found in Airtable Guests table.`);
  console.log('Found Guest record:', JSON.stringify(guestRecord.fields, null, 2));
  assert.equal(guestRecord.fields.GuestName, guestName, `GuestName column mismatch! Got: ${guestRecord.fields.GuestName}`);
  assert.equal(guestRecord.fields.Is_Demo, true, 'Is_Demo flag must be true');
  console.log('✅ Guest record confirmed in Airtable Guests table with GuestName="Reviewer Positive" and Is_Demo=true.');

  console.log('\n[1.4] Checking Airtable Requests table to ensure NO complaint tickets were created...');
  const reqRes = await airtableQuery('Requests', `{UserID} = '${userId}'`);
  assert.equal(reqRes.records?.length || 0, 0, 'No complaint request should be created for positive reviews');
  console.log('✅ Airtable Requests table clean (0 complaint tickets generated).');
}

async function runTest2_NegativeReview() {
  console.log('\n======================================================');
  console.log('TEST 2: Negative Post-Checkout Review (General Manager Recovery Route)');
  console.log('======================================================');
  const sessionId = `demo_qa_neg_${Date.now()}`;
  const guestName = 'Reviewer Critical';
  const payload = {
    guestName: guestName,
    language: 'English',
    scenario: 'post_checkout',
    is_demo: true,
    sessionId: sessionId,
    chatHistory: [
      { role: 'user', content: 'The room was noisy and the shower was broken. Terrible experience.' }
    ],
  };

  console.log(`[2.1] Sending POST to live endpoint: ${config.ENDPOINT}`);
  console.log('Payload:', JSON.stringify(payload, null, 2));

  const response = await fetch(config.ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: config.ORIGIN,
      Accept: 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const status = response.status;
  const json = await response.json();

  console.log(`\n[2.2] Live Worker Response (HTTP ${status}):`);
  console.log(JSON.stringify(json, null, 2));

  assert.equal(status, 200, `Expected HTTP 200, got ${status}`);
  assert.match(json.reply, /sincerely apologize/i, 'Expected sincere apology');
  assert.match(json.reply, /General Manager/i, 'Expected mention of General Manager private review');
  assert.equal(/g\.page|tripadvisor/i.test(json.reply), false, 'Negative review MUST NOT send public review link');
  assert.equal(json.requires_human, true, 'Negative review must set requires_human: true');
  assert.equal(json.escape_hatch_triggered, true, 'Negative review must set escape_hatch_triggered: true');
  assert.equal(json.media, null, 'Negative review must not have public review media');
  assert.ok(
    json.staff_alerts && json.staff_alerts.some((a) => /General Manager/i.test(a.role || a.summary)),
    'Expected General Manager staff alert'
  );
  console.log('✅ Negative review correctly intercepted: profuse apology, zero public review links, General Manager alerted.');

  console.log('\n[2.3] Polling Airtable Requests table for General Manager ticket...');
  const userId = `web:${sessionId}`;
  let requestRecord = null;
  for (let attempt = 1; attempt <= 6; attempt++) {
    console.log(`  Attempt ${attempt}/6: Querying Requests for UserID='${userId}'...`);
    const res = await airtableQuery('Requests', `{UserID} = '${userId}'`);
    if (res.records && res.records.length > 0) {
      requestRecord = res.records[0];
      break;
    }
    await delay(2000);
  }

  assert.ok(requestRecord, `Request record for UserID '${userId}' was not found in Airtable Requests table.`);
  console.log('Found Request record:', JSON.stringify(requestRecord.fields, null, 2));
  assert.equal(requestRecord.fields.GuestName, guestName, `GuestName column mismatch! Got: ${requestRecord.fields.GuestName}`);
  assert.equal(requestRecord.fields.ServiceType, 'General Manager', `ServiceType mismatch! Got: ${requestRecord.fields.ServiceType}`);
  assert.equal(requestRecord.fields.Is_Demo, true, 'Is_Demo flag must be true');
  assert.match(requestRecord.fields.RequestSummary, /URGENT POST-CHECKOUT SERVICE RECOVERY/i);
  console.log('✅ Confirmed General Manager private recovery ticket written to Airtable Requests table with GuestName="Reviewer Critical" and Is_Demo=true.');

  console.log('\n[2.4] Polling Airtable Guests table for "Reviewer Critical"...');
  let guestRecord = null;
  for (let attempt = 1; attempt <= 6; attempt++) {
    console.log(`  Attempt ${attempt}/6: Querying Guests for UserID='${userId}'...`);
    const res = await airtableQuery('Guests', `{UserID} = '${userId}'`);
    if (res.records && res.records.length > 0) {
      guestRecord = res.records[0];
      break;
    }
    await delay(2000);
  }

  assert.ok(guestRecord, `Guest record for UserID '${userId}' was not found in Airtable Guests table.`);
  console.log('Found Guest record:', JSON.stringify(guestRecord.fields, null, 2));
  assert.equal(guestRecord.fields.GuestName, guestName);
  assert.equal(guestRecord.fields.Is_Demo, true);
  console.log('✅ Guest record confirmed in Airtable Guests table with GuestName="Reviewer Critical" and Is_Demo=true.');
}

async function main() {
  console.log('Starting Post-Checkout Review AI-First QA test suite against LIVE Cloudflare endpoint and Airtable Base...');
  await runTest1_PositiveReview();
  await runTest2_NegativeReview();
  console.log('\n======================================================');
  console.log('🎉 ALL POST-CHECKOUT QA VERIFICATIONS PASSED SUCCESSFULLY!');
  console.log('======================================================\n');
}

main().catch((err) => {
  console.error('\n❌ QA SUITE FAILED:', err);
  process.exit(1);
});
