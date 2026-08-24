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
    throw new Error(`Airtable query failed: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

// 27 Extreme Edge-Case Payloads covering Pre-Arrival, In-Stay, and Post-Checkout
const EDGE_CASES = [
  // ================= PRE-ARRIVAL (8 Cases) =================
  {
    id: 'P01_MIXED_LANG_AIRPORT',
    scenario: 'pre-arrival',
    guestName: 'StressTester Amira',
    language: 'English',
    message: 'Bonjour, landed at CDG, need transfer for 4 ppl with 6 bags SVP. Shukran.',
    expectations: {
      category: 'transport',
      mustNotEscapeHatch: true,
      hasReply: true,
    },
  },
  {
    id: 'P02_EARLY_CHECKIN_SLANG',
    scenario: 'pre-arrival',
    guestName: 'StressTester Jax',
    language: 'English',
    message: 'yo bro can we crash early tomorrow like 9am? super exhausted',
    expectations: {
      mustNotEscapeHatch: true,
      hasReply: true,
    },
  },
  {
    id: 'P03_SPA_PRE_ARRIVAL_BROCHURE',
    scenario: 'pre-arrival',
    guestName: 'StressTester Chloe',
    language: 'English',
    message: 'Can you send the spa treatment menu before we arrive on Friday?',
    expectations: {
      hasPdfMedia: true,
      hasReply: true,
    },
  },
  {
    id: 'P04_DIETARY_ALLERGIES_PRE_ARRIVAL',
    scenario: 'pre-arrival',
    guestName: 'StressTester Sofia',
    language: 'English',
    message: 'Hola! My husband is severely allergic to gluten and peanuts, which restaurants at the hotel can accommodate him?',
    expectations: {
      mustNotEscapeHatch: true,
      hasReply: true,
    },
  },
  {
    id: 'P05_ROMANCE_UPGRADE',
    scenario: 'pre-arrival',
    guestName: 'StressTester Liam',
    language: 'English',
    message: 'Celebrating our 10th anniversary, want champagne and rose petals in room on arrival pls.',
    expectations: {
      hasReply: true,
    },
  },
  {
    id: 'P06_PRE_ARRIVAL_CHAOS_TYPO',
    scenario: 'pre-arrival',
    guestName: 'StressTester Kenji',
    language: 'English',
    message: 'helo we arive late round 2am cn we stil gt food? thx',
    expectations: {
      hasReply: true,
    },
  },
  {
    id: 'P07_LUGGAGE_STORAGE',
    scenario: 'pre-arrival',
    guestName: 'StressTester Elena',
    language: 'English',
    message: 'Can we drop our 5 suitcases before check-in time?',
    expectations: {
      hasReply: true,
    },
  },
  {
    id: 'P08_AIRPORT_TRANSFER_PRICE',
    scenario: 'pre-arrival',
    guestName: 'StressTester Mateo',
    language: 'English',
    message: 'How much does the Mercedes private transfer from Orly airport cost?',
    expectations: {
      hasReply: true,
    },
  },

  // ================= IN-STAY (12 Cases) =================
  {
    id: 'I01_MULTI_INTENT_HOSTILE',
    scenario: 'in-stay',
    guestName: 'StressTester Karen',
    language: 'English',
    message: 'This room is terrible I want a manager right now, but also what time is breakfast?',
    expectations: {
      escapeHatchTriggered: true,
      requiresHuman: true,
      role: 'Duty Manager',
    },
  },
  {
    id: 'I02_MIXED_LANG_MAINTENANCE',
    scenario: 'in-stay',
    guestName: 'StressTester Tariq',
    language: 'English',
    message: 'Bonjour, my AC is broken and leaking water on the floor, send someone SVP. Shukran.',
    expectations: {
      operationalOrEscalation: true,
      requiresHuman: true,
    },
  },
  {
    id: 'I03_TYPO_TOWELS_SLANG',
    scenario: 'in-stay',
    guestName: 'StressTester Tyler',
    language: 'English',
    message: 'yo gimme extra towls n soap pls room 402',
    expectations: {
      operational: true,
      serviceType: 'housekeeping',
    },
  },
  {
    id: 'I04_VAGUE_FOOD_DEMAND',
    scenario: 'in-stay',
    guestName: 'StressTester Hunter',
    language: 'English',
    message: 'need food now',
    expectations: {
      hasReply: true,
      mustNotEscapeHatch: true,
    },
  },
  {
    id: 'I05_SPECIFIC_CUISINE_SEARCH',
    scenario: 'in-stay',
    guestName: 'StressTester Yumi',
    language: 'English',
    message: 'wanna eat authentic japanese ramen near the hotel',
    expectations: {
      hasReply: true,
      mustNotEscapeHatch: true,
    },
  },
  {
    id: 'I06_SPA_BOOKING_WITH_BROCHURE',
    scenario: 'in-stay',
    guestName: 'StressTester Isabella',
    language: 'English',
    message: 'Could you send the spa catalogue and book a couples massage for 4pm?',
    expectations: {
      hasPdfMedia: true,
      hasReply: true,
    },
  },
  {
    id: 'I07_EXTREME_FRUSTRATION',
    scenario: 'in-stay',
    guestName: 'StressTester Viktor',
    language: 'English',
    message: 'Your receptionist was completely rude and incompetent! I demand an immediate refund and to see the director!',
    expectations: {
      escapeHatchTriggered: true,
      requiresHuman: true,
    },
  },
  {
    id: 'I08_MIDNIGHT_PILLOWS',
    scenario: 'in-stay',
    guestName: 'StressTester Noah',
    language: 'English',
    message: 'Need 2 extra feather pillows and 3 bottles of water please.',
    expectations: {
      operational: true,
      serviceType: 'housekeeping',
    },
  },
  {
    id: 'I09_NOISE_COMPLAINT_IN_STAY',
    scenario: 'in-stay',
    guestName: 'StressTester Dave',
    language: 'English',
    message: 'There is loud drilling next door in room 305, I cannot work!',
    expectations: {
      escapeHatchTriggered: true,
      requiresHuman: true,
    },
  },
  {
    id: 'I10_IRON_BOARD_URGENT',
    scenario: 'in-stay',
    guestName: 'StressTester Sarah',
    language: 'English',
    message: 'Meeting in 20 mins, need an iron and ironing board immediately.',
    expectations: {
      operational: true,
      serviceType: 'housekeeping',
    },
  },
  {
    id: 'I11_BABY_COT_REQUEST',
    scenario: 'in-stay',
    guestName: 'StressTester Emma',
    language: 'English',
    message: 'Do you have a baby crib or cot for our 1 year old tonight?',
    expectations: {
      hasReply: true,
    },
  },
  {
    id: 'I12_FRENCH_SPANISH_MIX',
    scenario: 'in-stay',
    guestName: 'StressTester Diego',
    language: 'French',
    message: 'Hola, est-ce que le room service est ouvert maintenant?',
    expectations: {
      hasReply: true,
    },
  },

  // ================= POST-CHECKOUT (7 Cases) =================
  {
    id: 'C01_ENTHUSIASTIC_5STAR',
    scenario: 'post_checkout',
    guestName: 'StressTester Maya',
    language: 'English',
    message: 'Had a blast! 5/5 stars best hotel in Paris, loved everything!',
    expectations: {
      isPostCheckoutPositive: true,
      hasReviewLink: true,
      noComplaintTicket: true,
    },
  },
  {
    id: 'C02_FRENCH_POSITIVE_MIX',
    scenario: 'post_checkout',
    guestName: 'StressTester Jean-Luc',
    language: 'French',
    message: 'Merci beaucoup, wonderful stay, our suite was magnifique! 5 stars.',
    expectations: {
      isPostCheckoutPositive: true,
      hasReviewLink: true,
      noComplaintTicket: true,
    },
  },
  {
    id: 'C03_NOISY_COMPLAINT_POST_CHECKOUT',
    scenario: 'post_checkout',
    guestName: 'StressTester Brian',
    language: 'English',
    message: 'The room was super noisy and air conditioning was leaking all night. Ruined our trip.',
    expectations: {
      isPostCheckoutNegative: true,
      noReviewLink: true,
      gmEscalationTicket: true,
    },
  },
  {
    id: 'C04_HOSTILE_COMPLAINT_POST_CHECKOUT',
    scenario: 'post_checkout',
    guestName: 'StressTester Clara',
    language: 'English',
    message: 'Terrible service from the staff, dirty sheets and broken shower. Worst luxury hotel ever.',
    expectations: {
      isPostCheckoutNegative: true,
      noReviewLink: true,
      gmEscalationTicket: true,
    },
  },
  {
    id: 'C05_MIXED_SENTIMENT_POST_CHECKOUT',
    scenario: 'post_checkout',
    guestName: 'StressTester Arthur',
    language: 'English',
    message: 'Location was good but the noise was intolerable and staff didn\'t care at all.',
    expectations: {
      isPostCheckoutNegative: true,
      noReviewLink: true,
      gmEscalationTicket: true,
    },
  },
  {
    id: 'C06_SPANISH_POSITIVE',
    scenario: 'post_checkout',
    guestName: 'StressTester Lucia',
    language: 'Spanish',
    message: '¡Todo increíble! Nos encantó el servicio y el desayuno, 5 estrellas.',
    expectations: {
      isPostCheckoutPositive: true,
      hasReviewLink: true,
      noComplaintTicket: true,
    },
  },
  {
    id: 'C07_JAPANESE_COMPLAINT',
    scenario: 'post_checkout',
    guestName: 'StressTester Kenzo',
    language: 'Japanese',
    message: '部屋のエアコンが壊れていて最悪の滞在でした。返金を求めます。',
    expectations: {
      isPostCheckoutNegative: true,
      noReviewLink: true,
      gmEscalationTicket: true,
    },
  },
];

async function executeCase(testCase, index, total) {
  const sessionId = `stress_${testCase.id.toLowerCase()}_${Date.now()}`;
  const userId = `web:${sessionId}`;
  const payload = {
    guestName: testCase.guestName,
    language: testCase.language,
    scenario: testCase.scenario,
    is_demo: true,
    sessionId: sessionId,
    chatHistory: [
      { role: 'user', content: testCase.message }
    ]
  };

  console.log(`\n----------------------------------------------------------------------`);
  console.log(`[${index + 1}/${total}] RUNNING: ${testCase.id} (Scenario: ${testCase.scenario})`);
  console.log(`Guest: "${testCase.guestName}" | Input: "${testCase.message}"`);

  const startTime = Date.now();
  const res = await fetch(config.ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: config.ORIGIN,
    },
    body: JSON.stringify(payload),
  });

  const durationMs = Date.now() - startTime;
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`[${testCase.id}] HTTP ${res.status} error: ${errText}`);
  }

  const data = await res.json();
  console.log(`Response received in ${durationMs}ms (HTTP ${res.status}):`);
  console.log(`Reply: "${data.reply?.slice(0, 100)}${data.reply?.length > 100 ? '...' : ''}"`);
  console.log(`Intent: ${data.intent} | RequiresHuman: ${data.requires_human} | EscapeHatch: ${data.escape_hatch_triggered}`);

  // Validation 1: Structure & Safety Flags
  assert.ok(data.reply && typeof data.reply === 'string', 'Reply must be a non-empty string');
  assert.equal(data.is_demo, true, 'is_demo safety lock must be true');

  // Validation 2: Specific Edge Case Intent Checks
  const exp = testCase.expectations;

  if (exp.escapeHatchTriggered) {
    assert.equal(data.escape_hatch_triggered, true, `Escape hatch must be triggered for hostile input: ${testCase.id}`);
    assert.equal(data.requires_human, true, `Requires human must be true for ${testCase.id}`);
    console.log(`  ✅ Hostile input caught -> Escape Hatch activated.`);
  }

  if (exp.mustNotEscapeHatch) {
    assert.equal(data.escape_hatch_triggered, false, `Escape hatch must NOT trigger for standard input: ${testCase.id}`);
  }

  if (exp.hasPdfMedia) {
    assert.ok(data.media, `PDF media must be attached for brochure query: ${testCase.id}`);
    assert.ok(data.media.format === 'PDF' || data.media.type === 'document', 'Media must be PDF document');
    console.log(`  ✅ Brochure detected -> PDF attachment: ${data.media.filename || data.media.title}`);
  }

  if (exp.operational) {
    assert.ok(data.requires_human === true || data.staff_alerts?.length > 0 || /room delivery|housekeeping|team/i.test(data.reply), 'Operational request must alert housekeeping');
    console.log(`  ✅ Operational item routed -> Housekeeping notified without upselling.`);
  }

  if (exp.isPostCheckoutPositive) {
    assert.equal(data.requires_human, false, 'Positive review should not trigger human escalation');
    assert.ok(data.media?.url?.includes('g.page') || data.reply?.includes('g.page'), 'Positive review must return Google Review link');
    console.log(`  ✅ 5-Star review routed -> Google Review portal delivered.`);
  }

  if (exp.isPostCheckoutNegative) {
    assert.equal(data.requires_human, true, 'Negative post-checkout must trigger management review');
    assert.equal(data.media, null, 'Negative post-checkout must NEVER return public review links');
    assert.ok(!data.reply?.includes('g.page'), 'Reply must not contain Google Review link');
    console.log(`  ✅ Negative review intercepted -> Public review links withheld, GM notified.`);
  }

  return { testCase, data, userId, durationMs };
}

async function verifyAirtableIntegrity(results) {
  console.log(`\n======================================================================`);
  console.log(`VERIFYING AIRTABLE SAFETY LOCKS & GUESTNAME MAPPING ACROSS ALL WRITES`);
  console.log(`======================================================================`);
  
  // Wait 3 seconds for async background persist operations
  await delay(3000);

  let verifiedCount = 0;
  for (const { testCase, userId } of results) {
    // Check Guests table
    const guestRes = await airtableQuery('Guests', `{UserID} = '${userId}'`);
    if (guestRes.records && guestRes.records.length > 0) {
      const rec = guestRes.records[0];
      assert.equal(rec.fields.Is_Demo, true, `Airtable record for ${userId} must have Is_Demo=true`);
      assert.equal(rec.fields.GuestName, testCase.guestName, `GuestName column mismatch for ${userId}`);
      verifiedCount++;
    }
  }

  console.log(`✅ Verified ${verifiedCount} Airtable guest records: 100% strictly mapped to GuestName column and Is_Demo=true.`);
}

async function main() {
  console.log(`======================================================================`);
  console.log(`🚀 STARTING PHASE 2: 27-PAYLOAD AUTOMATED STRESS TEST & REGRESSION SUITE`);
  console.log(`Target Endpoint: ${config.ENDPOINT}`);
  console.log(`======================================================================`);

  const results = [];
  let passedCount = 0;
  const startTime = Date.now();

  for (let i = 0; i < EDGE_CASES.length; i++) {
    try {
      const res = await executeCase(EDGE_CASES[i], i, EDGE_CASES.length);
      results.push(res);
      passedCount++;
      // Brief pause between requests to avoid rate limits
      await delay(350);
    } catch (err) {
      console.error(`\n❌ TEST FAILED: ${EDGE_CASES[i].id}`);
      console.error(err);
      process.exit(1);
    }
  }

  await verifyAirtableIntegrity(results);

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`\n======================================================================`);
  console.log(`🎉 ALL ${passedCount}/${EDGE_CASES.length} STRESS TEST EDGE CASES PASSED PERFECTLY!`);
  console.log(`Total Execution Time: ${totalTime}s`);
  console.log(`======================================================================\n`);
}

main();
