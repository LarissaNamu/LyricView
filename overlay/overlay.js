let state, anchor = performance.now(), layer, layerTrack, renderedIndex, layoutKey;
let rows = new Map(), hideRevision = 0;
const area = document.querySelector('#lyrics'), welcome = document.querySelector('#welcome'), message = document.querySelector('#message');
const connect = document.querySelector('#connect');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
function animate(element, frames, duration, complete) {
  if (reducedMotion.matches) { complete?.(); return; }
  const animation = element.animate(frames, { duration, easing: 'cubic-bezier(.22,.68,.25,1)' });
  animation.finished.then(() => complete?.()).catch(() => {});
}
function receive(next) {
  state = next; anchor = performance.now() - next.elapsed_ms;
  const s = next.settings, root = document.documentElement.style;
  root.setProperty('--font-size', `${s.fontSize}px`); root.setProperty('--font-family', s.fontFamily);
  root.setProperty('--current-color', s.currentColor); root.setProperty('--other-color', s.otherColor); root.setProperty('--opacity', s.opacity);
  const rgb = s.backdropColor.match(/[a-f0-9]{2}/gi).map(channel => parseInt(channel, 16));
  root.setProperty('--backdrop-fill', `rgba(${rgb.join(', ')}, ${s.backdropStrength})`);
  document.body.classList.toggle('locked', s.clickThrough);
  if (!s.clickThrough) document.querySelector('#overlay').classList.remove('locked-hover');
  document.querySelector('#demoBadge').hidden = !next.demo;
  render();
}
function fadeAway() {
  if (!layer) { if (!area.firstElementChild) { area.hidden = true; welcome.hidden = false; } return; }
  const previous = layer, revision = ++hideRevision;
  layer = null; layerTrack = null; rows = new Map(); renderedIndex = undefined;
  const opacity = getComputedStyle(previous).opacity;
  previous.getAnimations().forEach(animation => animation.cancel());
  animate(previous, [{ opacity }, { opacity: 0 }], 180, () => {
    previous.remove();
    if (revision === hideRevision && !layer) { area.hidden = true; welcome.hidden = false; }
  });
}
function newLayer(track, kind) {
  ++hideRevision;
  const previous = layer;
  layer = document.createElement('div'); layer.className = `lyric-layer ${kind}`;
  layerTrack = track; rows = new Map(); renderedIndex = undefined; layoutKey = '';
  area.append(layer); area.hidden = false;
  if (previous) {
    previous.setAttribute('aria-hidden', 'true');
    const opacity = getComputedStyle(previous).opacity;
    previous.getAnimations().forEach(animation => animation.cancel());
    animate(previous, [{ opacity }, { opacity: 0 }], 200, () => previous.remove());
  }
  animate(layer, [{ opacity: 0 }, { opacity: 1 }], 240);
}
function renderRows(data, index) {
  const s = state.settings, key = `${s.linesShown}:${s.fontSize}:${s.fontFamily}:${area.clientWidth}:${area.clientHeight}`;
  if (renderedIndex === index && layoutKey === key) return;
  const slide = layoutKey === key && renderedIndex !== undefined && Math.abs(index - renderedIndex) === 1;
  const delta = slide ? index - renderedIndex : 0;
  const radius = (s.linesShown - 1) / 2, nextRows = new Map(), entries = [];
  for (let offset = -radius; offset <= radius; offset++) {
    const rowIndex = index + offset;
    let node = rows.get(rowIndex);
    const oldTop = node ? parseFloat(node.style.top) : undefined;
    if (!node) { node = document.createElement('div'); layer.append(node); }
    node.getAnimations().forEach(animation => animation.cancel());
    node.className = `line${offset === 0 ? ' current' : ''}`;
    node.textContent = index === -1 ? (offset === 0 ? '♪' : offset > 0 ? data.lines[offset - 1]?.text || '' : '') : data.lines[rowIndex]?.text || (offset === 0 ? '♪' : '');
    node.style.height = ''; node.style.minHeight = `${s.fontSize * (offset === 0 ? 1 : .73) * 1.4}px`;
    const height = node.getBoundingClientRect().height;
    entries.push({ node, height, oldTop }); nextRows.set(rowIndex, node);
  }
  // Center the current lyric and stack surrounding rows by their wrapped heights.
  entries[radius].top = Math.max(0, (area.clientHeight - entries[radius].height) / 2);
  for (let i = radius - 1; i >= 0; i--) entries[i].top = entries[i + 1].top - entries[i].height;
  for (let i = radius + 1; i < entries.length; i++) entries[i].top = entries[i - 1].top + entries[i - 1].height;
  for (const { node, height, oldTop, top } of entries) {
    node.style.top = `${top}px`;
    if (slide) animate(node, [{ transform: `translateY(${(oldTop ?? top + delta * height) - top}px)`, opacity: oldTop === undefined ? 0 : 1 }, { transform: 'translateY(0)', opacity: 1 }], 300);
  }
  for (const [rowIndex, node] of rows) {
    if (nextRows.has(rowIndex)) continue;
    node.getAnimations().forEach(animation => animation.cancel());
    if (slide) animate(node, [{ transform: 'translateY(0)', opacity: 1 }, { transform: `translateY(${-delta * node.getBoundingClientRect().height}px)`, opacity: 0 }], 300, () => node.remove());
    else node.remove();
  }
  rows = nextRows; renderedIndex = index; layoutKey = key;
}
function render() {
  if (!state) return;
  const data = state.lyrics;
  const displayLyrics = data && ['synced', 'plain'].includes(data.kind);
  welcome.hidden = Boolean(displayLyrics) || Boolean(area.firstElementChild);
  message.textContent = state.message || 'Play something on Spotify ♪';
  document.querySelector('.actions').hidden = state.connected || state.demo;
  connect.disabled = state.status === 'connecting';
  if (!displayLyrics) { fadeAway(); return; }
  const track = state.demo ? 'demo' : state.playback?.trackId || 'unknown';
  if (!layer || layerTrack !== track || !layer.classList.contains(data.kind)) newLayer(track, data.kind);
  if (data.kind === 'plain') {
    area.style.height = '100%';
    if (!layer.firstChild) { const p = document.createElement('div'); p.className = 'plain'; p.textContent = data.plain; layer.append(p); }
    return;
  }
  const elapsed = Math.max(0, performance.now() - anchor);
  const position = state.demo ? (state.playback.progress_ms + elapsed) % state.playback.duration_ms : window.LyricSync.positionAt(state.playback, elapsed);
  renderRows(data, window.LyricSync.currentLine(data.lines, position));
}
async function action(fn) { try { await fn(); } catch (error) { message.textContent = error.message; } }
// Pointer-based dragging keeps hover events available on the lyric text.
let pointer;
area.addEventListener('pointerdown', event => {
  if (event.button !== 0 || state?.settings.clickThrough || event.target.closest('.plain')) return;
  pointer = { id: event.pointerId, x: event.screenX, y: event.screenY, moved: false };
  area.setPointerCapture(event.pointerId);
  pointer.ready = window.lyricView.beginDrag().catch(() => {});
});
area.addEventListener('pointermove', event => {
  if (!pointer || event.pointerId !== pointer.id) return;
  if (Math.hypot(event.screenX - pointer.x, event.screenY - pointer.y) > 5) pointer.moved = true;
  if (pointer.moved) pointer.ready.then(() => { if (pointer?.moved) return window.lyricView.moveDrag(); }).catch(() => {});
});
function finishPointer(event) {
  if (!pointer || event.pointerId !== pointer.id) return;
  const completed = pointer; pointer = null;
  completed.ready.then(() => window.lyricView.endDrag()).catch(() => {});
}
area.addEventListener('pointerup', finishPointer);
area.addEventListener('pointercancel', finishPointer);
area.addEventListener('lostpointercapture', finishPointer);
document.querySelector('#gear').addEventListener('click', () => action(() => window.lyricView.openSettings()));
connect.addEventListener('click', () => action(() => window.lyricView.login()));
document.querySelector('#demo').addEventListener('click', () => action(() => window.lyricView.setDemo(true)));
window.lyricView.onState(receive);
window.lyricView.onLockedHover(hovered => document.querySelector('#overlay').classList.toggle('locked-hover', hovered));
function reportGearBounds() {
  const rect = document.querySelector('#gear').getBoundingClientRect();
  window.lyricView.reportGearBounds({ x: rect.x, y: rect.y, width: rect.width, height: rect.height }).catch(() => {});
}
new ResizeObserver(() => { reportGearBounds(); render(); }).observe(document.querySelector('#overlay'));
document.fonts.ready.then(() => { layoutKey = ''; render(); });
document.addEventListener('mousemove', () => { if (state?.settings.clickThrough) window.lyricView.refreshHover().catch(() => {}); });
window.lyricView.getState().then(receive).catch(error => { message.textContent = error.message; });
setInterval(() => { if (!document.hidden && state?.playback?.is_playing && state.lyrics?.kind === 'synced') render(); }, 100);
document.addEventListener('visibilitychange', () => { if (!document.hidden) window.lyricView.getState().then(receive); });
