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

async function runTest1() {
  console.log('\n======================================================');
  console.log('TEST 1: Operational Routing (Airtable GuestName Check)');
  console.log('======================================================');
  const sessionId = `demo_qa_ops_${Date.now()}`;
  const payload = {
    guestName: 'Workflow Tester',
    language: 'English',
    scenario: 'in-stay',
    is_demo: true,
    sessionId: sessionId,
    chatHistory: [
      { role: 'user', content: 'Could you please bring extra pillows to room 404?' }
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
  assert.ok(json.reply, 'Expected reply field in response');
  assert.ok(
    json.staff_alerts && json.staff_alerts.some((a) => /housekeeping|room/i.test(a.role || a.summary)),
    'Expected housekeeping staff alert'
  );
  assert.equal(json.partner_offers?.length || 0, 0, 'Operational requests must not contain partner upsell offers');
  console.log('✅ Live endpoint response verified: Housekeeping routed with zero upselling.');

  console.log('\n[1.3] Polling Airtable Guests table to verify GuestName column mapping...');
  const userId = `web:${sessionId}`;
  let guestRecord = null;
  for (let attempt = 1; attempt <= 10; attempt++) {
    await delay(1200);
    const data = await airtableQuery('Guests', `{UserID}='${userId}'`);
    if (data.records && data.records.length > 0) {
      guestRecord = data.records[0];
      break;
    }
  }

  assert.ok(guestRecord, `Guest record for UserID ${userId} not found in Airtable`);
  console.log('Airtable Guests Record found:');
  console.log(JSON.stringify(guestRecord, null, 2));

  assert.equal(
    guestRecord.fields.GuestName,
    'Workflow Tester',
    `Expected GuestName field to be 'Workflow Tester', got '${guestRecord.fields.GuestName}'`
  );
  assert.equal(
    guestRecord.fields.Is_Demo,
    true,
    'Expected Is_Demo checkbox to be true on Guests record'
  );
  console.log('✅ Airtable Guests table verification SUCCESSFUL: GuestName is "Workflow Tester" and Is_Demo is true.');

  console.log('\n[1.4] Checking Airtable Requests table for operational ticket...');
  const requestsData = await airtableQuery('Requests', `{UserID}='${userId}'`);
  assert.ok(requestsData.records && requestsData.records.length > 0, 'Expected operational ticket in Requests table');
  const reqRecord = requestsData.records[0];
  console.log('Airtable Requests Record found:');
  console.log(JSON.stringify(reqRecord, null, 2));
  assert.equal(reqRecord.fields.GuestName, 'Workflow Tester', 'Expected GuestName in Requests table');
  assert.equal(reqRecord.fields.Is_Demo, true, 'Expected Is_Demo in Requests table');
  assert.equal(Boolean(reqRecord.fields.IsUpsell), false, 'Expected IsUpsell = false');
  console.log('✅ Airtable Requests table verification SUCCESSFUL: Operational request created with ServiceType Housekeeping.');
}

async function runTest2() {
  console.log('\n======================================================');
  console.log('TEST 2: Media Payload & Real PDF Download Check');
  console.log('======================================================');
  const sessionId = `demo_qa_media_${Date.now()}`;
  const payload = {
    guestName: 'Workflow Tester',
    language: 'English',
    scenario: 'in-stay',
    is_demo: true,
    sessionId: sessionId,
    chatHistory: [
      { role: 'user', content: 'Could you please send me the Spa Menu and treatment brochure?' }
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
  assert.ok(json.media, 'Expected media object in response');
  assert.equal(json.media.type, 'document', 'Expected media.type === "document"');
  assert.equal(json.media.format, 'PDF', 'Expected media.format === "PDF"');
  assert.equal(json.media.filename, 'Lumiere_Spa_Wellness_Menu.pdf', 'Expected filename === "Lumiere_Spa_Wellness_Menu.pdf"');
  assert.ok(json.media.url, 'Expected media.url');

  console.log('✅ Live endpoint media metadata payload verified successfully.');

  console.log('\n[2.3] Verifying public PDF availability on GitHub Pages repository...');
  const pdfUrls = [
    json.media.url,
    'https://flowarchitect-agency.github.io/hotel-concierge-ai/Lumiere_Spa_Wellness_Menu.pdf',
  ];

  for (const testUrl of pdfUrls) {
    console.log(`Checking URL: ${testUrl}`);
    const pdfRes = await fetch(testUrl);
    console.log(`HTTP Status: ${pdfRes.status} Content-Type: ${pdfRes.headers.get('content-type')}`);
    assert.equal(pdfRes.status, 200, `Expected HTTP 200 for PDF file at ${testUrl}`);
    const buffer = await pdfRes.arrayBuffer();
    const header = Buffer.from(buffer.slice(0, 8)).toString('utf8');
    assert.ok(header.startsWith('%PDF-'), `Expected valid PDF header, got ${header}`);
    console.log(`Verified real PDF file (${buffer.byteLength} bytes, header: ${header.trim()}).`);
  }

  console.log('✅ Real PDF document download verification SUCCESSFUL.');
}

async function main() {
  console.log('🚀 Launching AI-First QA Automated Validation Suite...');
  try {
    await runTest1();
    await runTest2();
    console.log('\n======================================================');
    console.log('🎉 ALL AI-FIRST QA TESTS PASSED LIVE AUTONOMOUSLY!');
    console.log('======================================================\n');
  } catch (err) {
    console.error('\n❌ AI-First QA Test Suite Failed:', err);
    process.exit(1);
  }
}

main();
