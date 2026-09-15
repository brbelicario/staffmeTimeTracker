const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store'
};

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: JSON_HEADERS
  });
}

function findRate(body) {
  if (body && typeof body === 'object') {
    if (body.rate !== undefined) return body.rate;
    if (body.usdToPhp !== undefined) return body.usdToPhp;
    if (body.USDPHP !== undefined) return body.USDPHP;
    if (body.value !== undefined) return body.value;
    if (body.data && body.data.rate !== undefined) return body.data.rate;
    if (body.rates && body.rates.PHP !== undefined) return body.rates.PHP;
  }
  return body;
}

export async function onRequestGet({ env }) {
  const endpoint = String((env && env.GOOGLE_FINANCE_ENDPOINT) || '').trim();

  if (!endpoint) {
    return json({
      ok: false,
      configured: false,
      error: 'Google Finance endpoint is not configured yet.'
    }, 503);
  }

  let endpointUrl;
  try {
    endpointUrl = new URL(endpoint);
    if (endpointUrl.protocol !== 'https:') throw new Error('The endpoint must use HTTPS.');
  } catch (error) {
    return json({
      ok: false,
      configured: true,
      error: 'The configured Google Finance endpoint is invalid.'
    }, 500);
  }

  try {
    const upstreamUrl = new URL(endpointUrl.toString());
    upstreamUrl.searchParams.set('_refresh', String(Date.now()));
    const response = await fetch(upstreamUrl.toString(), {
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        'Cache-Control': 'no-cache'
      }
    });
    const text = await response.text();
    let body = {};
    try {
      body = text ? JSON.parse(text) : {};
    } catch (error) {
      return json({
        ok: false,
        configured: true,
        error: 'The Google Finance endpoint did not return JSON.'
      }, 502);
    }

    if (!response.ok) {
      return json({
        ok: false,
        configured: true,
        error: body.error || 'The Google Finance endpoint could not be reached.'
      }, 502);
    }

    const rate = Number(findRate(body));
    if (!Number.isFinite(rate) || rate <= 0 || rate >= 1000) {
      return json({
        ok: false,
        configured: true,
        error: 'The Google Finance endpoint returned an invalid USD to PHP rate.'
      }, 502);
    }

    return json({
      ok: true,
      rate: rate,
      source: body.source || 'Google Finance',
      updatedAt: body.updatedAt || new Date().toISOString()
    });
  } catch (error) {
    return json({
      ok: false,
      configured: true,
      error: 'The Google Finance endpoint is temporarily unavailable.'
    }, 502);
  }
}
