/**
 * Deterministic transcript evaluation for conversational routing. This keeps
 * the production Worker in read_only mode, stubs every network dependency,
 * and carries the complete visible chat history from turn to turn.
 */
import assert from 'node:assert/strict';
import worker from '../src/index.js';

const origin = 'https://flowarchitect-agency.github.io';
const env = {
  GROQ_API_KEY: 'test',
  AIRTABLE_API_KEY: 'test',
  AIRTABLE_BASE_ID: 'test',
  SCRAPINGBEE_API_KEY: 'test',
  HOTEL_NAME: 'Hôtel Lumière Paris',
  HOTEL_CITY: 'Paris',
};

const serviceRecords = [
  ['Lumière Junior Suite', 'accommodation', 680, 0],
  ['Lumière Spa — Couples Massage', 'spa', 220, 90],
  ['Lumière Spa — Signature Hammam Ritual', 'spa', 280, 105],
  ["Le Jardin — Chef's Table", 'restaurant', 320, 150],
  ['Terrasse Lumière — Rooftop Dinner', 'restaurant', 190, 120],
  ['Private Chauffeur — CDG/ORY Transfer', 'transport', 130, 60],
  ['VIP Louvre After-Hours Private Tour', 'tour', 560, 180],
  ['Versailles Private Day Trip', 'tour', 950, 480],
  ['Private Paris Proposal Experience', 'experience', 1200, 180],
  ['Lumière Wine Discovery', 'experience', 180, 90],
  ['Breakfast at Le Jardin', 'restaurant', 45, 60],
  ['Private Chauffeur — Half-Day Disposal', 'transport', 480, 240],
].map(([Name, Category, PriceEUR, DurationMins]) => ({ fields: {
  Name, Category, PriceEUR, DurationMins, IsPartner: true, Active: true,
  Description: `${Name} from the verified Hôtel Lumière collection.`,
} }));

const forbiddenFallback = /could not verify a current match|whenever you are ready|booking is confirmed|availability is confirmed/i;

function observedRoute(body) {
  if ((body.recommendations || []).length) return 'external_discovery';
  if (body.hotel_collection) return 'partner_catalog';
  if ((body.partner_offers || []).length) return 'partner_request';
  if (body.intent === 'stay_planning' || body.intent === 'smalltalk' || body.intent === 'other') return 'conversation';
  if (body.intent === 'service_request') return 'service_request';
  if (body.intent === 'complaint') return 'human_handoff';
  return String(body.intent || 'conversation');
}

function routerResult(prompt) {
  const latest = (prompt.match(/LATEST GUEST MESSAGE:\n([\s\S]*)$/)?.[1] || '').toLowerCase();
  if (/last day|final day|jazz|nightlife|outside the hotel|museum|shopping|external/.test(latest)) {
    return { route: 'external_discovery', category: /jazz|nightlife/.test(latest) ? 'experience' : 'itinerary', search_query: 'Paris recommendation official website' };
  }
  if (/services|collection|what.*offer/.test(latest)) return { route: 'partner_catalog', category: null, search_query: '' };
  if (/spa|massage|hammam/.test(latest)) return { route: 'partner_request', category: 'spa', search_query: '' };
  if (/dining|restaurant|dinner|breakfast/.test(latest)) return { route: 'partner_request', category: 'restaurant', search_query: '' };
  if (/room|suite/.test(latest)) return { route: 'partner_request', category: 'accommodation', search_query: '' };
  if (/transfer|airport|cdg|orly/.test(latest)) return { route: 'partner_request', category: 'transport', search_query: '' };
  return { route: 'conversation', category: null, search_query: '' };
}

function modelResult(prompt) {
  const message = (prompt.match(/GUEST MESSAGE:\n([\s\S]*?)\n\nREQUIRED CUISINE/)?.[1] || '').toLowerCase();
  let replyText = 'I can help you narrow that down with one thoughtful next step.';
  if (/romantic|romant/.test(message)) replyText = 'For something romantic, a memorable dinner or a couples wellness experience would be a thoughtful place to begin. Which feels more like your evening?';
  if (/different|another|else/.test(message)) replyText = 'Of course. I can suggest a different option from the verified hotel collection—would you prefer dining, wellness, or an experience?';
  if (/which|quel|cual/.test(message)) replyText = 'I can help you choose between the verified options already discussed. Would you prefer the more relaxed or more celebratory choice?';
  return {
    reply_text: replyText,
    language_detected: 'en',
    intent: 'other',
    service_type: 'Concierge',
    requests: [],
    requires_human: false,
  };
}

let externalSearches = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options = {}) => {
  const target = String(url);
  if (target.includes('/Services')) return Response.json({ records: serviceRecords });
  if (target.includes('/Settings')) return Response.json({ records: [] });
  if (target.includes('api.groq.com')) {
    const prompt = JSON.parse(options.body).messages?.[0]?.content || '';
    const content = /You are the intent router/i.test(prompt) ? routerResult(prompt) : modelResult(prompt);
    return Response.json({ choices: [{ message: { content: JSON.stringify(content) } }] });
  }
  if (target.includes('scrapingbee')) {
    externalSearches += 1;
    return Response.json({ organic_results: [{
      title: 'Le Bal Jazz Paris',
      description: 'A current Paris recommendation with live music and a verified official website.',
      url: 'https://le-bal-jazz.example/paris',
    }] });
  }
  throw new Error(`Unexpected network request in deterministic conversation evaluation: ${target}`);
};

async function sendTurn(message, history, scenarioIndex) {
  const response = await worker.fetch(new Request('https://worker.example/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({
      message,
      sessionId: `conversation_eval_${scenarioIndex}`,
      scenario: 'pre-arrival',
      chatHistory: history,
      testMode: 'read_only',
    }),
  }), {
    ...env,
  }, {
    waitUntil() {
      throw new Error('read_only conversation evaluations must never schedule Airtable writes');
    },
  });
  return { response, body: await response.json() };
}

const firstTimeQuestion = 'By the way, is this your first time in Paris?';
const scenarios = [
  {
    name: 'failed transcript: returning visitor stays conversational',
    turns: [
      { message: 'View Services', expect: { route: 'partner_catalog', catalogue: true, addNextStep: true } },
      { message: 'no why ?', expect: { route: 'conversation', reply: /tailor|already know Paris/i } },
      { message: 'what ?', expect: { route: 'conversation', reply: /returning guest|first-time sights/i } },
      { message: 'what do you suggest ?', expect: { route: 'conversation', reply: /wellness|dinner|Paris experience/i, noExternal: true } },
    ],
  },
  { name: 'first-time question answered with no', seed: [{ role: 'assistant', message: firstTimeQuestion }], turns: [{ message: 'No', expect: { route: 'conversation', reply: /already know Paris|first-time sights/i } }, { message: 'Something more local, please.', expect: { noExternal: true } }] },
  { name: 'first-time question answered with yes', seed: [{ role: 'assistant', message: firstTimeQuestion }], turns: [{ message: 'Yes', expect: { route: 'conversation', reply: /plans for your stay|few ideas/i } }, { message: 'Dining, please.', expect: { hotel: true } }] },
  { name: 'first-time question answered with yes why', seed: [{ role: 'assistant', message: firstTimeQuestion }], turns: [{ message: 'Yes, why?', expect: { route: 'conversation', reply: /tailor|first visit/i } }, { message: 'Wellness sounds lovely.', expect: { hotel: true } }] },
  { name: 'returning visitor says they have been five times', seed: [{ role: 'assistant', message: firstTimeQuestion }], turns: [{ message: "I've been here five times.", expect: { route: 'conversation', reply: /already know Paris|first-time sights/i } }, { message: 'Something different, then.', expect: { noExternal: true } }] },
  { name: 'spa follow-up asks what to suggest', turns: [{ message: 'Show me your spa options.', expect: { hotel: true } }, { message: 'What do you suggest?', expect: { hotel: true, noExternal: true } }] },
  { name: 'dining follow-up asks which one to choose', turns: [{ message: 'Show me your dining options.', expect: { hotel: true } }, { message: 'Which one would you choose?', expect: { hotel: true, noExternal: true } }] },
  { name: 'catalogue follow-up asks for romance', turns: [{ message: 'View Services', expect: { catalogue: true, addNextStep: true } }, { message: 'What about something romantic?', expect: { noExternal: true, reply: /romantic|dinner|wellness/i } }] },
  { name: 'last-day Paris request uses external itinerary', turns: [{ message: 'Hello', expect: { route: 'conversation' } }, { message: 'What do you suggest for my last day in Paris?', expect: { route: 'external_discovery', external: true } }] },
  { name: 'jazz bar tonight uses external discovery', turns: [{ message: 'Good evening', expect: { route: 'conversation' } }, { message: 'Find me a jazz bar tonight.', expect: { route: 'external_discovery', external: true } }] },
  { name: 'why after a concierge question', seed: [{ role: 'assistant', message: firstTimeQuestion }], turns: [{ message: 'Why?', expect: { route: 'conversation', reply: /tailor|first visit|returning guest/i } }, { message: 'I enjoy quieter plans.', expect: { noExternal: true } }] },
  { name: 'what after a concierge explanation', seed: [{ role: 'assistant', message: firstTimeQuestion }, { role: 'user', message: 'No, why?' }, { role: 'assistant', message: 'Only so I can tailor the ideas for a returning guest.' }], turns: [{ message: 'What?', expect: { route: 'conversation', reply: /returning guest|first-time sights/i } }, { message: 'A quiet evening.', expect: { noExternal: true } }] },
  { name: 'no something else keeps the spa context', turns: [{ message: 'I am interested in the spa.', expect: { hotel: true } }, { message: 'No, something else.', expect: { hotel: true, noExternal: true } }] },
  { name: 'yes please keeps the spa context', turns: [{ message: 'Could I see the spa treatments?', expect: { hotel: true } }, { message: 'Yes please.', expect: { hotel: true, noExternal: true } }] },
  { name: 'not that one keeps the dining context', turns: [{ message: 'I would like dining options.', expect: { hotel: true } }, { message: 'Not that one.', expect: { hotel: true, noExternal: true } }] },
  { name: 'rooms follow-up retains accommodation context', turns: [{ message: 'Show me your rooms and suites.', expect: { hotel: true } }, { message: 'What about a quiet suite?', expect: { hotel: true, noExternal: true } }] },
  { name: 'transfer correction retains transport context', turns: [{ message: 'I need an airport transfer.', expect: { hotel: true } }, { message: 'Actually, make it CDG.', expect: { hotel: true, noExternal: true } }] },
  { name: 'arrival transfer timing', turns: [{ message: 'Can you arrange a transfer from CDG?', expect: { hotel: true } }, { message: 'Our flight lands at 19:30.', expect: { hotel: true, noExternal: true } }] },
  { name: 'housekeeping towels remains operational', turns: [{ message: 'Please send extra towels.', expect: { route: 'service_request' } }, { message: 'Actually, two extra towels.', expect: { route: 'service_request' } }] },
  { name: 'maintenance AC remains operational', turns: [{ message: 'The AC is not working.', expect: { route: 'service_request' } }, { message: 'It is still too warm.', expect: { noExternal: true } }] },
  { name: 'noise complaint preserves human attention', turns: [{ message: 'The room is far too noisy.', expect: { route: 'human_handoff' } }, { message: 'I need a manager.', expect: { route: 'human_handoff' } }] },
  { name: 'French spa follow-up', turns: [{ message: 'Montrez-moi les options spa.', expect: { hotel: true } }, { message: 'Que suggérez-vous ?', expect: { hotel: true, noExternal: true, language: 'fr' } }] },
  { name: 'French returning-visitor answer', seed: [{ role: 'assistant', message: 'Au fait, est-ce votre première fois à Paris ?' }], turns: [{ message: 'Non, pourquoi ?', expect: { route: 'conversation', reply: /adapter mes idées|connaissez déjà Paris/i, language: 'fr' } }, { message: 'Quelque chose de plus local.', expect: { noExternal: true, language: 'fr' } }] },
  { name: 'Spanish dining follow-up', turns: [{ message: 'Muéstrame las opciones de restaurante.', expect: { hotel: true, language: 'es' } }, { message: '¿Cuál elegirías?', expect: { hotel: true, noExternal: true, language: 'es' } }] },
  { name: 'Spanish returning-visitor answer', seed: [{ role: 'assistant', message: 'Por cierto, ¿es su primera vez en París?' }], turns: [{ message: 'No, ¿por qué?', expect: { route: 'conversation', reply: /adaptar|ya conoce París/i, language: 'es' } }, { message: 'Algo tranquilo, por favor.', expect: { noExternal: true, language: 'es' } }] },
  { name: 'Spanish wellness refinement', turns: [{ message: 'Quiero un masaje.', expect: { hotel: true, language: 'es' } }, { message: '¿Qué sugieres?', expect: { hotel: true, noExternal: true, language: 'es' } }] },
  { name: 'French external nightlife request', turns: [{ message: 'Bonsoir', expect: { route: 'conversation', language: 'fr' } }, { message: 'Trouvez-moi un club de jazz ce soir.', expect: { route: 'external_discovery', external: true, language: 'fr' } }] },
  { name: 'Spanish external nightlife request', turns: [{ message: 'Hola', expect: { route: 'conversation', language: 'es' } }, { message: 'Busca un club de jazz esta noche.', expect: { route: 'external_discovery', external: true, language: 'es' } }] },
  { name: 'breakfast follow-up stays with hotel dining', turns: [{ message: 'What are the breakfast options?', expect: { hotel: true } }, { message: 'Which one is more relaxed?', expect: { hotel: true, noExternal: true } }] },
  { name: 'private experience follow-up', turns: [{ message: 'Show me private Paris experiences.', expect: { hotel: true } }, { message: 'Something special for an anniversary?', expect: { hotel: true, noExternal: true } }] },
  { name: 'post-checkout praise stays factual', turns: [{ message: 'We loved our stay, five stars.', expect: { route: 'conversation' } }, { message: 'Thank you.', expect: { route: 'conversation' } }] },
  { name: 'post-checkout recovery stays human-led', turns: [{ message: 'Our stay was disappointing because of the noise.', expect: { route: 'human_handoff' } }, { message: 'I would like a manager to review this.', expect: { route: 'human_handoff' } }] },
];

const report = [];
try {
  for (const [scenarioIndex, scenario] of scenarios.entries()) {
    const history = [...(scenario.seed || [])];
    const turns = [];
    for (const turn of scenario.turns) {
      const beforeSearches = externalSearches;
      const { response, body } = await sendTurn(turn.message, history, scenarioIndex);
      const route = observedRoute(body);
      const external = externalSearches > beforeSearches;
      assert.equal(response.status, 200, `${scenario.name}: ${turn.message} returned ${response.status}`);
      assert.ok(String(body.reply || '').trim(), `${scenario.name}: ${turn.message} returned no reply`);
      assert.doesNotMatch(String(body.reply || ''), forbiddenFallback, `${scenario.name}: prohibited fallback or false confirmation`);
      if (turn.expect?.route) assert.equal(route, turn.expect.route, `${scenario.name}: unexpected route for ${turn.message}`);
      if (turn.expect?.external !== undefined) assert.equal(external, turn.expect.external, `${scenario.name}: external-search decision was wrong for ${turn.message}`);
      if (turn.expect?.noExternal) assert.equal(external, false, `${scenario.name}: vague follow-up triggered external search`);
      if (turn.expect?.catalogue) assert.ok(Array.isArray(body.hotel_collection) && body.hotel_collection.length > 0, `${scenario.name}: expected hotel catalogue`);
      if (turn.expect?.hotel) assert.ok((body.partner_offers || []).length > 0, `${scenario.name}: expected verified hotel options`);
      if (turn.expect?.reply) assert.match(String(body.reply || ''), turn.expect.reply, `${scenario.name}: reply did not address the turn`);
      if (turn.expect?.language) assert.equal(body.language, turn.expect.language, `${scenario.name}: wrong response language`);
      history.push({ role: 'user', message: turn.message }, { role: 'assistant', message: body.reply });
      if (turn.expect?.addNextStep) {
        assert.equal(body.next_step?.key, 'first_time_paris', `${scenario.name}: expected first-time follow-up`);
        history.push({ role: 'assistant', message: body.next_step.text });
      }
      turns.push({ guest: turn.message, reply: body.reply, route, external });
    }
    report.push({ name: scenario.name, turns });
  }
  assert.ok(report.length >= 30, 'At least 30 multi-turn conversation scenarios are required.');
  const exact = report.find((item) => item.name.startsWith('failed transcript'));
  assert.ok(exact?.turns.at(-1)?.reply && !/could not verify a current match/i.test(exact.turns.at(-1).reply));
  console.log(`MULTI-TURN SCENARIOS: ${report.length}/${scenarios.length} passed`);
  console.log('EXACT FAILED TRANSCRIPT:');
  for (const turn of exact.turns) console.log(`Guest: ${turn.guest}\nAssistant: ${turn.reply}\n`);
} finally {
  globalThis.fetch = originalFetch;
}
