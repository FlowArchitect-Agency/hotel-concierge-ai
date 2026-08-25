#!/usr/bin/env node
/**
 * scripts/upsell-sensitivity-test.mjs
 * 
 * Tests LLM upsell sensitivity, restraint, and conversational tone for neutral/low-intent guests:
 * 
 * Persona 1: The Local Explorer (3 Turns)
 * Turn 1: 'Can you recommend a good local bakery or cafe nearby? I don't want to eat at the hotel.'
 * Turn 2: 'Thanks. What is the weather going to be like this afternoon?'
 * Turn 3: 'Great, I will just be walking around the neighborhood.'
 * 
 * Persona 2: The Just-Browsing Guest (2 Turns)
 * Turn 1: 'What is there to do around the hotel?'
 * Turn 2: 'Ah okay. No, I don't want to book any private tours or chauffeurs, just going to explore on my own.'
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

async function sendTurn({ sessionId, guestName, language, scenario, chatHistory, message }) {
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

  if (body.reply) {
    chatHistory.push({ role: 'assistant', content: body.reply });
  }

  return body;
}

// =========================================================================
// PERSONA 1: THE LOCAL EXPLORER
// =========================================================================
async function testPersona1() {
  console.log('\n' + '='.repeat(70));
  console.log('🥐 PERSONA 1: THE LOCAL EXPLORER (Local Recommendations & No Hotel Restaurant Force)');
  console.log('='.repeat(70));

  const sessionId = `upsell_local_${Date.now()}`;
  const guestName = 'Claire Dumont';
  const chatHistory = [];

  // Turn 1
  console.log('\n--- Turn 1: Bakery / Cafe Request (Explicitly Not Hotel) ---');
  const t1Msg = "Can you recommend a good local bakery or cafe nearby? I don't want to eat at the hotel.";
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
  console.log(`Requires Human: ${t1Res.requires_human} | Is Upsell: ${JSON.stringify(t1Res.requests)}`);

  // Turn 2
  await delay(1200);
  console.log('\n--- Turn 2: Weather Question ---');
  const t2Msg = 'Thanks. What is the weather going to be like this afternoon?';
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

  // Turn 3
  await delay(1200);
  console.log('\n--- Turn 3: Just Walking Around ---');
  const t3Msg = 'Great, I will just be walking around the neighborhood.';
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

  return { sessionId, t1: t1Res, t2: t2Res, t3: t3Res };
}

// =========================================================================
// PERSONA 2: THE JUST-BROWSING GUEST
// =========================================================================
async function testPersona2() {
  console.log('\n' + '='.repeat(70));
  console.log('🚶 PERSONA 2: THE JUST-BROWSING GUEST (Polite Refusal & Graceful De-escalation)');
  console.log('='.repeat(70));

  const sessionId = `upsell_browsing_${Date.now()}`;
  const guestName = 'Arthur Pendelton';
  const chatHistory = [];

  // Turn 1
  console.log('\n--- Turn 1: General Inquiry on Neighborhood ---');
  const t1Msg = 'What is there to do around the hotel?';
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

  // Turn 2
  await delay(1200);
  console.log('\n--- Turn 2: Explicit Refusal of Paid Services ---');
  const t2Msg = "Ah okay. No, I don't want to book any private tours or chauffeurs, just going to explore on my own.";
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

  return { sessionId, t1: t1Res, t2: t2Res };
}

// =========================================================================
// MAIN RUNNER
// =========================================================================
async function runUpsellSensitivitySuite() {
  console.log('\n' + '█'.repeat(70));
  console.log('🧪 RUNNING UPSELL SENSITIVITY & CONVERSATIONAL TONE SUITE');
  console.log(`Target Endpoint: ${config.ENDPOINT}`);
  console.log('█'.repeat(70));

  try {
    const p1 = await testPersona1();
    const p2 = await testPersona2();

    console.log('\n' + '█'.repeat(70));
    console.log('📊 UPSELL SENSITIVITY EVALUATION COMPLETE');
    console.log('█'.repeat(70));
  } catch (err) {
    console.error('\n❌ UPSELL SENSITIVITY TEST FAILED:', err);
    process.exitCode = 1;
  }
}

runUpsellSensitivitySuite();
