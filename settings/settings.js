const get = id => document.getElementById(id);
let state;
const appearanceKeys = ['currentColor', 'otherColor', 'fontSize', 'fontFamily', 'opacity', 'linesShown', 'clickThrough', 'backdropColor', 'backdropStrength'];
function receive(next) {
  state = next;
  get('accountStatus').textContent = next.demo ? 'Previewing demo — no Spotify requests' : next.status === 'connecting' ? 'Connecting in your browser...' : next.connected ? 'Connected to Spotify' : 'Not connected';
  get('redirectUri').textContent = next.redirectUri;
  get('login').hidden = next.connected; get('logout').hidden = !next.connected;
  get('login').disabled = next.status === 'connecting'; get('saveClient').disabled = next.status === 'connecting';
  get('preview').textContent = next.demo ? 'Leave demo' : 'Try demo';
  for (const key of appearanceKeys) {
    const input = get(key); if (document.activeElement === input) continue;
    if (input.type === 'checkbox') input.checked = next.settings[key]; else input.value = next.settings[key];
  }
  for (const [id, key] of [['windowWidth', 'width'], ['windowHeight', 'height']]) { if (document.activeElement !== get(id)) get(id).value = next.settings.position[key]; }
  if (document.activeElement !== get('clientId')) get('clientId').value = next.settings.spotifyClientId;
  if (document.activeElement !== get('hotkey')) get('hotkey').value = next.settings.hotkey;
  get('fontSizeValue').textContent = `${next.settings.fontSize} px`;
  get('opacityValue').textContent = `${Math.round(next.settings.opacity * 100)}%`;
  get('backdropStrengthValue').textContent = next.settings.backdropStrength === 0 ? 'Off' : `${Math.round(next.settings.backdropStrength * 100)}%`;
}
async function action(fn, success = '') {
  get('feedback').textContent = '';
  try { await fn(); get('feedback').textContent = success; }
  catch (error) { get('feedback').textContent = error.message; if (state) receive(state); }
}
for (const key of appearanceKeys) {
  const input = get(key);
  input.addEventListener(input.type === 'range' || input.type === 'color' ? 'input' : 'change', () => {
    const value = input.type === 'checkbox' ? input.checked : ['fontSize', 'opacity', 'linesShown', 'backdropStrength'].includes(key) ? Number(input.value) : input.value;
    action(() => window.lyricView.updateSettings({ [key]: value }));
  });
}
for (const key of ['windowWidth', 'windowHeight']) get(key).addEventListener('change', () => action(() => window.lyricView.updateSettings({ [key]: Number(get(key).value) })));
get('saveClient').addEventListener('click', () => action(() => window.lyricView.updateSettings({ spotifyClientId: get('clientId').value.trim() }), 'Client ID saved. You can now connect Spotify.'));
get('saveHotkey').addEventListener('click', () => action(() => window.lyricView.updateSettings({ hotkey: get('hotkey').value.trim() }), 'Shortcut updated.'));
get('login').addEventListener('click', () => action(() => window.lyricView.login()));
get('logout').addEventListener('click', () => action(() => window.lyricView.logout(), 'Logged out. Saved authentication token deleted.'));
get('preview').addEventListener('click', () => action(() => window.lyricView.setDemo(!state.demo)));
get('reset').addEventListener('click', () => action(() => window.lyricView.resetSettings(), 'Appearance and behavior reset. Spotify registration kept.'));
get('close').addEventListener('click', () => action(() => window.lyricView.closeSettings()));
get('quit').addEventListener('click', () => action(() => window.lyricView.quit()));
window.lyricView.onState(receive);
window.lyricView.getState().then(receive).catch(error => { get('feedback').textContent = error.message; });
