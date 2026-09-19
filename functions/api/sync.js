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

function cleanIdentity(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

function identityKey(value) {
  return cleanIdentity(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function identityTokens(value) {
  return identityKey(value).split(' ').filter(function(token) { return token.length > 1; });
}

function identitiesMatch(sourceName, expectedName) {
  const sourceKey = identityKey(sourceName);
  const expectedKey = identityKey(expectedName);
  if (!sourceKey || !expectedKey) return false;
  if (sourceKey === expectedKey) return true;
  const sourceTokens = new Set(identityTokens(sourceName));
  const expectedTokens = new Set(identityTokens(expectedName));
  if (sourceTokens.size < 2 || expectedTokens.size < 2) return false;
  const sourceIsShorter = Array.from(sourceTokens).every(function(token) { return expectedTokens.has(token); });
  const expectedIsShorter = Array.from(expectedTokens).every(function(token) { return sourceTokens.has(token); });
  return sourceIsShorter || expectedIsShorter;
}

function normalizeIdentityHistory(values) {
  const seen = new Set();
  const result = [];
  (Array.isArray(values) ? values : []).forEach(function(value) {
    const identity = cleanIdentity(value);
    const key = identityKey(identity);
    if (!key || seen.has(key)) return;
    seen.add(key);
    result.push(identity);
  });
  return result.slice(0, 50);
}

function isSyntheticRow(row) {
  return Boolean(row && row.test === true) || identityKey(row && row.agent) === 'smtracker test';
}

function observedIdentities(rows) {
  const names = new Map();
  (Array.isArray(rows) ? rows : []).forEach(function(row) {
    if (isSyntheticRow(row)) return;
    const name = cleanIdentity(row && row.agent);
    const key = identityKey(name);
    if (key && !names.has(key)) names.set(key, name);
  });
  return Array.from(names.values());
}

async function ensureTables(db) {
  await db.batch([
    db.prepare('CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT, picture TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)'),
    db.prepare('CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at TEXT NOT NULL)'),
    db.prepare('CREATE TABLE IF NOT EXISTS tracker_profiles (profile_key TEXT PRIMARY KEY, settings_json TEXT NOT NULL DEFAULT \'{}\', rows_json TEXT NOT NULL DEFAULT \'[]\', manual_entries_json TEXT NOT NULL DEFAULT \'[]\', reported_weeks_json TEXT NOT NULL DEFAULT \'[]\', contracts_json TEXT NOT NULL DEFAULT \'[]\', sm_identity TEXT NOT NULL DEFAULT \'\', sm_identity_history_json TEXT NOT NULL DEFAULT \'[]\', last_sync TEXT, revision INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL)')
  ]);
  try { await db.prepare('ALTER TABLE tracker_profiles ADD COLUMN manual_entries_json TEXT NOT NULL DEFAULT \'[]\'').run(); } catch (error) {}
  try { await db.prepare('ALTER TABLE tracker_profiles ADD COLUMN reported_weeks_json TEXT NOT NULL DEFAULT \'[]\'').run(); } catch (error) {}
  try { await db.prepare('ALTER TABLE tracker_profiles ADD COLUMN contracts_json TEXT NOT NULL DEFAULT \'[]\'').run(); } catch (error) {}
  try { await db.prepare("ALTER TABLE tracker_profiles ADD COLUMN sm_identity TEXT NOT NULL DEFAULT ''").run(); } catch (error) {}
  try { await db.prepare("ALTER TABLE tracker_profiles ADD COLUMN sm_identity_history_json TEXT NOT NULL DEFAULT '[]'").run(); } catch (error) {}
  try { await db.prepare('ALTER TABLE tracker_profiles ADD COLUMN revision INTEGER NOT NULL DEFAULT 0').run(); } catch (error) {}
}

async function userFromSession(request, db) {
  const token = cookies(request).staffme_session;
  if (!token) return null;
  const row = await db.prepare('SELECT u.id, u.email FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?').bind(await hash(token), new Date().toISOString()).first();
  return row || null;
}

export async function onRequest(context) {
  const request = context.request;
  const env = context.env;
  const db = env.DB || env.db;
  if (request.method === 'OPTIONS') return json({}, 204);
  if (!db) return json({ ok: false, error: 'D1 binding is missing.' }, 503);
  await ensureTables(db);
  const user = await userFromSession(request, db);
  if (!user) return json({ ok: false, error: 'Authentication required.' }, 401);
  const key = await hash('user:' + user.id);
  const legacyKey = await hash(user.email);

  if (request.method === 'GET') {
    let record = await db.prepare('SELECT settings_json, rows_json, manual_entries_json, reported_weeks_json, contracts_json, sm_identity, sm_identity_history_json, last_sync, revision, updated_at FROM tracker_profiles WHERE profile_key = ?').bind(key).first();
    if (!record) record = await db.prepare('SELECT settings_json, rows_json, manual_entries_json, reported_weeks_json, contracts_json, sm_identity, sm_identity_history_json, last_sync, revision, updated_at FROM tracker_profiles WHERE profile_key = ?').bind(legacyKey).first();
    if (!record) return json({ ok: true, found: false, rows: [], manualEntries: [], reportedWeeks: [], contracts: [], smIdentity: '', smIdentityHistory: [], settings: null, revision: 0 });
    let settings = {}, rows = [], manualEntries = [], reportedWeeks = [], contracts = [], smIdentityHistory = [];
    try { settings = JSON.parse(record.settings_json || '{}'); } catch (error) {}
    try { rows = JSON.parse(record.rows_json || '[]'); } catch (error) {}
    try { manualEntries = JSON.parse(record.manual_entries_json || '[]'); } catch (error) {}
    try { reportedWeeks = JSON.parse(record.reported_weeks_json || '[]'); } catch (error) {}
    try { contracts = JSON.parse(record.contracts_json || '[]'); } catch (error) {}
    try { smIdentityHistory = JSON.parse(record.sm_identity_history_json || '[]'); } catch (error) {}
    const smIdentity = cleanIdentity(record.sm_identity || '');
    return json({ ok: true, found: true, settings: settings, rows: Array.isArray(rows) ? rows : [], manualEntries: Array.isArray(manualEntries) ? manualEntries : [], reportedWeeks: Array.isArray(reportedWeeks) ? reportedWeeks : [], contracts: Array.isArray(contracts) ? contracts : [], smIdentity: smIdentity, smIdentityHistory: normalizeIdentityHistory((Array.isArray(smIdentityHistory) ? smIdentityHistory : []).concat(smIdentity)), lastSync: record.last_sync || null, revision: Number(record.revision) || 0, updatedAt: record.updated_at || null });
  }

  if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed.' }, 405);
  let body;
  try { body = await request.json(); } catch (error) { return json({ ok: false, error: 'Invalid JSON body.' }, 400); }
  const settings = body && body.settings && typeof body.settings === 'object' ? body.settings : {};
  const rows = body && Array.isArray(body.rows) ? body.rows : [];
  const manualEntries = body && Array.isArray(body.manualEntries) ? body.manualEntries : [];
  const reportedWeeks = body && Array.isArray(body.reportedWeeks) ? body.reportedWeeks : [];
  const contracts = body && Array.isArray(body.contracts) ? body.contracts : [];
  const smIdentity = body && typeof body.smIdentity === 'string' ? cleanIdentity(body.smIdentity) : '';
  const requestedRevision = Number(body && body.baseRevision);
  let existingRecord = await db.prepare('SELECT profile_key, sm_identity, sm_identity_history_json, revision FROM tracker_profiles WHERE profile_key = ?').bind(key).first();
  if (!existingRecord) existingRecord = await db.prepare('SELECT profile_key, sm_identity, sm_identity_history_json, revision FROM tracker_profiles WHERE profile_key = ?').bind(legacyKey).first();
  const currentRevision = existingRecord ? Number(existingRecord.revision) || 0 : 0;
  if (Number.isFinite(requestedRevision) && requestedRevision !== currentRevision) {
    return json({ ok: false, code: 'SYNC_CONFLICT', error: 'The cloud copy changed before this save arrived. Refresh the dashboard before saving again.', revision: currentRevision }, 409);
  }
  let storedIdentityHistory = [];
  if (existingRecord) {
    try { storedIdentityHistory = JSON.parse(existingRecord.sm_identity_history_json || '[]'); } catch (error) {}
  }
  const smIdentityHistory = normalizeIdentityHistory(
    (Array.isArray(storedIdentityHistory) ? storedIdentityHistory : [])
      .concat(body && Array.isArray(body.smIdentityHistory) ? body.smIdentityHistory : [])
      .concat(smIdentity)
  );
  const allowedIdentities = smIdentityHistory;
  const realRows = rows.filter(function(row) { return !isSyntheticRow(row); });
  const rowIdentities = observedIdentities(realRows);
  if (realRows.length && !allowedIdentities.length) {
    return json({ ok: false, code: 'SM_IDENTITY_REQUIRED', error: 'SM worker identity is required before hourly rows can be saved.' }, 409);
  }
  if (realRows.length && allowedIdentities.length) {
    const invalid = realRows.some(function(row) {
      return !cleanIdentity(row && row.agent) || !allowedIdentities.some(function(identity) {
        return identitiesMatch(row.agent, identity);
      });
    });
    if (invalid) {
      return json({
        ok: false,
        code: 'SM_IDENTITY_MISMATCH',
        error: 'The SM hourly rows do not match the linked SM worker identity.',
        expectedIdentity: smIdentity,
        observedIdentities: rowIdentities
      }, 409);
    }
  }
  const rowsJson = JSON.stringify(rows);
  const manualEntriesJson = JSON.stringify(manualEntries);
  const reportedWeeksJson = JSON.stringify(reportedWeeks);
  const contractsJson = JSON.stringify(contracts);
  const smIdentityHistoryJson = JSON.stringify(smIdentityHistory);
  if (rowsJson.length > 2000000 || manualEntriesJson.length > 500000 || reportedWeeksJson.length > 200000 || contractsJson.length > 1000000 || smIdentityHistoryJson.length > 50000) return json({ ok: false, error: 'The saved tracker data is too large.' }, 413);
  const now = new Date().toISOString();
  const nextRevision = currentRevision + 1;
  await db.prepare('INSERT INTO tracker_profiles (profile_key, settings_json, rows_json, manual_entries_json, reported_weeks_json, contracts_json, sm_identity, sm_identity_history_json, last_sync, revision, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(profile_key) DO UPDATE SET settings_json = excluded.settings_json, rows_json = excluded.rows_json, manual_entries_json = excluded.manual_entries_json, reported_weeks_json = excluded.reported_weeks_json, contracts_json = excluded.contracts_json, sm_identity = excluded.sm_identity, sm_identity_history_json = excluded.sm_identity_history_json, last_sync = excluded.last_sync, revision = excluded.revision, updated_at = excluded.updated_at').bind(key, JSON.stringify(settings), rowsJson, manualEntriesJson, reportedWeeksJson, contractsJson, smIdentity, smIdentityHistoryJson, body && body.lastSync ? String(body.lastSync) : null, nextRevision, now).run();
  return json({ ok: true, saved: true, revision: nextRevision, updatedAt: now });
}
