const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const REDIRECT_URI = 'http://127.0.0.1:43821/callback';
const SCOPES = 'user-read-currently-playing user-read-playback-state';
function pkce() {
  const verifier = crypto.randomBytes(48).toString('base64url');
  return { verifier, challenge: crypto.createHash('sha256').update(verifier).digest('base64url'), state: crypto.randomBytes(24).toString('hex') };
}
class SpotifyError extends Error {
  constructor(message, status, retryAfter = 0) { super(message); this.status = status; this.retryAfter = retryAfter; }
}

class Spotify {
  constructor({ directory, safeStorage, openExternal, getClientId, fetcher = fetch }) {
    this.file = path.join(directory, 'spotify-token.bin'); this.safeStorage = safeStorage;
    this.openExternal = openExternal; this.getClientId = getClientId; this.fetch = fetcher;
    this.accessToken = null; this.refreshToken = null; this.expires = 0; this.pending = null; this.generation = 0;
  }
  storageAvailable() {
    return this.safeStorage.isEncryptionAvailable() && !(process.platform === 'linux' && this.safeStorage.getSelectedStorageBackend() === 'basic_text');
  }
  restore() {
    if (!this.storageAvailable()) return false;
    try {
      const saved = JSON.parse(this.safeStorage.decryptString(fs.readFileSync(this.file)));
      if (saved.clientId !== this.getClientId()) return false;
      this.refreshToken = saved.refreshToken; return Boolean(this.refreshToken);
    } catch { return false; }
  }
  saveToken(token, generation) {
    if (generation !== this.generation) throw new Error('Sign-in was canceled.');
    if (!token.access_token || !Number.isFinite(token.expires_in)) throw new Error('Spotify returned an invalid token.');
    const refreshToken = token.refresh_token || this.refreshToken;
    if (!refreshToken) throw new Error('Spotify did not return a refresh token. Please sign in again.');
    const encrypted = this.safeStorage.encryptString(JSON.stringify({ clientId: this.getClientId(), refreshToken }));
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(`${this.file}.tmp`, encrypted, { mode: 0o600 }); fs.renameSync(`${this.file}.tmp`, this.file);
    this.accessToken = token.access_token; this.refreshToken = refreshToken;
    this.expires = Date.now() + token.expires_in * 1000 - 60000;
  }
  async exchange(parameters, generation) {
    const response = await this.fetch('https://accounts.spotify.com/api/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: this.getClientId(), ...parameters }), signal: AbortSignal.timeout(15000) });
    if (!response.ok) {
      if (response.status === 400 && parameters.grant_type === 'refresh_token' && generation === this.generation) this.logout();
      throw new SpotifyError('Spotify sign-in could not be completed. Check your Client ID and redirect URI.', response.status);
    }
    this.saveToken(await response.json(), generation);
  }
  async login() {
    if (this.pending) throw new Error('A Spotify sign-in is already open in your browser.');
    if (!/^[a-f0-9]{32}$/i.test(this.getClientId())) throw new Error('Enter your Spotify Client ID in Settings first.');
    if (!this.storageAvailable()) throw new Error('Secure token storage is unavailable. Enable your operating system credential store.');
    const proof = pkce(), generation = this.generation;
    const params = new URLSearchParams({ client_id: this.getClientId(), response_type: 'code', redirect_uri: REDIRECT_URI, scope: SCOPES, code_challenge_method: 'S256', code_challenge: proof.challenge, state: proof.state });
    await new Promise((resolve, reject) => {
      let timer, settled = false, processing = false;
      const server = http.createServer(async (req, res) => {
        const url = new URL(req.url, REDIRECT_URI);
        if (url.pathname !== '/callback') { res.writeHead(404); res.end(); return; }
        if (url.searchParams.get('state') !== proof.state) { res.writeHead(400); res.end('Invalid sign-in state.'); return; }
        const code = url.searchParams.get('code');
        if (processing) { res.writeHead(409); res.end('Sign-in is already being processed.'); return; }
        if (!code || url.searchParams.has('error')) { res.writeHead(400); res.end('Sign-in canceled. Return to LyricView.'); finish(new Error('Spotify sign-in canceled.')); return; }
        // Stop accepting callbacks before exchanging the one-use code.
        processing = true; server.close();
        try {
          await this.exchange({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI, code_verifier: proof.verifier }, generation);
          res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Connected! You can close this tab and return to LyricView.'); finish();
        } catch (error) { res.writeHead(400); res.end('Sign-in failed. Return to LyricView to try again.'); finish(error); }
      });
      const finish = error => {
        if (settled) return;
        settled = true; clearTimeout(timer); server.close(); this.pending = null;
        if (error) { if (generation === this.generation) this.generation++; reject(error); } else resolve();
      };
      this.pending = () => finish(new Error('Spotify sign-in canceled.'));
      server.on('error', () => finish(new Error('Cannot open the Spotify callback port (43821). Close the app using that port and retry.')));
      server.listen(43821, '127.0.0.1', async () => {
        timer = setTimeout(() => finish(new Error('Spotify sign-in timed out. Please try again.')), 180000);
        try { await this.openExternal(`https://accounts.spotify.com/authorize?${params}`); } catch { finish(new Error('Could not open your browser.')); }
      });
    });
  }
  async token() {
    if (this.accessToken && Date.now() < this.expires) return this.accessToken;
    if (!this.refreshToken) throw new SpotifyError('Connect Spotify to get started.', 401);
    if (!this.refreshing) {
      this.refreshing = this.exchange({ grant_type: 'refresh_token', refresh_token: this.refreshToken }, this.generation).finally(() => { this.refreshing = null; });
    }
    await this.refreshing; return this.accessToken;
  }
  async currentlyPlaying(retry = true) {
    const token = await this.token();
    const response = await this.fetch('https://api.spotify.com/v1/me/player/currently-playing', { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(12000) });
    if (response.status === 204) return null;
    if (response.status === 401 && retry) { this.expires = 0; return this.currentlyPlaying(false); }
    if (!response.ok) throw new SpotifyError(response.status === 403 ? 'Spotify access denied. Check Premium and the app user allowlist.' : response.status === 429 ? 'Spotify is limiting requests. Retrying shortly.' : 'Reconnecting to Spotify...', response.status, Number(response.headers.get('Retry-After')) || 0);
    return response.json();
  }
  logout() {
    this.generation++; this.pending?.(); this.accessToken = null; this.refreshToken = null; this.expires = 0;
    try { fs.unlinkSync(this.file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  close() { this.generation++; this.pending?.(); }
}
module.exports = { Spotify, SpotifyError, REDIRECT_URI, SCOPES, pkce };
