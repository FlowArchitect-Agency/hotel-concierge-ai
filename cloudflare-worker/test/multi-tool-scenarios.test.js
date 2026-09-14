import assert from 'node:assert/strict';
import test from 'node:test';
import { buildToolRequests, createToolExecutor } from '../src/tools/index.js';

const records = [
  { fields: { Name: 'Le Jardin', Category: 'restaurant', Active: true, IsPartner: true, Description: 'French restaurant' } },
  { fields: { Name: 'Couples Massage', Category: 'spa', Active: true, IsPartner: true, Description: 'Private treatment' } },
  { fields: { Name: 'Airport Transfer', Category: 'transport', Active: true, IsPartner: true, Description: 'Private airport transfer' } },
];
const source = { hotelName: 'Hôtel Lumière Paris', entries: [{ key: 'Breakfast hours', value: '07:00–10:30' }], text: '- Breakfast hours: 07:00–10:30' };
const externalPayload = { organic_results: [{ title: 'Blue Note Paris', description: 'Live jazz club in Paris with late music.', url: 'https://bluenote.example/' }] };
const providers = { mock: async () => ({ provider: 'mock', status: 'success', payload: externalPayload }) };

function plan(overrides = {}) {
  return {
    valid: true,
    interactionType: 'hotel_service',
    guestGoal: 'guest needs help',
    serviceCategory: 'restaurant',
    serviceCategories: ['restaurant'],
    toolNeeds: { hotelFacts: false, hotelServices: true, externalSearch: false, guestRequest: true, humanTakeover: false },
    ...overrides,
  };
}

const scenarios = [
  ['room is cold and dinner tonight', plan({ interactionType: 'operational_request', serviceCategory: 'maintenance', serviceCategories: ['maintenance', 'restaurant'] }), ['hotel_services', 'guest_request']],
  ['bring towels and find somewhere romantic', plan({ interactionType: 'operational_request', serviceCategory: 'housekeeping', serviceCategories: ['housekeeping', 'experience'], toolNeeds: { hotelFacts: false, hotelServices: true, externalSearch: true, guestRequest: true, humanTakeover: false } }), ['hotel_services', 'external_search', 'guest_request']],
  ['shower broken and book a massage', plan({ interactionType: 'operational_request', serviceCategory: 'maintenance', serviceCategories: ['maintenance', 'spa'] }), ['hotel_services', 'guest_request']],
  ['forget dinner and find live jazz', plan({ interactionType: 'external_discovery', serviceCategory: 'experience', serviceCategories: [], toolNeeds: { hotelFacts: false, hotelServices: false, externalSearch: true, guestRequest: false, humanTakeover: false } }), ['external_search']],
  ['book the spa option you showed me', plan({ interactionType: 'booking_request', serviceCategory: 'spa', serviceCategories: ['spa'] }), ['hotel_services', 'guest_request']],
  ['cancel that and arrange airport transfer', plan({ interactionType: 'cancellation', serviceCategory: 'transport', serviceCategories: ['transport'] }), ['hotel_services', 'guest_request']],
  ['that is not right, I want a human', plan({ interactionType: 'human_takeover', serviceCategory: null, serviceCategories: [], toolNeeds: { hotelFacts: false, hotelServices: false, externalSearch: false, guestRequest: false, humanTakeover: true } }), ['human_takeover']],
  ['breakfast time and arrange a taxi', plan({ interactionType: 'booking_request', serviceCategory: 'transport', serviceCategories: ['transport'], toolNeeds: { hotelFacts: true, hotelServices: true, externalSearch: false, guestRequest: true, humanTakeover: false } }), ['hotel_facts', 'hotel_services', 'guest_request']],
  ['checkout time and something non-touristy', plan({ interactionType: 'external_discovery', serviceCategory: 'itinerary', serviceCategories: [], toolNeeds: { hotelFacts: true, hotelServices: false, externalSearch: true, guestRequest: false, humanTakeover: false } }), ['hotel_facts', 'external_search']],
  ['returning guest, surprise me', plan({ interactionType: 'hotel_service', serviceCategory: 'experience', serviceCategories: ['experience'], toolNeeds: { hotelFacts: true, hotelServices: true, externalSearch: false, guestRequest: false, humanTakeover: false } }), ['hotel_facts', 'hotel_services']],
  ['parking policy and transfer', plan({ interactionType: 'booking_request', serviceCategory: 'transport', serviceCategories: ['transport'], toolNeeds: { hotelFacts: true, hotelServices: true, externalSearch: false, guestRequest: true, humanTakeover: false } }), ['hotel_facts', 'hotel_services', 'guest_request']],
  ['wifi is down and I need dinner', plan({ interactionType: 'operational_request', serviceCategory: 'maintenance', serviceCategories: ['maintenance', 'restaurant'] }), ['hotel_services', 'guest_request']],
  ['quiet spa and romantic restaurant', plan({ interactionType: 'hotel_service', serviceCategory: 'spa', serviceCategories: ['spa', 'restaurant'], toolNeeds: { hotelFacts: false, hotelServices: true, externalSearch: false, guestRequest: false, humanTakeover: false } }), ['hotel_services']],
  ['lost passport and need a person', plan({ interactionType: 'human_takeover', serviceCategory: null, serviceCategories: [], toolNeeds: { hotelFacts: false, hotelServices: false, externalSearch: false, guestRequest: false, humanTakeover: true } }), ['human_takeover']],
  ['late dinner and jazz nearby', plan({ interactionType: 'external_discovery', serviceCategory: 'restaurant', serviceCategories: ['restaurant'], toolNeeds: { hotelFacts: false, hotelServices: true, externalSearch: true, guestRequest: false, humanTakeover: false } }), ['hotel_services', 'external_search']],
  ['airport transfer and check-in time', plan({ interactionType: 'booking_request', serviceCategory: 'transport', serviceCategories: ['transport'], toolNeeds: { hotelFacts: true, hotelServices: true, externalSearch: false, guestRequest: true, humanTakeover: false } }), ['hotel_facts', 'hotel_services', 'guest_request']],
  ['air conditioning failure and spa tomorrow', plan({ interactionType: 'operational_request', serviceCategory: 'maintenance', serviceCategories: ['maintenance', 'spa'] }), ['hotel_services', 'guest_request']],
  ['private tour and accessible dinner', plan({ interactionType: 'hotel_service', serviceCategory: 'tour', serviceCategories: ['tour', 'restaurant'], toolNeeds: { hotelFacts: false, hotelServices: true, externalSearch: true, guestRequest: false, humanTakeover: false } }), ['hotel_services', 'external_search']],
  ['complaint about noise and taxi tomorrow', plan({ interactionType: 'complaint', serviceCategory: 'transport', serviceCategories: ['transport'], toolNeeds: { hotelFacts: false, hotelServices: true, externalSearch: false, guestRequest: true, humanTakeover: true } }), ['hotel_services', 'guest_request', 'human_takeover']],
  ['room key is broken and arrange dinner', plan({ interactionType: 'operational_request', serviceCategory: 'maintenance', serviceCategories: ['maintenance', 'restaurant'] }), ['hotel_services', 'guest_request']],
];

test('20 bounded multi-tool scenarios select and execute exactly the expected capabilities', async () => {
  assert.equal(scenarios.length, 20);
  for (const [message, semanticPlan, expectedTools] of scenarios) {
    const input = { message, language: 'en', testMode: 'read_only' };
    const requests = buildToolRequests({ plan: semanticPlan, classification: { category: semanticPlan.serviceCategory, location: 'Paris' }, input });
    assert.deepEqual(requests.map((request) => request.tool), expectedTools, message);
    const executor = createToolExecutor({
      mode: 'read_only', records, source, env: { EXTERNAL_SEARCH_PROVIDER: 'mock' },
      context: { city: 'Paris', classification: { category: semanticPlan.serviceCategory || 'experience', externalDiscovery: true } }, providers,
    });
    const results = await executor.execute(requests);
    assert.deepEqual(results.map((result) => result.tool), expectedTools, message);
    assert.ok(results.every((result) => ['success', 'no_results', 'read_only'].includes(result.status)), message);
  }
});
