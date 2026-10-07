const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseLrc, currentLine, positionAt } = require('../sync');
const { Store, sanitizeSettings, fitBounds, lockedHitTest } = require('../store');
const { Lyrics } = require('../lyrics');
const { Spotify, pkce } = require('../spotify');
function directory(t) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lyricview-test-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; }
test('LRC handles fractional seconds, multiple timestamps, sorting, offsets and empty instrumental gaps', () => {
  const lines = parseLrc('[ar:Example]\n[offset:-100]\n[00:10.5][00:20.050]One\n[00:02.123]Two\n[00:30.00]');
  assert.deepEqual(lines, [{ time: 2023, text: 'Two' }, { time: 10400, text: 'One' }, { time: 19950, text: 'One' }, { time: 29900, text: '' }]);
});
test('line lookup works before first line, on boundaries, after seeking backwards and at the end', () => {
  const lines = [{ time: 1000 }, { time: 2000 }, { time: 3000 }];
  assert.equal(currentLine(lines, 999), -1); assert.equal(currentLine(lines, 2000), 1);
  assert.equal(currentLine(lines, 1100), 0); assert.equal(currentLine(lines, 9000), 2); assert.equal(currentLine([], 0), -1);
});
test('playback interpolation freezes on pause and stays within track duration', () => {
  assert.equal(positionAt({ progress_ms: 2000, duration_ms: 4000, is_playing: false }, 1000), 2000);
  assert.equal(positionAt({ progress_ms: 2000, duration_ms: 4000, is_playing: true }, 3000), 4000);
});
test('settings reject untrusted styles and constrain numeric values', () => {
  const result = sanitizeSettings({ fontFamily: 'bad; injection', currentColor: 'red', fontSize: 999, opacity: -1, linesShown: 7, position: { width: 10, height: 900 } });
  assert.equal(result.fontFamily, 'Segoe UI'); assert.equal(result.currentColor, '#ffffff'); assert.equal(result.fontSize, 72); assert.equal(result.opacity, .15); assert.equal(result.linesShown, 3); assert.equal(result.position.width, 80);
});
test('settings survive restart and reset preserves the Spotify Client ID', t => {
  const dir = directory(t), store = new Store(dir), clientId = 'a'.repeat(32);
  store.update({ fontSize: 48, spotifyClientId: clientId });
  assert.equal(new Store(dir).settings.fontSize, 48); store.reset(); assert.equal(store.settings.spotifyClientId, clientId);
});
test('disconnected monitor positions recover inside the primary work area', () => {
  const area = { x: 0, y: 0, width: 1280, height: 720 };
  const result = fitBounds({ x: 3000, y: -500, width: 760, height: 240 }, [area]);
  assert.ok(result.x >= 0 && result.x + result.width <= 1280); assert.ok(result.y >= 0 && result.y + result.height <= 720);
});
const track = { id: 'test', name: 'Song', artists: [{ name: 'Artist' }], album: { name: 'Album' }, duration_ms: 120000 };
test('gaming mode defaults on, persists and rejects invalid preferences', t => {
  assert.equal(sanitizeSettings({}).gamingMode, true);
  assert.equal(sanitizeSettings({ gamingMode: 'false' }).gamingMode, true);
  const dir = directory(t), store = new Store(dir);
  store.update({ gamingMode: false }); assert.equal(new Store(dir).settings.gamingMode, false);
});
test('both window modes always stay on top, including older saved preferences', () => {
  assert.equal(sanitizeSettings({ alwaysOnTop: false, clickThrough: true }).alwaysOnTop, true);
  assert.equal(sanitizeSettings({ alwaysOnTop: false, clickThrough: false }).alwaysOnTop, true);
});

test('user dimensions persist and font changes leave them untouched', t => {
  const dir = directory(t), store = new Store(dir);
  store.update({ position: { x: 800, y: 400, width: 210, height: 110 } });
  for (const fontSize of [72, 12, 32]) store.update({ fontSize });
  assert.deepEqual(new Store(dir).settings.position, { x: 800, y: 400, width: 210, height: 110 });
});
test('locked hit testing only enables clicks inside the settings button at screen-scaled coordinates', () => {
  const bounds = { x: -800, y: 200, width: 760, height: 240 }, gear = { x: 712, y: 8, width: 40, height: 40 };
  assert.deepEqual(lockedHitTest(bounds, gear, { x: -400, y: 300 }), { hovered: true, gearHovered: false });
  assert.deepEqual(lockedHitTest(bounds, gear, { x: -80, y: 220 }), { hovered: true, gearHovered: true });
  assert.deepEqual(lockedHitTest(bounds, gear, { x: 0, y: 0 }), { hovered: false, gearHovered: false });
});
test('backdrop upgrades existing settings and rejects invalid colors and strength', () => {
  const defaults = sanitizeSettings({ fontSize: 40 });
  assert.equal(defaults.backdropColor, '#000000'); assert.equal(defaults.backdropStrength, .22);
  const invalid = sanitizeSettings({ backdropColor: 'url(bad)', backdropStrength: Infinity });
  assert.equal(invalid.backdropColor, '#000000'); assert.equal(invalid.backdropStrength, .22);
  assert.equal(sanitizeSettings({ backdropStrength: -1 }).backdropStrength, 0);
  assert.equal(sanitizeSettings({ backdropStrength: 2 }).backdropStrength, 1);
});
test('backdrop color and strength survive restart independently of text opacity', t => {
  const dir = directory(t), store = new Store(dir);
  store.update({ backdropColor: '#224466', backdropStrength: .5, opacity: .75 });
  const reopened = new Store(dir).settings;
  assert.equal(reopened.backdropColor, '#224466'); assert.equal(reopened.backdropStrength, .5); assert.equal(reopened.opacity, .75);
  store.update({ backdropStrength: 0 }); assert.equal(new Store(dir).settings.backdropStrength, 0);
});
test('custom dimensions support narrow and tall windows and constrain invalid sizes', () => {
  assert.deepEqual(sanitizeSettings({ position: { width: 120, height: 1200 } }).position, { width: 120, height: 1200 });
  assert.deepEqual(sanitizeSettings({ position: { width: -1, height: Infinity } }).position, { width: 80, height: 240 });
});
test('lyrics requests include matching metadata and cached results survive restart', async t => {
  const dir = directory(t); let calls = 0;
  const fetcher = async url => { calls++; const q = new URL(url).searchParams; assert.equal(q.get('duration'), '120'); assert.equal(q.get('track_name'), 'Song'); return Response.json({ syncedLyrics: '[00:01.00]Original test line' }); };
  const provider = new Lyrics(dir, fetcher); assert.equal((await provider.get(track)).kind, 'synced');
  await new Lyrics(dir, fetcher).get(track); assert.equal(calls, 1);
});
test('lyrics have plain, missing and instrumental fallbacks', async t => {
  const dir = directory(t);
  for (const [data, kind] of [[{ plainLyrics: 'Original test text' }, 'plain'], [{ instrumental: true }, 'instrumental']]) {
    const provider = new Lyrics(dir, async () => Response.json(data)); provider.cache = {};
    assert.equal((await provider.get(track)).kind, kind);
  }
  const missing = new Lyrics(dir, async () => new Response('', { status: 404 })); missing.cache = {};
  assert.equal((await missing.get(track)).kind, 'missing');
});
test('lyrics transient errors do not become permanent missing results', async t => {
  const provider = new Lyrics(directory(t), async () => new Response('', { status: 503 }));
  await assert.rejects(() => provider.get(track), /lyrics service/); assert.equal(provider.cache.test, undefined);
});
test('PKCE challenge matches the verifier hash and states are unique', () => {
  const crypto = require('node:crypto'), proof = pkce();
  assert.equal(proof.challenge, crypto.createHash('sha256').update(proof.verifier).digest('base64url')); assert.notEqual(proof.state, pkce().state);
});
function spotifyFor(t, fetcher) {
  return new Spotify({ directory: directory(t), getClientId: () => 'a'.repeat(32), openExternal: async () => {}, safeStorage: { isEncryptionAvailable: () => true, encryptString: text => Buffer.from(text), decryptString: buffer => buffer.toString(), getSelectedStorageBackend: () => 'test' }, fetcher });
}
test('refresh token persists, restores and logout deletes it without storing the access token', t => {
  const spotify = spotifyFor(t); spotify.saveToken({ access_token: 'access', refresh_token: 'refresh', expires_in: 3600 }, 0);
  const saved = JSON.parse(fs.readFileSync(spotify.file, 'utf8')); assert.equal(saved.refreshToken, 'refresh'); assert.equal(saved.accessToken, undefined);
  spotify.refreshToken = null; assert.equal(spotify.restore(), true); spotify.logout(); assert.equal(fs.existsSync(spotify.file), false);
});
test('a response arriving after logout cannot restore authentication', t => {
  const spotify = spotifyFor(t); spotify.logout();
  assert.throws(() => spotify.saveToken({ access_token: 'access', refresh_token: 'refresh', expires_in: 3600 }, 0), /canceled/);
  assert.equal(fs.existsSync(spotify.file), false);
});
test('concurrent API requests share one refresh request', async t => {
  let calls = 0;
  const spotify = spotifyFor(t, async () => { calls++; await new Promise(resolve => setTimeout(resolve, 5)); return Response.json({ access_token: 'access', expires_in: 3600 }); });
  spotify.refreshToken = 'refresh'; assert.deepEqual(await Promise.all([spotify.token(), spotify.token()]), ['access', 'access']); assert.equal(calls, 1);
});
test('Spotify rate limit includes retry delay and no-content means nothing playing', async t => {
  const spotify = spotifyFor(t, async () => new Response('', { status: 429, headers: { 'Retry-After': '20' } }));
  spotify.accessToken = 'access'; spotify.expires = Date.now() + 60000;
  await assert.rejects(() => spotify.currentlyPlaying(), error => error.status === 429 && error.retryAfter === 20);
  spotify.fetch = async () => new Response(null, { status: 204 }); assert.equal(await spotify.currentlyPlaying(), null);
});
