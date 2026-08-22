import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';

test('POST /api/demo-chat accepts guest simulation and returns AI response with quick replies and Is_Demo safety lock', async () => {
  const env = {
    ALLOWED_ORIGIN: 'https://flowarchitect-agency.github.io',
    HOTEL_NAME: 'Hôtel Lumière Paris',
    HOTEL_CITY: 'Paris',
    GROQ_API_KEY: 'mock_groq_key',
    AIRTABLE_API_KEY: 'mock_airtable_key',
    AIRTABLE_BASE_ID: 'test_base',
  };

  const originalFetch = globalThis.fetch;
  let airtableWrites = [];

  globalThis.fetch = async (url, options = {}) => {
    const target = String(url);

    // Mock Groq LLM response
    if (target.includes('api.groq.com') || target.includes('chat/completions')) {
      return Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify({
                reply: 'Bonjour Alexander, we would be honored to arrange your private Mercedes S-Class chauffeur transfer.',
                intent: 'service_request',
                serviceType: 'transport',
                requests: [
                  {
                    serviceName: 'Private Mercedes S-Class Chauffeur',
                    summary: 'Airport transfer request for Alexander',
                    isUpsell: true,
                  },
                ],
              }),
            },
          },
        ],
      });
    }

    // Mock Airtable endpoints
    if (target.includes('api.airtable.com')) {
      if (options.method === 'POST') {
        const body = JSON.parse(options.body || '{}');
        airtableWrites.push({ url: target, fields: body.fields });
        return Response.json({ id: `rec_${Date.now()}`, fields: body.fields });
      }
      return Response.json({ records: [] });
    }

    return Response.json({ records: [] });
  };

  try {
    const request = new Request('https://worker.example/api/demo-chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://flowarchitect-agency.github.io',
      },
      body: JSON.stringify({
        guestName: 'Alexander Dupont',
        language: 'en',
        scenario: 'pre_arrival',
        is_demo: true,
        message: 'Could you arrange an airport transfer for me?',
      }),
    });

    const pending = [];
    const ctx = {
      waitUntil(promise) {
        pending.push(promise);
      },
    };

    const response = await worker.fetch(request, env, ctx);
    assert.strictEqual(response.status, 200);

    const data = await response.json();
    assert.match(data.reply, /Mercedes/i);
    assert.ok(Array.isArray(data.quickReplies));
    assert.strictEqual(data.quickReplies.length > 0, true);

    await Promise.all(pending);

    // Verify Is_Demo safety lock was set in Airtable writes
    const demoWrites = airtableWrites.filter((w) => w.fields && (w.fields.Is_Demo === true || w.fields.fldZmbdJKDtwAyOL5 === true || w.fields.fldwn2jA6eNyLaSjN === true || w.fields.fld3ZT2AozREWd3DS === true));
    assert.ok(demoWrites.length > 0, 'Expected Airtable records to have Is_Demo safety flag set to true');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
