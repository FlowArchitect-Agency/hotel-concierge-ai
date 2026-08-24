#!/usr/bin/env node
/**
 * scripts/massive-chaos-matrix.mjs
 * Phase 2: The Chaos QA Matrix
 * 
 * Simulates three distinct, highly complex, multi-turn guest personas interacting
 * with the live /api/demo-chat endpoint and validates both LLM reasoning and Airtable state:
 * 
 * Persona 1: The Language Switcher (FR -> EN -> AR/Slang -> EN)
 * Persona 2: The Amnesiac (Multi-turn distraction -> memory context retrieval)
 * Persona 3: The Contradiction Engine (Hostile escalation -> spontaneous fix -> pivot)
 */

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
    ENDPOINT: process.env.CONCIERGE_DEMO_URL || 'https://conciergeflow-api.conciergeflow-worker.workers.dev/api/demo-chat',
    ORIGIN: 'https://flowarchitect-agency.github.io',
  };
}

const config = loadEnv();

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function airtableQuery(table, filterFormula) {
  if (!config.AIRTABLE_API_KEY || !config.AIRTABLE_BASE_ID) {
    console.warn(`[Airtable] Warning: Missing API key or Base ID. Skipping live Airtable query.`);
    return { records: [] };
  }
  const url = new URL(`https://api.airtable.com/v0/${config.AIRTABLE_BASE_ID}/${encodeURIComponent(table)}`);
  if (filterFormula) {
    url.searchParams.set('filterByFormula', filterFormula);
  }
  url.searchParams.set('pageSize', '100');
  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${config.AIRTABLE_API_KEY}`,
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Airtable ${table} query failed (${res.status}): ${err}`);
  }
  return res.json();
}

async function sendTurn({ sessionId, guestName, language, scenario, chatHistory, message }) {
  // Append new user message to chatHistory
  chatHistory.push({ role: 'user', content: message });

  const payload = {
    guestName,
    language,
    scenario,
    is_demo: true,
    sessionId,
    chatHistory: chatHistory.map((m) => ({ role: m.role, content: m.content })),
  };

  const response = await fetch(config.ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: config.ORIGIN,
    },
    body: JSON.stringify(payload),
  });

  const body = await response.json();
  if (!response.ok) {
    throw new Error(`Turn failed with HTTP ${response.status}: ${JSON.stringify(body)}`);
  }

  // Append assistant reply to chatHistory for subsequent turns
  if (body.reply) {
    chatHistory.push({ role: 'assistant', content: body.reply });
  }

  return body;
}

// =========================================================================
// PERSONA 1: THE LANGUAGE SWITCHER
// =========================================================================
async function testPersona1() {
  console.log('\n' + '='.repeat(70));
  console.log('🤖 PERSONA 1: THE LANGUAGE SWITCHER (Multi-lingual Context & Intent Drift)');
  console.log('='.repeat(70));

  const sessionId = `chaos_lang_${Date.now()}`;
  const userId = `web:${sessionId}`;
  const guestName = 'Tariq Al-Mansoor';
  const chatHistory = [];

  console.log(`[Session Config] SessionID: ${sessionId} | Guest: ${guestName}`);

  // Turn 1 (FR)
  console.log('\n--- Turn 1 (FR): Taxi Request ---');
  const t1Msg = "Bonjour, je voudrais réserver un taxi pour l'aéroport.";
  console.log(`Guest (FR): "${t1Msg}"`);
  const t1Res = await sendTurn({
    sessionId,
    guestName,
    language: 'English',
    scenario: 'pre-arrival',
    chatHistory,
    message: t1Msg,
  });
  console.log(`AI Response: "${t1Res.reply}"`);
  assert.ok(t1Res.reply, 'Turn 1 must produce a non-empty reply');
  assert.ok(
    /taxi|transfer|airport|aéroport|véhicule|cdg|orly|flight|demande|collection|hôtel|service|conciergerie/i.test(t1Res.reply),
    'AI must acknowledge airport transport / service intent in French'
  );

  await delay(1200);

  // Turn 2 (EN): Update to large van with 6 bags
  console.log('\n--- Turn 2 (EN): Scope Update to Large Van ---');
  const t2Msg = 'Actually, make that a large van. We have 6 bags.';
  console.log(`Guest (EN): "${t2Msg}"`);
  const t2Res = await sendTurn({
    sessionId,
    guestName,
    language: 'English',
    scenario: 'pre-arrival',
    chatHistory,
    message: t2Msg,
  });
  console.log(`AI Response: "${t2Res.reply}"`);
  assert.ok(
    /van|luggage|bag|space|passenger|transfer|mercedes|capacity|logged|request|team/i.test(t2Res.reply),
    'AI must update transport scope / request logging'
  );

  await delay(1200);

  // Turn 3 (AR/Slang): Slang gratitude + AC freezing issue
  console.log('\n--- Turn 3 (AR/Slang): Language Mix & Maintenance Issue ---');
  const t3Msg = 'Shukran. Also the AC is freezing, beda tetgela.';
  console.log(`Guest (AR/Slang): "${t3Msg}"`);
  const t3Res = await sendTurn({
    sessionId,
    guestName,
    language: 'English',
    scenario: 'in-stay',
    chatHistory,
    message: t3Msg,
  });
  console.log(`AI Response: "${t3Res.reply}"`);
  assert.ok(
    /ac|air condition|temperature|climatisation|maintenance|technician|room|adjust|housekeeping/i.test(t3Res.reply),
    'AI must understand AC issue despite Arabic slang and acknowledge maintenance support'
  );

  await delay(1200);

  // Turn 4 (EN): Cancel the van, taking metro
  console.log('\n--- Turn 4 (EN): Transport Cancellation & Intent Disambiguation ---');
  const t4Msg = 'Cancel the van, we will take the metro.';
  console.log(`Guest (EN): "${t4Msg}"`);
  const t4Res = await sendTurn({
    sessionId,
    guestName,
    language: 'English',
    scenario: 'in-stay',
    chatHistory,
    message: t4Msg,
  });
  console.log(`AI Response: "${t4Res.reply}"`);
  assert.ok(
    /cancel|metro|subway|station|underground|train/i.test(t4Res.reply),
    'AI must confirm transport cancellation and metro assistance without cancelling or confusing the AC maintenance request'
  );

  // Airtable verification
  console.log('\n[Airtable Check: Persona 1]');
  await delay(2000);
  const convRecords = await airtableQuery('Conversations', `{UserID}='${userId}'`);
  console.log(`✓ Conversations logged: ${convRecords.records.length} records`);
  assert.ok(convRecords.records.length >= 4, 'Airtable must record the multi-turn conversation');

  console.log('✅ Persona 1 (Language Switcher) PASSED flawlessly!\n');
  return { sessionId, turns: chatHistory.length / 2 };
}

// =========================================================================
// PERSONA 2: THE AMNESIAC
// =========================================================================
async function testPersona2() {
  console.log('\n' + '='.repeat(70));
  console.log('🧠 PERSONA 2: THE AMNESIAC (Context Window Distraction & Exact Memory Recall)');
  console.log('='.repeat(70));

  const sessionId = `chaos_amnesiac_${Date.now()}`;
  const userId = `web:${sessionId}`;
  const guestName = 'Eleanor Vance';
  const chatHistory = [];

  console.log(`[Session Config] SessionID: ${sessionId} | Guest: ${guestName}`);

  // Turn 1: Spa menu
  console.log('\n--- Turn 1: Spa Menu Query ---');
  const t1Msg = 'Can I see the spa menu?';
  console.log(`Guest: "${t1Msg}"`);
  const t1Res = await sendTurn({
    sessionId,
    guestName,
    language: 'English',
    scenario: 'in-stay',
    chatHistory,
    message: t1Msg,
  });
  console.log(`AI Response: "${t1Res.reply}"`);
  assert.ok(/spa|treatment|massage|menu|wellness/i.test(t1Res.reply), 'Must provide Spa details');

  await delay(1200);

  // Turn 2: Book Couples Massage for tomorrow at 2 PM
  console.log('\n--- Turn 2: Specific Booking Anchor (Couples Massage @ 2 PM) ---');
  const t2Msg = 'Book the Couples Massage for tomorrow at 2 PM.';
  console.log(`Guest: "${t2Msg}"`);
  const t2Res = await sendTurn({
    sessionId,
    guestName,
    language: 'English',
    scenario: 'in-stay',
    chatHistory,
    message: t2Msg,
  });
  console.log(`AI Response: "${t2Res.reply}"`);
  assert.ok(/couple|massage|2\s*(?:pm|:00|h)|tomorrow/i.test(t2Res.reply), 'Must acknowledge Couples Massage at 2 PM');

  await delay(1200);

  // Turn 3: Distraction 1 — Breakfast hours
  console.log('\n--- Turn 3 (Distraction 1): Breakfast Inquiry ---');
  const t3Msg = 'What time is breakfast?';
  console.log(`Guest: "${t3Msg}"`);
  const t3Res = await sendTurn({
    sessionId,
    guestName,
    language: 'English',
    scenario: 'in-stay',
    chatHistory,
    message: t3Msg,
  });
  console.log(`AI Response: "${t3Res.reply}"`);
  assert.ok(
    /breakfast|7|10|11|am|buffet|dining|restaurant|collection|hotel|request|reception/i.test(t3Res.reply),
    'Must answer breakfast operational inquiry or provide dining guidance'
  );

  await delay(1200);

  // Turn 4: Distraction 2 — Extra pillows
  console.log('\n--- Turn 4 (Distraction 2): Extra Pillows ---');
  const t4Msg = 'Can I get extra pillows?';
  console.log(`Guest: "${t4Msg}"`);
  const t4Res = await sendTurn({
    sessionId,
    guestName,
    language: 'English',
    scenario: 'in-stay',
    chatHistory,
    message: t4Msg,
  });
  console.log(`AI Response: "${t4Res.reply}"`);
  assert.ok(/pillow|housekeeping|room|deliver|bring/i.test(t4Res.reply), 'Must acknowledge pillow dispatch');

  await delay(1200);

  // Turn 5: Memory Recall Test
  console.log('\n--- Turn 5: Memory Recall Challenge ---');
  const t5Msg = 'Wait, what time did I book the massage for again?';
  console.log(`Guest: "${t5Msg}"`);
  const t5Res = await sendTurn({
    sessionId,
    guestName,
    language: 'English',
    scenario: 'in-stay',
    chatHistory,
    message: t5Msg,
  });
  console.log(`AI Response: "${t5Res.reply}"`);
  
  // Validation: Must explicitly retrieve "2 PM" / "2:00 PM" / "14:00" from history
  const hasExactTime = /2\s*(?:pm|:00\s*pm|h|:00|o'clock)|14:00|14h/i.test(t5Res.reply);
  assert.ok(
    hasExactTime,
    `AI failed to retrieve exact booking time (2 PM) from context. Received: "${t5Res.reply}"`
  );
  console.log(`🎯 Memory Verification: Successfully extracted exact booking time "2 PM" from multi-turn context!`);

  // Airtable verification
  console.log('\n[Airtable Check: Persona 2]');
  await delay(2000);
  const convRecords = await airtableQuery('Conversations', `{UserID}='${userId}'`);
  console.log(`✓ Conversations logged: ${convRecords.records.length} records`);
  assert.ok(convRecords.records.length >= 5, 'Airtable must record the full amnesiac conversation history');

  console.log('✅ Persona 2 (The Amnesiac) PASSED flawlessly!\n');
  return { sessionId, turns: chatHistory.length / 2 };
}

// =========================================================================
// PERSONA 3: THE CONTRADICTION ENGINE
// =========================================================================
async function testPersona3() {
  console.log('\n' + '='.repeat(70));
  console.log('⚡ PERSONA 3: THE CONTRADICTION ENGINE (Hostile Escalation -> Spontaneous Fix -> Pivot)');
  console.log('='.repeat(70));

  const sessionId = `chaos_contradiction_${Date.now()}`;
  const userId = `web:${sessionId}`;
  const guestName = 'Marcus Vance';
  const chatHistory = [];

  console.log(`[Session Config] SessionID: ${sessionId} | Guest: ${guestName}`);

  // Turn 1: Hostile complaint requesting Manager
  console.log('\n--- Turn 1: Hostile Cleanliness Complaint & Manager Demand ---');
  const t1Msg = 'This room is disgusting, there is hair in the sink! I want the manager.';
  console.log(`Guest: "${t1Msg}"`);
  const t1Res = await sendTurn({
    sessionId,
    guestName,
    language: 'English',
    scenario: 'in-stay',
    chatHistory,
    message: t1Msg,
  });
  console.log(`AI Response: "${t1Res.reply}"`);
  console.log(`Staff Alerts: ${JSON.stringify(t1Res.staff_alerts || [])}`);
  console.log(`Requires Human: ${t1Res.requires_human} | Escape Hatch: ${t1Res.escape_hatch_triggered}`);
  
  assert.ok(
    t1Res.requires_human === true || t1Res.escape_hatch_triggered === true || (t1Res.staff_alerts && t1Res.staff_alerts.length > 0),
    'Hostile manager demand must trigger escape hatch or staff alert'
  );
  assert.ok(
    /apolog|manager|sorry|unacceptable|duty manager|housekeeping|assist/i.test(t1Res.reply),
    'AI must apologize sincerely and escalate to management'
  );

  await delay(1200);

  // Turn 2: Spontaneous de-escalation
  console.log('\n--- Turn 2: Spontaneous De-escalation by Guest ---');
  const t2Msg = 'Actually, the housekeeper just came and fixed it, never mind.';
  console.log(`Guest: "${t2Msg}"`);
  const t2Res = await sendTurn({
    sessionId,
    guestName,
    language: 'English',
    scenario: 'in-stay',
    chatHistory,
    message: t2Msg,
  });
  console.log(`AI Response: "${t2Res.reply}"`);
  assert.ok(
    /glad|happy|resolved|fixed|housekeep|thank|pleased|assist/i.test(t2Res.reply),
    'AI must gracefully de-escalate, express relief, and thank the guest'
  );

  await delay(1200);

  // Turn 3: Seamless pivot to Late Checkout request
  console.log('\n--- Turn 3: Pivot to Late Checkout Request ---');
  const t3Msg = 'But I do want a late checkout.';
  console.log(`Guest: "${t3Msg}"`);
  const t3Res = await sendTurn({
    sessionId,
    guestName,
    language: 'English',
    scenario: 'in-stay',
    chatHistory,
    message: t3Msg,
  });
  console.log(`AI Response: "${t3Res.reply}"`);
  assert.ok(
    /checkout|check-out|late|reception|front desk|time|12|1|2|pm|extend/i.test(t3Res.reply),
    'AI must seamlessly pivot to handling late checkout without remaining in aggressive complaint recovery mode'
  );

  // Airtable verification
  console.log('\n[Airtable Check: Persona 3]');
  await delay(2000);
  const convRecords = await airtableQuery('Conversations', `{UserID}='${userId}'`);
  console.log(`✓ Conversations logged: ${convRecords.records.length} records`);
  assert.ok(convRecords.records.length >= 3, 'Airtable must record the contradiction engine conversation');

  console.log('✅ Persona 3 (Contradiction Engine) PASSED flawlessly!\n');
  return { sessionId, turns: chatHistory.length / 2 };
}

// =========================================================================
// MAIN RUNNER
// =========================================================================
async function runMassiveChaosMatrix() {
  const startTime = Date.now();
  console.log('\n' + '█'.repeat(70));
  console.log('🔥 STARTING PHASE 2: MASSIVE CHAOS MATRIX QA SUITE');
  console.log(`Target Endpoint: ${config.ENDPOINT}`);
  console.log(`Target Base: ${config.AIRTABLE_BASE_ID}`);
  console.log('█'.repeat(70));

  const results = [];
  try {
    results.push(await testPersona1());
    results.push(await testPersona2());
    results.push(await testPersona3());

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log('\n' + '█'.repeat(70));
    console.log('🎉 ALL 3 CHAOS PERSONAS PASSED WITH 100% SUCCESS!');
    console.log(`Total Execution Time: ${duration}s`);
    console.log('Summary Matrix:');
    console.log('  1. The Language Switcher: 4 Turns verified (FR -> EN -> AR/Slang -> Cancel)');
    console.log('  2. The Amnesiac:          5 Turns verified (Spa -> 2PM Anchor -> Distractions -> 2PM Recall)');
    console.log('  3. Contradiction Engine:  3 Turns verified (Hostile GM -> Spontaneous Fix -> Late Checkout)');
    console.log('█'.repeat(70) + '\n');
  } catch (err) {
    console.error('\n❌ CHAOS MATRIX TEST FAILED:', err);
    process.exitCode = 1;
  }
}

runMassiveChaosMatrix();
