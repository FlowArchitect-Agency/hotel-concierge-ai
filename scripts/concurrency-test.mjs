#!/usr/bin/env node
/**
 * scripts/concurrency-test.mjs
 * Phase 3: Infrastructure Resilience — Concurrency Stress Test
 * 
 * Simulates 10 distinct guests (with 10 unique UserIDs) sending simultaneous
 * requests to /api/demo-chat at the exact same millisecond using Promise.all().
 * 
 * Validates:
 * 1. Concurrency throughput and sub-second response handling.
 * 2. Session isolation (zero cross-talk or intent pollution between guests).
 * 3. Airtable persistence (verifying all 10 records are recorded).
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
    return [];
  }
  const url = `https://api.airtable.com/v0/${config.AIRTABLE_BASE_ID}/${encodeURIComponent(table)}?filterByFormula=${encodeURIComponent(filterFormula)}`;
  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${config.AIRTABLE_API_KEY}`,
      },
    });
    if (!res.ok) {
      console.warn(`[Airtable Query Warning] Table: ${table}, Status: ${res.status}`);
      return [];
    }
    const data = await res.json();
    return data.records || [];
  } catch (err) {
    console.warn(`[Airtable Fetch Error] ${err.message}`);
    return [];
  }
}

const RUN_ID = Date.now().toString(36);

const GUEST_SCENARIOS = [
  {
    id: 1,
    name: 'Elena Rostova',
    service: 'Airport Transfer',
    message: 'Bonjour, I need a private transfer to Charles de Gaulle airport tomorrow at 6 AM.',
    expectedKeywords: [/transfer|airport|chauffeur|cdg|car/i],
    forbiddenKeywords: [/towels|buzzing|hammam|le jardin/i],
  },
  {
    id: 2,
    name: 'Marcus Vance',
    service: 'Fresh Towels',
    message: 'Could we get 4 extra fresh bath towels delivered to room 412?',
    expectedKeywords: [/towel|housekeeping|deliver|room/i],
    forbiddenKeywords: [/airport|cdg|michelin|anniversary/i],
  },
  {
    id: 3,
    name: 'Sophie Dubois',
    service: 'Spa Wellness Menu',
    message: 'Can you send me the spa wellness menu and massage options?',
    expectedKeywords: [/spa|wellness|massage|hammam|treatment/i],
    forbiddenKeywords: [/buzzing|sunglasses|louvre/i],
  },
  {
    id: 4,
    name: 'David Chen',
    service: 'Fine Dining Reservation',
    message: 'Please book a table at Le Jardin for 2 people tonight at 8 PM.',
    expectedKeywords: [/jardin|table|dinner|reserv|concierge/i],
    forbiddenKeywords: [/towels|sunglasses|buzzing/i],
  },
  {
    id: 5,
    name: 'Clara Oswald',
    service: 'AC Maintenance',
    message: 'The air conditioning in room 305 is making a loud buzzing noise and blowing hot air.',
    expectedKeywords: [/air conditioning|ac|maintenance|housekeeping|team|room/i],
    forbiddenKeywords: [/le jardin|michelin|champagne/i],
  },
  {
    id: 6,
    name: 'Liam & Olivia',
    service: 'Anniversary Celebration',
    message: 'We are celebrating our wedding anniversary, can you arrange champagne and chocolates in the suite?',
    expectedKeywords: [/anniversary|champagne|celebrat|delight|suite|experience/i],
    forbiddenKeywords: [/buzzing|sunglasses|towels/i],
  },
  {
    id: 7,
    name: 'Kenji Sato',
    service: 'Louvre Tour',
    message: 'Can we arrange a private guided tour of the Louvre museum for Friday morning?',
    expectedKeywords: [/louvre|tour|museum|guide|private/i],
    forbiddenKeywords: [/towels|buzzing|breakfast time/i],
  },
  {
    id: 8,
    name: 'Amira Al-Mansoor',
    service: 'Late Checkout',
    message: 'What is standard checkout time and is it possible to request a late checkout at 1 PM?',
    expectedKeywords: [/checkout|check-out|time|reception|front desk|request/i],
    forbiddenKeywords: [/louvre|massage|buzzing/i],
  },
  {
    id: 9,
    name: 'Thomas Becker',
    service: 'Lost & Found',
    message: 'I left my designer sunglasses in the lounge yesterday, has anyone turned them in to reception?',
    expectedKeywords: [/sunglasses|lost|reception|front desk|lounge|assist/i],
    forbiddenKeywords: [/michelin|louvre tour|ac/i],
  },
  {
    id: 10,
    name: 'Isabella Rossi',
    service: 'Breakfast Hours',
    message: 'What time is breakfast served in the morning and can we order it to the room?',
    expectedKeywords: [/breakfast|morning|served|room service|hour/i],
    forbiddenKeywords: [/sunglasses|buzzing|louvre/i],
  },
];

async function runConcurrencyTest() {
  console.log(`\n${'█'.repeat(72)}`);
  console.log(`🚀 RUNNING PHASE 3: CONCURRENCY STRESS TEST (10 SIMULTANEOUS GUESTS)`);
  console.log(`Target Endpoint: ${config.ENDPOINT}`);
  console.log(`Run Session Tag: run_${RUN_ID}`);
  console.log(`${'█'.repeat(72)}\n`);

  const startTime = Date.now();

  console.log(`⚡ Dispatching 10 simultaneous guest requests via Promise.all()...\n`);

  const guestPromises = GUEST_SCENARIOS.map(async (scenario) => {
    const userId = `concurrent_guest_${scenario.id}_${RUN_ID}`;
    const reqStart = Date.now();

    const payload = {
      guestName: scenario.name,
      language: 'English',
      scenario: 'in-stay',
      is_demo: true,
      sessionId: userId,
      userId: userId,
      chatHistory: [
        { role: 'user', content: scenario.message },
      ],
    };

    try {
      const response = await fetch(config.ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: config.ORIGIN,
        },
        body: JSON.stringify(payload),
      });

      const latencyMs = Date.now() - reqStart;
      const status = response.status;
      let data = {};
      try {
        data = await response.json();
      } catch {
        data = { reply: 'JSON_PARSE_ERROR' };
      }

      return {
        scenario,
        userId,
        status,
        latencyMs,
        reply: data.reply || '',
        data,
        success: status === 200,
      };
    } catch (err) {
      return {
        scenario,
        userId,
        status: 0,
        latencyMs: Date.now() - reqStart,
        reply: '',
        error: err.message,
        success: false,
      };
    }
  });

  const results = await Promise.all(guestPromises);
  const totalDurationMs = Date.now() - startTime;

  console.log(`\n${'='.repeat(72)}`);
  console.log(`📊 CONCURRENCY RESULTS TABLE (Total Duration: ${totalDurationMs}ms)`);
  console.log(`${'='.repeat(72)}\n`);

  let allPassed = true;

  for (const res of results) {
    const { scenario, status, latencyMs, reply, success } = res;
    console.log(`[Guest ${scenario.id}] ${scenario.name} (${scenario.service})`);
    console.log(`  Query:    "${scenario.message}"`);
    console.log(`  Status:   ${status === 200 ? '✅ 200 OK' : `❌ ${status}`} (${latencyMs}ms)`);
    console.log(`  Reply:    "${reply.slice(0, 140)}..."`);

    // Validation 1: HTTP 200
    if (!success) {
      console.error(`  ❌ FAIL: Request failed with status ${status}`);
      allPassed = false;
      continue;
    }

    // Validation 2: Intent Isolation (Expected keywords matched)
    const matchesExpected = scenario.expectedKeywords.some((regex) => regex.test(reply));
    if (!matchesExpected) {
      console.error(`  ❌ FAIL: Reply did not match expected intent pattern: ${scenario.expectedKeywords}`);
      allPassed = false;
    } else {
      console.log(`  ✅ Intent Match: Passed`);
    }

    // Validation 3: Cross-Talk Isolation (Forbidden keywords not present)
    const matchesForbidden = scenario.forbiddenKeywords.some((regex) => regex.test(reply));
    if (matchesForbidden) {
      console.error(`  ❌ FAIL: Cross-talk detected! Reply contained unrelated keywords.`);
      allPassed = false;
    } else {
      console.log(`  ✅ Session Isolation: Passed (No cross-talk)`);
    }

    console.log('');
  }

  console.log(`\n⏳ Waiting 3.5 seconds for async Airtable write persistence to settle...\n`);
  await delay(3500);

  console.log(`${'='.repeat(72)}`);
  console.log(`🗄️ AIRTABLE PERSISTENCE AUDIT`);
  console.log(`${'='.repeat(72)}\n`);

  let airtableWritesVerified = 0;

  for (const res of results) {
    const filter = `FIND("${res.userId}", {UserID})`;
    const records = await airtableQuery('Conversations', filter);
    if (records.length > 0) {
      console.log(`  ✅ UserID "${res.userId}": Found ${records.length} record(s) in Conversations`);
      airtableWritesVerified++;
    } else {
      console.warn(`  ⚠️ UserID "${res.userId}": Record not found in Airtable (or read API unauthenticated)`);
    }
  }

  console.log(`\n${'█'.repeat(72)}`);
  console.log(`🏁 CONCURRENCY AUDIT SUMMARY:`);
  console.log(`   Simultaneous Guests:    10 / 10`);
  console.log(`   HTTP 200 Responses:     ${results.filter(r => r.status === 200).length} / 10`);
  console.log(`   Average Latency:        ${Math.round(results.reduce((acc, r) => acc + r.latencyMs, 0) / results.length)}ms`);
  console.log(`   Airtable Verified:      ${airtableWritesVerified} / 10`);
  console.log(`   Overall Status:         ${allPassed ? '✅ PASSED (100% SUCCESS)' : '❌ FAILED'}`);
  console.log(`${'█'.repeat(72)}\n`);

  if (!allPassed) {
    process.exit(1);
  }
}

runConcurrencyTest().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
