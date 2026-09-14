const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8'
};

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: CORS_HEADERS
  });
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

async function profileKey(email) {
  const bytes = new TextEncoder().encode(normalizeEmail(email));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map(function(byte) { return byte.toString(16).padStart(2, '0'); })
    .join('');
}

async function ensureTable(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS tracker_profiles (
      profile_key TEXT PRIMARY KEY,
      settings_json TEXT NOT NULL DEFAULT '{}',
      rows_json TEXT NOT NULL DEFAULT '[]',
      last_sync TEXT,
      updated_at TEXT NOT NULL
    )
  `).run();
}

function validEmail(email) {
  return /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email);
}

export async function onRequest(context) {
  const request = context.request;
  const env = context.env;

  if (request.method === 'OPTIONS') return json({}, 204);
  const db = env.DB || env.db;
  if (!db) {
    return json({
      ok: false,
      error: 'Cloud sync is not configured. Add a D1 binding named DB or db to this Pages project.'
    }, 503);
  }

  let email;
  let body = null;

  if (request.method === 'GET') {
    email = normalizeEmail(new URL(request.url).searchParams.get('email'));
  } else if (request.method === 'POST') {
    try {
      body = await request.json();
    } catch (error) {
      return json({ ok: false, error: 'Invalid JSON body.' }, 400);
    }
    email = normalizeEmail(body && body.email);
  } else {
    return json({ ok: false, error: 'Method not allowed.' }, 405);
  }

  if (!validEmail(email)) {
    return json({ ok: false, error: 'A valid email is required.' }, 400);
  }

  await ensureTable(db);
  const key = await profileKey(email);

  if (request.method === 'GET') {
    const record = await db.prepare(
      'SELECT settings_json, rows_json, last_sync, updated_at FROM tracker_profiles WHERE profile_key = ?'
    ).bind(key).first();

    if (!record) return json({ ok: true, found: false, rows: [], settings: null });

    let settings = {};
    let rows = [];
    try { settings = JSON.parse(record.settings_json || '{}'); } catch (error) {}
    try { rows = JSON.parse(record.rows_json || '[]'); } catch (error) {}

    return json({
      ok: true,
      found: true,
      settings: settings,
      rows: Array.isArray(rows) ? rows : [],
      lastSync: record.last_sync || null,
      updatedAt: record.updated_at || null
    });
  }

  const settings = body && body.settings && typeof body.settings === 'object'
    ? body.settings
    : {};
  const rows = body && Array.isArray(body.rows) ? body.rows : [];
  const rowsJson = JSON.stringify(rows);
  if (rowsJson.length > 2000000) {
    return json({ ok: false, error: 'The saved StaffMe data is too large.' }, 413);
  }

  const updatedAt = new Date().toISOString();
  await db.prepare(`
    INSERT INTO tracker_profiles (profile_key, settings_json, rows_json, last_sync, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(profile_key) DO UPDATE SET
      settings_json = excluded.settings_json,
      rows_json = excluded.rows_json,
      last_sync = excluded.last_sync,
      updated_at = excluded.updated_at
  `).bind(
    key,
    JSON.stringify(settings),
    rowsJson,
    body && body.lastSync ? String(body.lastSync) : null,
    updatedAt
  ).run();

  return json({ ok: true, saved: true, updatedAt: updatedAt });
}
