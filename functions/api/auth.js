
const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };
const PASSWORD_ITERATIONS = 100000;

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

function randomHex(byteCount) {
  const bytes = new Uint8Array(byteCount);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
}

async function hash(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
}

function bytesFromHex(value) {
  const pairs = String(value || '').match(/.{1,2}/g) || [];
  return new Uint8Array(pairs.map(function(pair) { return parseInt(pair, 16); }));
}

async function passwordHash(password, saltHex) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: bytesFromHex(saltHex), iterations: PASSWORD_ITERATIONS, hash: 'SHA-256' },
    key,
    256
  );
  return Array.from(new Uint8Array(bits)).map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
}

function safeEqual(left, right) {
  const a = String(left || '');
  const b = String(right || '');
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    difference |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return difference === 0;
}

function cookies(request) {
  const result = {};
  (request.headers.get('Cookie') || '').split(';').forEach(function(part) {
    const i = part.indexOf('=');
    if (i > 0) result[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return result;
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase();
}

function usernameError(username) {
  if (!username) return 'Choose a username.';
  if (!/^[a-z0-9._-]{3,32}$/.test(username)) return 'Username must be 3–32 characters using letters, numbers, dot, underscore, or hyphen.';
  return '';
}

function publicUser(row) {
  return {
    id: row.id,
    email: row.email,
    name: row.name || '',
    picture: row.picture || '',
    username: row.username || '',
    authProvider: row.auth_provider === 'google' || String(row.id || '').indexOf('google:') === 0 ? 'google' : 'email',
    hasPassword: Boolean(row.password_hash && row.password_salt)
  };
}

async function ensureTables(db) {
  await db.batch([
    db.prepare('CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT, picture TEXT, username TEXT, auth_provider TEXT NOT NULL DEFAULT \'email\', password_salt TEXT, password_hash TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)'),
    db.prepare('CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at TEXT NOT NULL)'),
    db.prepare('CREATE TABLE IF NOT EXISTS tracker_profiles (profile_key TEXT PRIMARY KEY, settings_json TEXT NOT NULL DEFAULT \'{}\', rows_json TEXT NOT NULL DEFAULT \'[]\', manual_entries_json TEXT NOT NULL DEFAULT \'[]\', reported_weeks_json TEXT NOT NULL DEFAULT \'[]\', contracts_json TEXT NOT NULL DEFAULT \'[]\', sm_identity TEXT NOT NULL DEFAULT \'\', sm_identity_history_json TEXT NOT NULL DEFAULT \'[]\', last_sync TEXT, revision INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL)')
  ]);
  try { await db.prepare('ALTER TABLE users ADD COLUMN password_salt TEXT').run(); } catch (error) {}
  try { await db.prepare('ALTER TABLE users ADD COLUMN password_hash TEXT').run(); } catch (error) {}
  try { await db.prepare('ALTER TABLE users ADD COLUMN username TEXT').run(); } catch (error) {}
  try { await db.prepare("ALTER TABLE users ADD COLUMN auth_provider TEXT NOT NULL DEFAULT 'email'").run(); } catch (error) {}
  try { await db.prepare('ALTER TABLE tracker_profiles ADD COLUMN manual_entries_json TEXT NOT NULL DEFAULT \'[]\'').run(); } catch (error) {}
  try { await db.prepare('ALTER TABLE tracker_profiles ADD COLUMN reported_weeks_json TEXT NOT NULL DEFAULT \'[]\'').run(); } catch (error) {}
  try { await db.prepare('ALTER TABLE tracker_profiles ADD COLUMN contracts_json TEXT NOT NULL DEFAULT \'[]\'').run(); } catch (error) {}
  try { await db.prepare("ALTER TABLE tracker_profiles ADD COLUMN sm_identity TEXT NOT NULL DEFAULT ''").run(); } catch (error) {}
  try { await db.prepare("ALTER TABLE tracker_profiles ADD COLUMN sm_identity_history_json TEXT NOT NULL DEFAULT '[]'").run(); } catch (error) {}
  try { await db.prepare('ALTER TABLE tracker_profiles ADD COLUMN revision INTEGER NOT NULL DEFAULT 0').run(); } catch (error) {}
  try { await db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS users_username_unique ON users(username) WHERE username IS NOT NULL AND username <> ''").run(); } catch (error) {}
  try { await db.prepare("UPDATE users SET auth_provider = 'google' WHERE id LIKE 'google:%' AND (auth_provider IS NULL OR auth_provider = 'email')").run(); } catch (error) {}
}

async function currentUser(request, db) {
  const token = cookies(request).staffme_session;
  if (!token) return null;
  const tokenHash = await hash(token);
  const row = await db.prepare('SELECT u.id, u.email, u.name, u.picture, u.username, u.auth_provider, u.password_salt, u.password_hash FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?').bind(tokenHash, new Date().toISOString()).first();
  return row || null;
}

async function createSession(db, userId) {
  const session = randomToken();
  await db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').bind(await hash(session), userId, new Date(Date.now() + 30 * 86400000).toISOString()).run();
  return session;
}

function sessionCookie(token) {
  return 'staffme_session=' + encodeURIComponent(token) + '; Max-Age=2592000; Path=/; HttpOnly; Secure; SameSite=Lax';
}

function validateCredentials(email, password) {
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return 'Enter a valid email address.';
  if (password.length < 8) return 'Password must be at least 8 characters.';
  if (password.length > 256) return 'Password is too long.';
  return '';
}

async function register(request, db) {
  let body;
  try { body = await request.json(); } catch (error) { return json({ ok: false, error: 'Invalid request.' }, 400); }

  const email = normalizeEmail(body && body.email);
  const name = String(body && body.name || '').trim().slice(0, 120);
  const username = normalizeUsername(body && body.username);
  const password = String(body && body.password || '');
  const passwordConfirm = String(body && body.passwordConfirm || '');
  const validationError = validateCredentials(email, password);
  if (validationError) return json({ ok: false, error: validationError }, 400);
  if (!name) return json({ ok: false, error: 'Enter your name.' }, 400);
  const usernameValidation = usernameError(username);
  if (usernameValidation) return json({ ok: false, error: usernameValidation }, 400);
  if (password !== passwordConfirm) return json({ ok: false, error: 'Passwords do not match.' }, 400);

  const existing = await db.prepare('SELECT id, email, name, picture, username, auth_provider, password_salt, password_hash, created_at FROM users WHERE lower(email) = ?').bind(email).first();
  if (existing && existing.password_hash) return json({ ok: false, error: 'An account with this email already exists. Log in instead.' }, 409);
  if (existing && existing.username && normalizeUsername(existing.username) !== username) {
    return json({ ok: false, error: 'That account already has a different username. Log in instead.' }, 409);
  }

  const usernameOwner = await db.prepare('SELECT id FROM users WHERE lower(username) = ? LIMIT 1').bind(username).first();
  if (usernameOwner && (!existing || usernameOwner.id !== existing.id)) {
    return json({ ok: false, error: 'That username is already in use.' }, 409);
  }

  const now = new Date().toISOString();
  const userId = existing ? existing.id : 'email:' + await hash(email);
  const salt = randomHex(16);
  const derived = await passwordHash(password, salt);

  if (existing) {
    await db.prepare('UPDATE users SET name = ?, username = COALESCE(NULLIF(username, \'\'), ?), password_salt = ?, password_hash = ?, updated_at = ? WHERE id = ?').bind(name, username, salt, derived, now, userId).run();
  } else {
    await db.prepare('INSERT INTO users (id, email, name, picture, username, auth_provider, password_salt, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(userId, email, name, '', username, 'email', salt, derived, now, now).run();
  }

  const user = await db.prepare('SELECT id, email, name, picture, username, auth_provider, password_salt, password_hash FROM users WHERE id = ?').bind(userId).first();
  const session = await createSession(db, userId);
  return json({ ok: true, user: publicUser(user) }, 200, { 'Set-Cookie': sessionCookie(session) });
}

async function login(request, db) {
  let body;
  try { body = await request.json(); } catch (error) { return json({ ok: false, error: 'Invalid request.' }, 400); }

  const identifier = String(body && body.email || '').trim().toLowerCase();
  const password = String(body && body.password || '');
  if (!identifier || !password) return json({ ok: false, error: 'Enter your email or username and password.' }, 400);

  const user = await db.prepare('SELECT id, email, name, picture, username, auth_provider, password_salt, password_hash FROM users WHERE lower(email) = ? OR lower(username) = ? LIMIT 1').bind(identifier, identifier).first();
  if (!user || !user.password_hash || !user.password_salt) return json({ ok: false, error: 'Incorrect email/username or password.' }, 401);

  const derived = await passwordHash(password, user.password_salt);
  if (!safeEqual(derived, user.password_hash)) return json({ ok: false, error: 'Incorrect email/username or password.' }, 401);

  await db.prepare('UPDATE users SET updated_at = ? WHERE id = ?').bind(new Date().toISOString(), user.id).run();
  const session = await createSession(db, user.id);
  return json({ ok: true, user: publicUser(user) }, 200, { 'Set-Cookie': sessionCookie(session) });
}

async function accountSettings(request, db) {
  let body;
  try { body = await request.json(); } catch (error) { return json({ ok: false, error: 'Invalid request.' }, 400); }

  const sessionUser = await currentUser(request, db);
  if (!sessionUser) return json({ ok: false, error: 'You are not signed in.' }, 401);

  const current = await db.prepare('SELECT id, email, name, picture, username, auth_provider, password_salt, password_hash FROM users WHERE id = ?').bind(sessionUser.id).first();
  if (!current) return json({ ok: false, error: 'Account not found.' }, 404);

  const currentEmail = normalizeEmail(current.email);
  const requestedEmail = normalizeEmail(body && body.email) || currentEmail;
  const currentUsername = normalizeUsername(current.username);
  const hasUsernameField = body && Object.prototype.hasOwnProperty.call(body, 'username');
  const requestedUsername = hasUsernameField ? normalizeUsername(body.username) : currentUsername;
  const provider = current.auth_provider === 'google' || String(current.id || '').indexOf('google:') === 0 ? 'google' : 'email';
  const currentPassword = String(body && body.currentPassword || '');
  const newPassword = String(body && body.newPassword || '');
  const newPasswordConfirm = String(body && body.newPasswordConfirm || '');
  const changingPassword = Boolean(newPassword || newPasswordConfirm);
  const changingUsername = requestedUsername !== currentUsername;
  const changingEmail = requestedEmail !== currentEmail;

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(requestedEmail)) {
    return json({ ok: false, error: 'Enter a valid email address.' }, 400);
  }
  if (provider === 'google' && changingEmail) {
    return json({ ok: false, error: 'Google account email cannot be changed here.' }, 403);
  }
  if (currentUsername && changingUsername) {
    return json({ ok: false, error: 'Username cannot be changed after it is set.' }, 403);
  }
  if (!currentUsername && requestedUsername) {
    const usernameValidation = usernameError(requestedUsername);
    if (usernameValidation) return json({ ok: false, error: usernameValidation }, 400);
    const usernameOwner = await db.prepare('SELECT id FROM users WHERE lower(username) = ? LIMIT 1').bind(requestedUsername).first();
    if (usernameOwner && usernameOwner.id !== current.id) return json({ ok: false, error: 'That username is already in use.' }, 409);
  }
  if (changingPassword) {
    if (!newPassword || !newPasswordConfirm) return json({ ok: false, error: 'Enter and confirm the new password.' }, 400);
    if (newPassword.length < 8) return json({ ok: false, error: 'Password must be at least 8 characters.' }, 400);
    if (newPassword.length > 256) return json({ ok: false, error: 'Password is too long.' }, 400);
    if (newPassword !== newPasswordConfirm) return json({ ok: false, error: 'New passwords do not match.' }, 400);
  }
  if (provider === 'google' && !current.password_hash && ((changingUsername && !changingPassword) || (changingPassword && !requestedUsername))) {
    return json({ ok: false, error: 'Set a username and a password together to enable username/password login.' }, 400);
  }

  const needsCurrentPassword = Boolean(current.password_hash && current.password_salt && (changingEmail || changingUsername || changingPassword));
  if (needsCurrentPassword) {
    if (!currentPassword) return json({ ok: false, error: 'Enter your current password to change account credentials.' }, 400);
    const derived = await passwordHash(currentPassword, current.password_salt);
    if (!safeEqual(derived, current.password_hash)) return json({ ok: false, error: 'Current password is incorrect.' }, 401);
  }
  if (changingEmail) {
    if (!current.password_hash || !current.password_salt) return json({ ok: false, error: 'Set a password before changing your email.' }, 400);
    const emailOwner = await db.prepare('SELECT id FROM users WHERE lower(email) = ? LIMIT 1').bind(requestedEmail).first();
    if (emailOwner && emailOwner.id !== current.id) return json({ ok: false, error: 'That email is already in use.' }, 409);
  }

  const updates = [];
  const values = [];
  if (changingEmail) {
    updates.push('email = ?');
    values.push(requestedEmail);
  }
  if (changingUsername) {
    updates.push('username = ?');
    values.push(requestedUsername);
  }
  if (changingPassword) {
    const salt = randomHex(16);
    const derived = await passwordHash(newPassword, salt);
    updates.push('password_salt = ?', 'password_hash = ?');
    values.push(salt, derived);
  }
  if (!updates.length) return json({ ok: true, user: publicUser(current) });

  updates.push('updated_at = ?');
  values.push(new Date().toISOString(), current.id);
  await db.prepare('UPDATE users SET ' + updates.join(', ') + ' WHERE id = ?').bind(...values).run();

  const updated = await db.prepare('SELECT id, email, name, picture, username, auth_provider, password_salt, password_hash FROM users WHERE id = ?').bind(current.id).first();
  return json({ ok: true, user: publicUser(updated) });
}

async function googleLogin(request, db, env, url) {
  const error = url.searchParams.get('error');
  if (error) return redirect(url.origin + '/?auth=cancelled');

  const state = url.searchParams.get('state');
  if (!state || state !== cookies(request).oauth_state) return json({ ok: false, error: 'Invalid OAuth state.' }, 400);
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return json({ ok: false, error: 'Google sign-in is not configured yet. Email registration and login are available.' }, 503);

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
  const email = normalizeEmail(profile.email);
  if (!profile.sub || !email) return json({ ok: false, error: 'Google did not return an email.' }, 401);

  const existing = await db.prepare('SELECT id, auth_provider FROM users WHERE email = ?').bind(email).first();
  const userId = existing ? existing.id : 'google:' + profile.sub;
  const now = new Date().toISOString();

  if (existing) {
    await db.prepare('UPDATE users SET name = ?, picture = ?, updated_at = ? WHERE id = ?').bind(profile.name || '', profile.picture || '', now, userId).run();
  } else {
    await db.prepare('INSERT INTO users (id, email, name, picture, username, auth_provider, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(userId, email, profile.name || '', profile.picture || '', null, 'google', now, now).run();
  }

  const session = await createSession(db, userId);
  return redirect(url.origin + '/?auth=success', {
    'Set-Cookie': [
      sessionCookie(session),
      'oauth_state=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax'
    ]
  });
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

  if (mode === 'register' && request.method === 'POST') return register(request, db);
  if (mode === 'login' && request.method === 'POST') return login(request, db);
  if (mode === 'account' && request.method === 'POST') return accountSettings(request, db);

  if (mode === 'start') {
    if (!env.GOOGLE_CLIENT_ID) return json({ ok: false, error: 'Google sign-in is not configured yet. Use email registration or login.' }, 503);
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

  if (mode === 'callback') return googleLogin(request, db, env, url);

  if (mode === 'logout') {
    const token = cookies(request).staffme_session;
    if (token) await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await hash(token)).run();
    return json({ ok: true }, 200, { 'Set-Cookie': 'staffme_session=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax' });
  }

  const user = await currentUser(request, db);
  if (!user) return json({ ok: false, authenticated: false }, 401);
  return json({ ok: true, authenticated: true, user: publicUser(user) });
}
