const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8'
};

function json(data, status) {
  return new Response(JSON.stringify(data), { status: status || 200, headers: CORS_HEADERS });
}

function cookies(request) {
  const result = {};
  (request.headers.get('Cookie') || '').split(';').forEach(function(part) {
    const i = part.indexOf('=');
    if (i > 0) result[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return result;
}

async function hash(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
}

function recoveryId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
}

async function ensureTables(db) {
  await db.batch([
    db.prepare('CREATE TABLE IF NOT EXISTS tracker_profiles (profile_key TEXT PRIMARY KEY, settings_json TEXT NOT NULL DEFAULT \'{}\', rows_json TEXT NOT NULL DEFAULT \'[]\', manual_entries_json TEXT NOT NULL DEFAULT \'[]\', reported_weeks_json TEXT NOT NULL DEFAULT \'[]\', contracts_json TEXT NOT NULL DEFAULT \'[]\', sm_identity TEXT NOT NULL DEFAULT \'\', sm_identity_history_json TEXT NOT NULL DEFAULT \'[]\', last_sync TEXT, revision INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL)'),
    db.prepare('CREATE TABLE IF NOT EXISTS tracker_profile_versions (id TEXT PRIMARY KEY, profile_key TEXT NOT NULL, reason TEXT NOT NULL, created_at TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0, row_count INTEGER NOT NULL DEFAULT 0, manual_count INTEGER NOT NULL DEFAULT 0, payload_json TEXT NOT NULL)')
  ]);
  try { await db.prepare('ALTER TABLE tracker_profiles ADD COLUMN manual_entries_json TEXT NOT NULL DEFAULT \'[]\'').run(); } catch (error) {}
  try { await db.prepare('ALTER TABLE tracker_profiles ADD COLUMN reported_weeks_json TEXT NOT NULL DEFAULT \'[]\'').run(); } catch (error) {}
  try { await db.prepare('ALTER TABLE tracker_profiles ADD COLUMN contracts_json TEXT NOT NULL DEFAULT \'[]\'').run(); } catch (error) {}
  try { await db.prepare("ALTER TABLE tracker_profiles ADD COLUMN sm_identity TEXT NOT NULL DEFAULT ''").run(); } catch (error) {}
  try { await db.prepare("ALTER TABLE tracker_profiles ADD COLUMN sm_identity_history_json TEXT NOT NULL DEFAULT '[]'").run(); } catch (error) {}
  try { await db.prepare('ALTER TABLE tracker_profiles ADD COLUMN revision INTEGER NOT NULL DEFAULT 0').run(); } catch (error) {}
  try { await db.prepare('CREATE INDEX IF NOT EXISTS tracker_profile_versions_profile_created ON tracker_profile_versions(profile_key, created_at DESC)').run(); } catch (error) {}
}

async function userFromSession(request, db) {
  const token = cookies(request).staffme_session;
  if (!token) return null;
  return db.prepare('SELECT u.id, u.email FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?')
    .bind(await hash(token), new Date().toISOString())
    .first();
}

function normalizedPayload(value) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    settings: source.settings && typeof source.settings === 'object' ? source.settings : {},
    rows: Array.isArray(source.rows) ? source.rows : [],
    manualEntries: Array.isArray(source.manualEntries) ? source.manualEntries : [],
    reportedWeeks: Array.isArray(source.reportedWeeks) ? source.reportedWeeks : [],
    contracts: Array.isArray(source.contracts) ? source.contracts : [],
    source: String(source.source || '').slice(0, 40),
    lastSync: source.lastSync ? String(source.lastSync).slice(0, 80) : null,
    smIdentity: String(source.smIdentity || '').replace(/\s+/g, ' ').trim().slice(0, 120),
    smIdentityHistory: Array.isArray(source.smIdentityHistory) ? source.smIdentityHistory.slice(0, 50) : []
  };
}

async function findProfile(db, key, legacyKey) {
  let record = await db.prepare('SELECT profile_key, settings_json, rows_json, manual_entries_json, reported_weeks_json, contracts_json, sm_identity, sm_identity_history_json, last_sync, revision, updated_at FROM tracker_profiles WHERE profile_key = ?').bind(key).first();
  if (!record) record = await db.prepare('SELECT profile_key, settings_json, rows_json, manual_entries_json, reported_weeks_json, contracts_json, sm_identity, sm_identity_history_json, last_sync, revision, updated_at FROM tracker_profiles WHERE profile_key = ?').bind(legacyKey).first();
  return record || null;
}

async function deleteOldSnapshots(db, profileKey) {
  const old = await db.prepare('SELECT id FROM tracker_profile_versions WHERE profile_key = ? ORDER BY created_at DESC LIMIT 100').bind(profileKey).all();
  const results = old && Array.isArray(old.results) ? old.results : [];
  const stale = results.slice(30);
  if (stale.length) {
    await db.batch(stale.map(function(row) {
      return db.prepare('DELETE FROM tracker_profile_versions WHERE id = ? AND profile_key = ?').bind(row.id, profileKey);
    }));
  }
}

export async function onRequest(context) {
  const request = context.request;
  const db = context.env.DB || context.env.db;
  if (request.method === 'OPTIONS') return json({}, 204);
  if (!db) return json({ ok: false, error: 'D1 binding is missing.' }, 503);

  await ensureTables(db);
  const user = await userFromSession(request, db);
  if (!user) return json({ ok: false, error: 'Authentication required.' }, 401);
  const profileKey = await hash('user:' + user.id);
  const legacyKey = await hash(user.email);
  const url = new URL(request.url);
  const mode = url.searchParams.get('mode') || '';

  if (request.method === 'GET') {
    if (mode === 'list') {
      const snapshots = await db.prepare('SELECT id, reason, created_at, revision, row_count, manual_count FROM tracker_profile_versions WHERE profile_key = ? ORDER BY created_at DESC LIMIT 30').bind(profileKey).all();
      return json({ ok: true, snapshots: snapshots && Array.isArray(snapshots.results) ? snapshots.results.map(function(row) {
        return {
          id: row.id,
          source: 'cloud',
          reason: row.reason,
          createdAt: row.created_at,
          revision: Number(row.revision) || 0,
          rowCount: Number(row.row_count) || 0,
          manualCount: Number(row.manual_count) || 0
        };
      }) : [] });
    }

    if (mode === 'detail') {
      const id = String(url.searchParams.get('id') || '').slice(0, 120);
      if (!id) return json({ ok: false, error: 'Recovery point ID is required.' }, 400);
      const snapshot = await db.prepare('SELECT id, reason, created_at, revision, row_count, manual_count, payload_json FROM tracker_profile_versions WHERE id = ? AND profile_key = ?').bind(id, profileKey).first();
      if (!snapshot) return json({ ok: false, error: 'Recovery point not found.' }, 404);
      let payload = {};
      try { payload = JSON.parse(snapshot.payload_json || '{}'); } catch (error) {}
      return json({ ok: true, snapshot: { id: snapshot.id, source: 'cloud', reason: snapshot.reason, createdAt: snapshot.created_at, revision: Number(snapshot.revision) || 0, rowCount: Number(snapshot.row_count) || 0, manualCount: Number(snapshot.manual_count) || 0, payload: normalizedPayload(payload) } });
    }

    return json({ ok: false, error: 'Recovery mode is required.' }, 400);
  }

  if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed.' }, 405);
  let body;
  try { body = await request.json(); } catch (error) { return json({ ok: false, error: 'Invalid JSON body.' }, 400); }
  const action = String(body && body.action || '');

  if (action === 'create') {
    const payload = normalizedPayload(body && body.payload);
    const payloadJson = JSON.stringify(payload);
    if (payloadJson.length > 2500000) return json({ ok: false, error: 'The recovery point is too large.' }, 413);
    const reason = String(body && body.reason || 'Before a data change').replace(/\s+/g, ' ').trim().slice(0, 160) || 'Before a data change';
    const createdAt = new Date().toISOString();
    const id = recoveryId();
    const revision = Number(body && body.revision) || 0;
    await db.prepare('INSERT INTO tracker_profile_versions (id, profile_key, reason, created_at, revision, row_count, manual_count, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(id, profileKey, reason, createdAt, revision, payload.rows.length, payload.manualEntries.length, payloadJson)
      .run();
    await deleteOldSnapshots(db, profileKey);
    return json({ ok: true, snapshot: { id: id, source: 'cloud', reason: reason, createdAt: createdAt, revision: revision, rowCount: payload.rows.length, manualCount: payload.manualEntries.length } });
  }

  if (action === 'restoreHourly') {
    const snapshotId = String(body && body.snapshotId || '').slice(0, 120);
    if (!snapshotId) return json({ ok: false, error: 'Recovery point ID is required.' }, 400);
    const snapshot = await db.prepare('SELECT payload_json FROM tracker_profile_versions WHERE id = ? AND profile_key = ?').bind(snapshotId, profileKey).first();
    if (!snapshot) return json({ ok: false, error: 'Recovery point not found.' }, 404);
    let payload = {};
    try { payload = normalizedPayload(JSON.parse(snapshot.payload_json || '{}')); } catch (error) {}

    const current = await findProfile(db, profileKey, legacyKey);
    const currentRevision = current ? Number(current.revision) || 0 : 0;
    const requestedRevision = Number(body && body.baseRevision);
    if (Number.isFinite(requestedRevision) && requestedRevision !== currentRevision) {
      return json({ ok: false, code: 'SYNC_CONFLICT', error: 'The cloud copy changed before the restore could be applied.', revision: currentRevision }, 409);
    }
    const nextRevision = currentRevision + 1;
    const now = new Date().toISOString();
    if (current) {
      await db.prepare('UPDATE tracker_profiles SET rows_json = ?, last_sync = ?, revision = ?, updated_at = ? WHERE profile_key = ?')
        .bind(JSON.stringify(payload.rows), payload.lastSync, nextRevision, now, current.profile_key)
        .run();
    } else {
      await db.prepare('INSERT INTO tracker_profiles (profile_key, settings_json, rows_json, manual_entries_json, reported_weeks_json, contracts_json, sm_identity, sm_identity_history_json, last_sync, revision, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(profileKey, JSON.stringify(payload.settings), JSON.stringify(payload.rows), JSON.stringify(payload.manualEntries), JSON.stringify(payload.reportedWeeks), JSON.stringify(payload.contracts), payload.smIdentity, JSON.stringify(payload.smIdentityHistory), payload.lastSync, nextRevision, now)
        .run();
    }
    return json({ ok: true, restored: true, rows: payload.rows, lastSync: payload.lastSync, revision: nextRevision, updatedAt: now });
  }

  return json({ ok: false, error: 'Unknown recovery action.' }, 400);
}
