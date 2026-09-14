// ScrapingBee is intentionally isolated here. No semantic, response, or
// generic tool code references its endpoint, authentication, or payload.
const PROVIDER = 'scrapingbee';

function timeoutSignal(timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, clear: () => clearTimeout(timeout) };
}

export async function searchScrapingBee({ env, query, fetchImpl = fetch, timeoutMs = 8_000 }) {
  if (!env?.SCRAPINGBEE_API_KEY) {
    return { provider: PROVIDER, status: 'unavailable', error_code: 'provider_not_configured', payload: null };
  }
  const url = new URL('https://app.scrapingbee.com/api/v1/google');
  url.searchParams.set('search', query);
  url.searchParams.set('country_code', 'fr');
  url.searchParams.set('language', 'en');
  url.searchParams.set('light_request', 'true');
  const timeout = timeoutSignal(timeoutMs);
  try {
    const response = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${env.SCRAPINGBEE_API_KEY}` },
      signal: timeout.signal,
    });
    if (response.status === 401 || response.status === 402 || response.status === 403 || response.status === 429) {
      return { provider: PROVIDER, status: 'unavailable', error_code: 'provider_auth_or_quota', payload: null };
    }
    if (!response.ok) return { provider: PROVIDER, status: 'error', error_code: 'provider_response_error', payload: null };
    let payload;
    try { payload = await response.json(); } catch { return { provider: PROVIDER, status: 'error', error_code: 'provider_malformed_response', payload: null }; }
    return payload && typeof payload === 'object'
      ? { provider: PROVIDER, status: 'success', error_code: null, payload }
      : { provider: PROVIDER, status: 'error', error_code: 'provider_malformed_response', payload: null };
  } catch (error) {
    return {
      provider: PROVIDER,
      status: 'error',
      error_code: error?.name === 'AbortError' ? 'provider_timeout' : 'provider_request_failed',
      payload: null,
    };
  } finally {
    timeout.clear();
  }
}
