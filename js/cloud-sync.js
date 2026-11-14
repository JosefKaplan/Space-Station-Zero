// Save sync to the owner's own Supabase project (CLAUDE.md rule 4, docs/SYNC.md). Plain `fetch`, no library, no DOM.
// Sign-in is password + TOTP; the database only accepts a session that passed the TOTP step (row-level security).
// Signed out, nothing here ever contacts anything.
import { SYNC_CONFIG } from './config.js';
import { qrDataUrl } from './qr.js';
import * as store from './state.js';

const SESSION_KEY = 'ssz-sync-session';
const PUSH_DELAY_MS = 1500;
const MIN_SECONDS_BETWEEN_PULLS = 20;
const REFRESH_BEFORE_EXPIRY_MS = 60_000;

const isSyncConfigured = () => Boolean(SYNC_CONFIG.supabaseUrl && SYNC_CONFIG.supabaseAnonKey);

// ---------- session ----------

// { accessToken, refreshToken, expiresAt (ms), email, userId, aal ('aal1' after the password, 'aal2' after the code),
//   verifiedFactorId } kept in this browser only
let session = null;
const statusListeners = [];
let status = { phase: 'idle', message: '', lastSyncedAt: null };

function setStatus(phase, message = '') {
  status = { phase, message, lastSyncedAt: phase === 'synced' ? Date.now() : status.lastSyncedAt };
  statusListeners.forEach((listener) => listener());
}

export const onSyncStatusChange = (listener) => statusListeners.push(listener);
export const getSyncStatus = () => ({ ...status, isConfigured: isSyncConfigured(), email: session?.email ?? null, isSignedIn: isReadyToSync() });

function decodeClaims(jwt) {
  const payload = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(decodeURIComponent([...atob(payload)].map((c) => `%${c.charCodeAt(0).toString(16).padStart(2, '0')}`).join('')));
}

function sessionFromTokens(tokens, previous = {}) {
  const claims = decodeClaims(tokens.access_token);
  const user = tokens.user ?? {};
  const verifiedFactor = (user.factors ?? []).find((factor) => factor.factor_type === 'totp' && factor.status === 'verified');
  return {
    accessToken: tokens.access_token, refreshToken: tokens.refresh_token,
    expiresAt: Date.now() + tokens.expires_in * 1000,
    email: user.email ?? previous.email ?? null, userId: claims.sub, aal: claims.aal ?? 'aal1',
    verifiedFactorId: verifiedFactor?.id ?? previous.verifiedFactorId ?? null,
  };
}

function keepSession(next) {
  session = next;
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

function forgetSession() {
  session = null;
  localStorage.removeItem(SESSION_KEY);
}

// only a session that passed the TOTP step may sync: that is what the database demands too
const isReadyToSync = () => session !== null && session.aal === 'aal2';

// ---------- plain requests ----------

async function request(path, { method = 'GET', body, token, headers = {} } = {}) {
  let response;
  try {
    response = await fetch(`${SYNC_CONFIG.supabaseUrl}${path}`, {
      method,
      headers: { apikey: SYNC_CONFIG.supabaseAnonKey, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error('Could not reach the sync server (offline?).');
  }
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* not JSON: the status below says enough */ }
  if (!response.ok) {
    const error = new Error(data?.msg ?? data?.message ?? data?.error_description ?? data?.error ?? `The sync server answered ${response.status}.`);
    error.status = response.status;
    throw error;
  }
  return data;
}

async function freshAccessToken() {
  if (session.expiresAt - Date.now() > REFRESH_BEFORE_EXPIRY_MS) return session.accessToken;
  try {
    const tokens = await request('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: session.refreshToken } });
    keepSession(sessionFromTokens(tokens, session));
  } catch (error) {
    if (error.status && error.status < 500) { forgetSession(); setStatus('signed-out', 'The sign-in expired: sign in again.'); }
    throw error;
  }
  return session.accessToken;
}

// ---------- signing in ----------

export function restoreSession() {
  if (!isSyncConfigured()) return;
  try {
    const saved = JSON.parse(localStorage.getItem(SESSION_KEY) ?? 'null');
    if (saved?.accessToken && saved?.refreshToken) {
      session = saved;
      setStatus(isReadyToSync() ? 'idle' : 'signed-out');
    }
  } catch {
    forgetSession();
  }
}

// step 1: email + password. Answers what comes next: 'code' (a TOTP is already enrolled) or 'enroll' (first time)
export async function signIn(email, password) {
  if (!isSyncConfigured()) throw new Error('Sync is not set up (js/config.js).');
  const tokens = await request('/auth/v1/token?grant_type=password', { method: 'POST', body: { email: email.trim(), password } });
  keepSession(sessionFromTokens(tokens));
  return { next: session.verifiedFactorId ? 'code' : 'enroll' };
}

// first time only: a new authenticator secret, shown once as a QR code and as text
export async function startEnrollment() {
  const token = await freshAccessToken();
  // a half-finished earlier attempt would block the name: clear unverified factors first
  const user = await request('/auth/v1/user', { token });
  for (const factor of user.factors ?? []) {
    if (factor.status !== 'verified') await request(`/auth/v1/factors/${factor.id}`, { method: 'DELETE', token });
  }
  const enrolled = await request('/auth/v1/factors', { method: 'POST', token, body: { factor_type: 'totp', friendly_name: `Captain's Log ${new Date().toISOString()}` } });
  // `uri` is the otpauth:// link an authenticator app reads. The QR is drawn here from it (js/qr.js) instead of trusting
  // an image from the server: Supabase's own image has come back in formats that do not display, or not at all.
  const issuer = encodeURIComponent("Captain's Log");
  const uri = typeof enrolled.totp.uri === 'string' && enrolled.totp.uri.startsWith('otpauth://totp/')
    ? enrolled.totp.uri
    : `otpauth://totp/${issuer}:${encodeURIComponent(session.email ?? 'owner')}?secret=${encodeURIComponent(enrolled.totp.secret)}&issuer=${issuer}`;
  return { factorId: enrolled.id, secret: enrolled.totp.secret, qrCode: qrDataUrl(uri), uri };
}

// step 2: the 6-digit code. For a first-time enrolment pass its factorId; otherwise the verified one is used.
export async function verifyCode(code, factorId = session?.verifiedFactorId) {
  const token = await freshAccessToken();
  const challenge = await request(`/auth/v1/factors/${factorId}/challenge`, { method: 'POST', token, body: {} });
  const tokens = await request(`/auth/v1/factors/${factorId}/verify`, { method: 'POST', token, body: { challenge_id: challenge.id, code: code.trim() } });
  keepSession({ ...sessionFromTokens(tokens, session), verifiedFactorId: factorId });
  if (!isReadyToSync()) throw new Error('The code was accepted but the sign-in is still not fully verified.');
  setStatus('idle');
}

export async function signOut() {
  if (session) {
    try { await request('/auth/v1/logout', { method: 'POST', token: session.accessToken }); } catch { /* the local sign-out is what matters */ }
  }
  forgetSession();
  setStatus('signed-out');
}

// ---------- syncing ----------

let isSyncing = false;
let lastPullAt = 0;
let pushTimer = null;

// pull what the cloud has, merge it (newest change wins), upload what is newer here. Returns the merge result so the
// app can re-render, or null when nothing was done.
export async function syncNow({ force = false } = {}) {
  if (!isReadyToSync() || isSyncing) return null;
  if (!force && Date.now() - lastPullAt < MIN_SECONDS_BETWEEN_PULLS * 1000) return null;
  isSyncing = true;
  setStatus('syncing');
  try {
    const token = await freshAccessToken();
    const rows = await request('/rest/v1/playthroughs?select=id,name,state,updated_at,deleted', { token });
    const merge = store.mergeRemotePlaythroughs(rows);
    const { rows: newer, tombstones } = store.rowsToUpload(new Map(rows.map((row) => [row.id, row.updated_at])));
    const upload = [...newer, ...tombstones].map((row) => ({ ...row, owner: session.userId }));
    if (upload.length) {
      await request('/rest/v1/playthroughs?on_conflict=owner,id', { method: 'POST', token, body: upload, headers: { Prefer: 'resolution=merge-duplicates,return=minimal' } });
    }
    store.forgetDeletionMarkers(store.pendingDeletionIds());
    lastPullAt = Date.now();
    setStatus('synced', merge.skipped.length ? `Skipped ${merge.skipped.length} damaged playthrough(s) from the cloud.` : '');
    return merge;
  } catch (error) {
    setStatus('error', error.message);
    return null;
  } finally {
    isSyncing = false;
  }
}

// after a change here: upload a moment later (several quick changes become one upload)
export function schedulePush(onDone = () => {}) {
  if (!isReadyToSync()) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(async () => { onDone(await syncNow({ force: true })); }, PUSH_DELAY_MS);
}

// ---------- private files (the book's text for the owner's own devices) ----------

const PRIVATE_FILES_PATH = '/rest/v1/private_files';

// { 'room-layouts': {...}, 'crew-rules': {...} } into the owner's database (docs/supabase-setup.sql, table private_files)
export async function uploadPrivateFiles(files) {
  if (!isReadyToSync()) throw new Error('Sign in to the sync first.');
  const token = await freshAccessToken();
  const rows = Object.entries(files).map(([name, data]) => ({ owner: session.userId, name, data, updated_at: Date.now() }));
  await request(`${PRIVATE_FILES_PATH}?on_conflict=owner,name`, { method: 'POST', token, body: rows, headers: { Prefer: 'resolution=merge-duplicates,return=minimal' } });
}

// the same object back, or null when not signed in
export async function downloadPrivateFiles() {
  if (!isReadyToSync()) return null;
  const token = await freshAccessToken();
  const rows = await request(`${PRIVATE_FILES_PATH}?select=name,data`, { token });
  return Object.fromEntries(rows.map((row) => [row.name, row.data]));
}
