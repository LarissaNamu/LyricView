const fs = require('node:fs');
const path = require('node:path');

const DEFAULTS = Object.freeze({
  position: { width: 760, height: 240 }, fontSize: 32,
  fontFamily: 'Segoe UI', currentColor: '#ffffff', otherColor: '#b6bbc9',
  opacity: 1, linesShown: 3, clickThrough: false, alwaysOnTop: true,
  backdropColor: '#000000', backdropStrength: 0.22,
  hotkey: 'CommandOrControl+Shift+L', spotifyClientId: ''
});

function sanitizeSettings(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) input = {};
  const out = structuredClone(DEFAULTS);
  for (const key of ['currentColor', 'otherColor', 'backdropColor']) {
    if (/^#[0-9a-f]{6}$/i.test(input[key])) out[key] = input[key];
  }
  for (const [key, min, max] of [['fontSize', 12, 72], ['opacity', 0.15, 1], ['backdropStrength', 0, 1]]) {
    if (Number.isFinite(input[key])) out[key] = Math.min(max, Math.max(min, input[key]));
  }
  if (['Segoe UI', 'Arial', 'Georgia', 'Verdana', 'monospace'].includes(input.fontFamily)) out.fontFamily = input.fontFamily;
  if ([1, 3, 5].includes(input.linesShown)) out.linesShown = input.linesShown;
  for (const key of ['clickThrough']) if (typeof input[key] === 'boolean') out[key] = input[key];
  if (typeof input.hotkey === 'string' && input.hotkey.length > 0 && input.hotkey.length < 100) out.hotkey = input.hotkey;
  if (typeof input.spotifyClientId === 'string' && /^[a-f0-9]{32}$/i.test(input.spotifyClientId.trim())) out.spotifyClientId = input.spotifyClientId.trim();
  if (input.position && typeof input.position === 'object') {
    for (const key of ['x', 'y', 'width', 'height']) if (Number.isFinite(input.position[key])) out.position[key] = Math.round(input.position[key]);
    out.position.width = Math.min(16000, Math.max(80, out.position.width));
    out.position.height = Math.min(16000, Math.max(80, out.position.height));
  }
  return out;
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') console.warn(`Could not read ${path.basename(file)}; using defaults.`); return fallback; }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(`${file}.tmp`, file);
}

class Store {
  constructor(directory) { this.directory = directory; this.file = path.join(directory, 'settings.json'); this.settings = sanitizeSettings(readJson(this.file, {})); }
  update(patch) { this.settings = sanitizeSettings({ ...this.settings, ...patch }); writeJson(this.file, this.settings); return this.settings; }
  reset() { return this.update({ ...structuredClone(DEFAULTS), spotifyClientId: this.settings.spotifyClientId }); }
}

function lockedHitTest(bounds, gear, cursor) {
  const x = cursor.x - bounds.x, y = cursor.y - bounds.y;
  return { hovered: x >= 0 && y >= 0 && x < bounds.width && y < bounds.height,
    gearHovered: Boolean(gear && x >= gear.x && y >= gear.y && x < gear.x + gear.width && y < gear.y + gear.height) };
}

function fitBounds(saved, displays) {
  const target = displays.find(d => Number.isFinite(saved.x) && Number.isFinite(saved.y) && saved.x < d.x + d.width && saved.y < d.y + d.height && saved.x + saved.width > d.x && saved.y + saved.height > d.y) || displays[0];
  const width = Math.min(saved.width, target.width), height = Math.min(saved.height, target.height);
  return { width, height, x: Math.round(Math.max(target.x, Math.min(saved.x ?? target.x + (target.width - width) / 2, target.x + target.width - width))), y: Math.round(Math.max(target.y, Math.min(saved.y ?? target.y + target.height - height - 60, target.y + target.height - height))) };
}

module.exports = { Store, DEFAULTS, sanitizeSettings, readJson, writeJson, fitBounds, lockedHitTest };
