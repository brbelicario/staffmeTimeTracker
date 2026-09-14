const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };

function json(data, status, extraHeaders) {
  const headers = new Headers(JSON_HEADERS);
  Object.entries(extraHeaders || {}).forEach(function(entry) { headers.set(entry[0], entry[1]); });
  return new Response(JSON.stringify(data), { status: status || 200, headers: headers });
}

function redirect(url, headers) {
  const h = new Headers();
  Object.entries(headers || {}).forEach(function(entry) {
    const key = entry[0];
    const value = entry[1];
    if (Array.isArray(value)) value.forEach(function(item) { h.append(key, item); });
    else h.set(key, value);
  });
  h.set('Location', url);
  return new Response(null, { status: 302, headers: h });
}

function randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
}

async function hash(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
}

function cookies(request) {
  const result = {};
  (request.headers.get('Cookie') || '').split(';').forEach(function(part) {
    const i = part.indexOf('=');
    if (i > 0) result[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return result;
}

async function ensureTables(db) {
  await db.batch([
    db.prepare('CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT, picture TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)'),
    db.prepare('CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at TEXT NOT NULL)'),
    db.prepare('CREATE TABLE IF NOT EXISTS tracker_profiles (profile_key TEXT PRIMARY KEY, settings_json TEXT NOT NULL DEFAULT \'{}\', rows_json TEXT NOT NULL DEFAULT \'[]\', last_sync TEXT, updated_at TEXT NOT NULL)')
  ]);
}

async function currentUser(request, db) {
  const token = cookies(request).staffme_session;
  if (!token) return null;
  const tokenHash = await hash(token);
  const row = await db.prepare('SELECT u.id, u.email, u.name, u.picture FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?').bind(tokenHash, new Date().toISOString()).first();
  return row || null;
}

export async function onRequest(context) {
  const request = context.request;
  const env = context.env;
  const db = env.DB || env.db;
  const url = new URL(request.url);
  const mode = url.searchParams.get('mode') || 'me';
  if (request.method === 'OPTIONS') return json({}, 204);
  if (!db) return json({ ok: false, error: 'D1 binding is missing.' }, 503);
  await ensureTables(db);

  if (mode === 'start') {
    if (!env.GOOGLE_CLIENT_ID) return json({ ok: false, error: 'GOOGLE_CLIENT_ID is not configured.' }, 503);
    const state = randomToken();
    const redirectUri = env.GOOGLE_REDIRECT_URI || url.origin + '/api/auth?mode=callback';
    const params = new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      access_type: 'offline',
      prompt: 'select_account',
      state: state
    });
    return redirect('https://accounts.google.com/o/oauth2/v2/auth?' + params.toString(), {
      'Set-Cookie': 'oauth_state=' + encodeURIComponent(state) + '; Max-Age=600; Path=/; HttpOnly; Secure; SameSite=Lax'
    });
  }

  if (mode === 'callback') {
    const error = url.searchParams.get('error');
    if (error) return redirect(url.origin + '/?auth=cancelled');
    const state = url.searchParams.get('state');
    if (!state || state !== cookies(request).oauth_state) return json({ ok: false, error: 'Invalid OAuth state.' }, 400);
    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return json({ ok: false, error: 'Google OAuth secrets are not configured.' }, 503);
    const redirectUri = env.GOOGLE_REDIRECT_URI || url.origin + '/api/auth?mode=callback';
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: url.searchParams.get('code') || '',
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code'
      })
    });
    if (!tokenResponse.ok) return json({ ok: false, error: 'Google token exchange failed.' }, 401);
    const tokens = await tokenResponse.json();
    const profileResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: 'Bearer ' + tokens.access_token }
    });
    if (!profileResponse.ok) return json({ ok: false, error: 'Google profile lookup failed.' }, 401);
    const profile = await profileResponse.json();
    if (!profile.sub || !profile.email) return json({ ok: false, error: 'Google did not return an email.' }, 401);

    const userId = 'google:' + profile.sub;
    const now = new Date().toISOString();
    await db.prepare('INSERT INTO users (id, email, name, picture, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET email = excluded.email, name = excluded.name, picture = excluded.picture, updated_at = excluded.updated_at').bind(userId, String(profile.email).toLowerCase(), profile.name || '', profile.picture || '', now, now).run();
    const session = randomToken();
    await db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').bind(await hash(session), userId, new Date(Date.now() + 30 * 86400000).toISOString()).run();
    return redirect(url.origin + '/?auth=success', {
      'Set-Cookie': [
        'staffme_session=' + encodeURIComponent(session) + '; Max-Age=2592000; Path=/; HttpOnly; Secure; SameSite=Lax',
        'oauth_state=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax'
      ]
    });
  }

  if (mode === 'logout') {
    const token = cookies(request).staffme_session;
    if (token) await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await hash(token)).run();
    return json({ ok: true }, 200, { 'Set-Cookie': 'staffme_session=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax' });
  }

  const user = await currentUser(request, db);
  if (!user) return json({ ok: false, authenticated: false }, 401);
  return json({ ok: true, authenticated: true, user: user });
}
