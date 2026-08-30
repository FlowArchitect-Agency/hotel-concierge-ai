import { parseExternalResults } from '../../concierge.js';
import { toolResult } from '../schemas.js';
import { searchScrapingBee } from './providers/scrapingbee.js';

const PROVIDERS = Object.freeze({ scrapingbee: searchScrapingBee });

function clean(value, max = 180) {
  return String(value ?? '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function locationHint(location) {
  const value = clean(location, 100);
  return /eiffel tower|tour eiffel/i.test(value) ? 'Paris 7th arrondissement' : value;
}

function buildQuery(input, context) {
  const city = clean(context.city || 'Paris', 80);
  const location = locationHint(input.location || context.location);
  const cuisine = context.classification?.cuisine?.label;
  if (cuisine) return `${cuisine} restaurant ${location || city} official website`;
  if (context.classification?.category === 'itinerary') return `${city} Louvre museum Seine cruise official website`;
  const plannedQuery = clean(context.classification?.searchQuery, 180);
  if (plannedQuery) {
    const place = location || city;
    return `${plannedQuery}${place && !new RegExp(`\\b${place.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(plannedQuery) ? ` ${place}` : ''} official website`.trim().slice(0, 220);
  }
  return `${clean(input.query)} ${location || city} official website`.trim().slice(0, 220);
}

function asClassification(input, context) {
  return {
    ...(context.classification || {}),
    category: input.category || context.classification?.category || 'experience',
    location: input.location || context.classification?.location || '',
    externalDiscovery: true,
    searchQuery: clean(context.classification?.searchQuery || input.query),
  };
}

function normalize(item, provider, category) {
  return {
    name: clean(item?.name, 120),
    description: clean(item?.description ?? item?.snippet, 260),
    website_url: clean(item?.websiteUrl ?? item?.website_url, 500),
    image_url: clean(item?.imageUrl ?? item?.image_url, 500) || null,
    location: clean(item?.address ?? item?.location, 180) || null,
    category: clean(category, 48),
    source_provider: provider,
    verified: true,
    // Transitional aliases keep the existing client contract unchanged while
    // all tool consumers can rely on the stable snake_case representation.
    websiteUrl: clean(item?.websiteUrl ?? item?.website_url, 500),
    imageUrl: clean(item?.imageUrl ?? item?.image_url, 500) || null,
    address: clean(item?.address ?? item?.location, 180),
    rating: item?.rating ?? null,
    reviewsCount: item?.reviewsCount ?? null,
    snippet: clean(item?.snippet ?? item?.description, 260),
    source: 'external_web_search',
  };
}

// The provider can be changed entirely by environment configuration. A
// fallback is attempted only after an unsuccessful/no-result primary search.
export async function runExternalSearch({ input, env, context = {}, fetchImpl = fetch, providers = PROVIDERS }) {
  const primary = clean(env?.EXTERNAL_SEARCH_PROVIDER || 'scrapingbee', 48).toLowerCase();
  const fallback = clean(env?.EXTERNAL_SEARCH_FALLBACK_PROVIDER, 48).toLowerCase();
  const classification = asClassification(input, context);
  const query = buildQuery(input, { ...context, classification });
  const selected = { ...PROVIDERS, ...(providers || {}) };
  const invoke = async (name) => {
    const adapter = selected[name];
    if (!adapter) return { provider: name || null, status: 'unavailable', error_code: 'provider_not_supported', payload: null };
    return adapter({ env, query, fetchImpl });
  };
  let providerResponse = await invoke(primary);
  let fallbackUsed = false;
  if (fallback && fallback !== primary && (providerResponse.status !== 'success')) {
    providerResponse = await invoke(fallback);
    fallbackUsed = true;
  }
  if (providerResponse.status !== 'success') {
    return toolResult('external_search', providerResponse.status === 'unavailable' ? 'unavailable' : 'error', {
      errorCode: providerResponse.error_code || 'provider_unavailable',
      meta: { provider_used: providerResponse.provider || primary, fallback_used: fallbackUsed },
    });
  }
  let verified;
  try { verified = parseExternalResults(providerResponse.payload, classification); } catch { verified = []; }
  if (!verified.length && fallback && fallback !== primary && !fallbackUsed) {
    providerResponse = await invoke(fallback);
    fallbackUsed = true;
    if (providerResponse.status === 'success') {
      try { verified = parseExternalResults(providerResponse.payload, classification); } catch { verified = []; }
    }
  }
  if (!verified.length) {
    const status = providerResponse.status === 'success' ? 'no_results' : (providerResponse.status === 'unavailable' ? 'unavailable' : 'error');
    return toolResult('external_search', status, {
      errorCode: status === 'no_results' ? null : providerResponse.error_code || 'provider_unavailable',
      meta: { provider_used: providerResponse.provider || primary, fallback_used: fallbackUsed },
    });
  }
  return toolResult('external_search', 'success', {
    data: { results: verified.map((item) => normalize(item, providerResponse.provider || primary, classification.category)) },
    meta: { provider_used: providerResponse.provider || primary, fallback_used: fallbackUsed },
  });
}

export const externalSearchProviders = PROVIDERS;
