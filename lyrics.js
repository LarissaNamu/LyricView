const path = require('node:path');
const { readJson, writeJson } = require('./store');
const { parseLrc } = require('./sync');

class Lyrics {
  constructor(directory, fetcher = fetch) { this.file = path.join(directory, 'lyrics-cache.json'); this.cache = readJson(this.file, {}); this.fetch = fetcher; }
  async get(track) {
    const cached = this.cache[track.id];
    if (cached && Date.now() - cached.savedAt < 7 * 86400000) return cached.value;
    const query = new URLSearchParams({ track_name: track.name, artist_name: track.artists.map(a => a.name).join(', '), album_name: track.album.name, duration: String(Math.round(track.duration_ms / 1000)) });
    const response = await this.fetch(`https://lrclib.net/api/get?${query}`, { headers: { 'User-Agent': 'LyricView/1.0.0 (https://github.com/LarissaNamu/LyricView)' }, signal: AbortSignal.timeout(12000) });
    if (response.status === 404) return { kind: 'missing', lines: [], plain: '' };
    if (!response.ok) throw new Error(response.status === 429 ? 'Lyrics service is busy. Please try again shortly.' : 'Could not reach the lyrics service.');
    const data = await response.json();
    const lines = parseLrc(data.syncedLyrics || '');
    const value = { kind: data.instrumental ? 'instrumental' : lines.length ? 'synced' : data.plainLyrics ? 'plain' : 'missing', lines, plain: data.plainLyrics || '' };
    this.cache[track.id] = { savedAt: Date.now(), value };
    const entries = Object.entries(this.cache).sort((a, b) => b[1].savedAt - a[1].savedAt).slice(0, 200);
    this.cache = Object.fromEntries(entries);
    writeJson(this.file, this.cache);
    return value;
  }
}
module.exports = { Lyrics };
