let state, anchor = performance.now(), signature = '';
const area = document.querySelector('#lyrics'), welcome = document.querySelector('#welcome'), message = document.querySelector('#message');
const connect = document.querySelector('#connect');
function receive(next) {
  state = next; anchor = performance.now() - next.elapsed_ms; signature = '';
  const s = next.settings, root = document.documentElement.style;
  root.setProperty('--font-size', `${s.fontSize}px`); root.setProperty('--font-family', s.fontFamily);
  root.setProperty('--current-color', s.currentColor); root.setProperty('--other-color', s.otherColor); root.setProperty('--opacity', s.opacity);
  document.body.classList.toggle('locked', s.clickThrough);
  document.querySelector('#demoBadge').hidden = !next.demo;
  render();
}
function render() {
  if (!state) return;
  const data = state.lyrics;
  const displayLyrics = data && ['synced', 'plain'].includes(data.kind);
  area.hidden = !displayLyrics; welcome.hidden = Boolean(displayLyrics);
  message.textContent = state.message || 'Play something on Spotify ♪';
  document.querySelector('.actions').hidden = state.connected || state.demo;
  connect.disabled = state.status === 'connecting';
  if (!displayLyrics) return;
  if (data.kind === 'plain') {
    if (signature !== 'plain') { area.replaceChildren(); const p = document.createElement('div'); p.className = 'plain'; p.textContent = data.plain; area.append(p); signature = 'plain'; }
    return;
  }
  const elapsed = Math.max(0, performance.now() - anchor);
  const position = state.demo ? (state.playback.progress_ms + elapsed) % state.playback.duration_ms : window.LyricSync.positionAt(state.playback, elapsed);
  const index = window.LyricSync.currentLine(data.lines, position);
  const key = `${index}:${state.settings.linesShown}`;
  if (signature === key) return;
  signature = key; area.replaceChildren();
  const radius = (state.settings.linesShown - 1) / 2;
  for (let offset = -radius; offset <= radius; offset++) {
    const line = document.createElement('div'); line.className = `line${offset === 0 ? ' current' : ''}`;
    line.textContent = index === -1 ? (offset === 0 ? '♪' : offset > 0 ? data.lines[offset - 1]?.text || '' : '') : data.lines[index + offset]?.text || (offset === 0 ? '♪' : '');
    area.append(line);
  }
}
async function action(fn) { try { await fn(); } catch (error) { message.textContent = error.message; } }
document.querySelector('#gear').addEventListener('click', () => action(() => window.lyricView.openSettings()));
connect.addEventListener('click', () => action(() => window.lyricView.login()));
document.querySelector('#demo').addEventListener('click', () => action(() => window.lyricView.setDemo(true)));
window.lyricView.onState(receive);
window.lyricView.getState().then(receive).catch(error => { message.textContent = error.message; });
setInterval(() => { if (!document.hidden && state?.playback?.is_playing && state.lyrics?.kind === 'synced') render(); }, 100);
document.addEventListener('visibilitychange', () => { if (!document.hidden) window.lyricView.getState().then(receive); });
