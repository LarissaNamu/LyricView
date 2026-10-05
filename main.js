const { app, BrowserWindow, ipcMain, globalShortcut, screen, shell, safeStorage, Menu } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { Store, DEFAULTS, fitBounds } = require('./store');
const { Spotify, REDIRECT_URI } = require('./spotify');
const { Lyrics } = require('./lyrics');

const smoke = process.argv.includes('--smoke-test');
let demo = process.argv.includes('--demo') || smoke;
if (smoke) app.setPath('userData', path.join(__dirname, 'tmp', 'smoke-data'));
let overlay, settingsWindow, store, spotify, lyrics, pollTimer, boundsTimer;
let generation = 0, demoStart = performance.now(), lyricTrack = null, retryLyricsAt = 0, failures = 0;
let state = { status: 'disconnected', message: 'Connect Spotify to get started', connected: false, playback: null, lyrics: null, sampledAt: 0 };
const demoLines = [
  { time: 0, text: 'Your lyrics, floating on your desktop' },
  { time: 4000, text: 'Drag this window wherever you like' },
  { time: 8000, text: 'Make the colors and size your own' },
  { time: 12000, text: 'Connect Spotify when you are ready' },
  { time: 16000, text: 'A little space for every line' }
];

function snapshot() {
  return { ...state, settings: store.settings, demo, redirectUri: REDIRECT_URI, elapsed_ms: state.sampledAt ? Math.max(0, performance.now() - state.sampledAt) : 0 };
}
function broadcast() {
  for (const win of [overlay, settingsWindow]) if (win && !win.isDestroyed()) win.webContents.send('state', snapshot());
}
function setState(patch) { state = { ...state, ...patch }; broadcast(); }
function secureWindow(win) {
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
}
const webPreferences = { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true };
function applyWindowSettings() {
  const s = store.settings;
  overlay.setAlwaysOnTop(s.alwaysOnTop, process.platform === 'darwin' ? 'screen-saver' : 'normal');
  overlay.setIgnoreMouseEvents(s.clickThrough, { forward: true });
  overlay.setMovable(!s.clickThrough); overlay.setResizable(!s.clickThrough);
}
function registerShortcuts(hotkey) {
  globalShortcut.unregisterAll();
  const recovery = 'CommandOrControl+Shift+,';
  if (hotkey === recovery) return false;
  try {
    if (!globalShortcut.register(hotkey, () => overlay.isVisible() ? overlay.hide() : overlay.showInactive())) return false;
    if (!globalShortcut.register(recovery, () => openSettings())) { globalShortcut.unregisterAll(); return false; }
    return true;
  } catch { globalShortcut.unregisterAll(); return false; }
}
function createOverlay() {
  const bounds = fitBounds(store.settings.position, screen.getAllDisplays().map(d => d.workArea));
  overlay = new BrowserWindow({ ...bounds, minWidth: 320, minHeight: 140, transparent: true, frame: false, hasShadow: false, skipTaskbar: true, resizable: true, show: false, title: 'LyricView', backgroundColor: '#00000000', webPreferences });
  secureWindow(overlay); overlay.loadFile(path.join(__dirname, 'overlay', 'index.html'));
  overlay.once('ready-to-show', () => { if (!smoke) overlay.showInactive(); });
  const saveBounds = () => { clearTimeout(boundsTimer); boundsTimer = setTimeout(() => store.update({ position: overlay.getBounds() }), 250); };
  overlay.on('move', saveBounds); overlay.on('resize', saveBounds);
  overlay.webContents.on('context-menu', () => Menu.buildFromTemplate([
    { label: 'Settings', click: () => openSettings() }, { label: demo ? 'Leave demo' : 'Preview demo', click: () => switchDemo(!demo) },
    { type: 'separator' }, { label: 'Quit LyricView', click: () => app.quit() }
  ]).popup({ window: overlay }));
  overlay.on('closed', () => { overlay = null; app.quit(); });
  applyWindowSettings();
}
function openSettings() {
  if (settingsWindow && !settingsWindow.isDestroyed()) { if (!smoke) { settingsWindow.show(); settingsWindow.focus(); } return settingsWindow; }
  settingsWindow = new BrowserWindow({ width: 480, height: 750, minWidth: 420, minHeight: 550, show: false, title: 'LyricView Settings', backgroundColor: '#11151d', autoHideMenuBar: true, webPreferences });
  secureWindow(settingsWindow); settingsWindow.loadFile(path.join(__dirname, 'settings', 'index.html'));
  settingsWindow.once('ready-to-show', () => { if (!smoke) settingsWindow.show(); });
  settingsWindow.on('closed', () => { settingsWindow = null; });
  return settingsWindow;
}

function stopPolling() { clearTimeout(pollTimer); generation++; lyricTrack = null; retryLyricsAt = 0; failures = 0; }
function disconnected(message = 'Connect Spotify to get started') {
  setState({ status: 'disconnected', message, connected: false, playback: null, lyrics: null });
}
function switchDemo(enabled) {
  stopPolling(); demo = enabled; demoStart = performance.now();
  if (demo || spotify.refreshToken) poll(generation);
  else disconnected();
}
async function poll(epoch) {
  let delay = 3000;
  try {
    if (demo) {
      setState({ status: 'ready', message: '', playback: { progress_ms: (performance.now() - demoStart) % 20000, duration_ms: 20000, is_playing: true }, sampledAt: performance.now(), lyrics: { kind: 'synced', lines: demoLines, plain: '' } });
    } else {
      const playback = await spotify.currentlyPlaying();
      if (epoch !== generation) return;
      failures = 0;
      if (!playback?.item || playback.currently_playing_type !== 'track') {
        lyricTrack = null;
        setState({ status: 'waiting', message: 'Play something on Spotify ♪', connected: true, playback: null, lyrics: null }); delay = 10000;
      } else {
        const track = playback.item;
        if (!track.id || track.is_local) {
          lyricTrack = null;
          setState({ status: 'missing', message: 'Lyrics are unavailable for this local track', connected: true, playback: null, lyrics: null });
        } else {
          const changed = state.playback?.trackId !== track.id;
          setState({ status: changed ? 'loading' : state.status, message: changed ? 'Finding lyrics...' : state.message, connected: true,
            playback: { trackId: track.id, progress_ms: playback.progress_ms || 0, duration_ms: track.duration_ms, is_playing: Boolean(playback.is_playing) }, sampledAt: performance.now(), ...(changed ? { lyrics: null } : {}) });
          if (lyricTrack !== track.id && Date.now() >= retryLyricsAt) {
            try {
              const result = await lyrics.get(track);
              if (epoch !== generation) return;
              lyricTrack = track.id; retryLyricsAt = 0;
              setState({ status: 'ready', lyrics: result, message: result.kind === 'missing' ? 'No lyrics found for this song' : result.kind === 'instrumental' ? 'Instrumental' : '' });
            } catch (error) {
              if (epoch !== generation) return;
              retryLyricsAt = Date.now() + 30000; setState({ status: 'error', lyrics: null, message: `${error.message} Retrying in the background.` });
            }
          }
        }
      }
    }
  } catch (error) {
    if (epoch !== generation) return;
    if (!spotify.refreshToken || error.status === 401) { disconnected(error.message); return; }
    failures++; delay = Math.max(Math.min(60000, 3000 * 2 ** Math.min(failures, 5)), (error.retryAfter || 0) * 1000);
    // Freeze interpolation while disconnected rather than highlighting incorrect lines.
    setState({ status: 'error', message: error.message, playback: null, lyrics: null });
  }
  if (epoch === generation) pollTimer = setTimeout(() => poll(epoch), delay);
}
function handle(channel, handler) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (![overlay, settingsWindow].some(win => win && !win.isDestroyed() && win.webContents === event.sender) || event.senderFrame !== event.sender.mainFrame) throw new Error('Invalid sender');
    try { return { ok: true, value: await handler(...args) }; } catch (error) { return { ok: false, error: error.message }; }
  });
}
function setupIpc() {
  handle('get-state', () => snapshot());
  handle('open-settings', () => { openSettings(); });
  handle('close-settings', () => settingsWindow?.close());
  handle('quit', () => app.quit());
  handle('demo', enabled => { if (typeof enabled !== 'boolean') throw new Error('Invalid demo option'); switchDemo(enabled); });
  handle('settings-update', patch => {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Invalid settings');
    const allowed = ['fontSize', 'fontFamily', 'currentColor', 'otherColor', 'opacity', 'linesShown', 'clickThrough', 'alwaysOnTop', 'hotkey', 'spotifyClientId'];
    if (Object.keys(patch).some(key => !allowed.includes(key))) throw new Error('Unknown setting');
    if (patch.spotifyClientId !== undefined && patch.spotifyClientId !== '' && !/^[a-f0-9]{32}$/i.test(patch.spotifyClientId.trim())) throw new Error('A Spotify Client ID must contain 32 hexadecimal characters.');
    if ((patch.hotkey !== undefined || patch.clickThrough === true) && !registerShortcuts(patch.hotkey ?? store.settings.hotkey)) { registerShortcuts(store.settings.hotkey); throw new Error('That shortcut is invalid, reserved, or already in use.'); }
    if (patch.spotifyClientId !== undefined && patch.spotifyClientId.trim() !== store.settings.spotifyClientId) { stopPolling(); spotify.logout(); demo = false; disconnected(); }
    store.update(patch); applyWindowSettings(); broadcast(); return snapshot();
  });
  handle('settings-reset', () => {
    if (!registerShortcuts(DEFAULTS.hotkey)) { registerShortcuts(store.settings.hotkey); throw new Error('Default shortcut is unavailable.'); }
    store.reset(); overlay.setBounds(fitBounds(store.settings.position, screen.getAllDisplays().map(d => d.workArea))); applyWindowSettings(); broadcast();
  });
  handle('spotify-login', async () => {
    if (spotify.pending) throw new Error('A Spotify sign-in is already open in your browser.');
    if (!store.settings.spotifyClientId) { openSettings(); throw new Error('Enter the Spotify Client ID in Settings, then connect.'); }
    stopPolling(); demo = false; setState({ status: 'connecting', message: 'Finish connecting in your browser...', playback: null, lyrics: null });
    try { await spotify.login(); } catch (error) { disconnected(error.message); throw error; }
    setState({ connected: true, status: 'waiting', message: 'Waiting for music...' }); poll(generation);
  });
  handle('spotify-logout', () => { stopPolling(); spotify.logout(); demo = false; disconnected(); });
}

async function smokeTest() {
  const panel = openSettings();
  async function waitFor(win, expression, label) {
    let lastError;
    for (let i = 0; i < 100; i++) {
      try { if (await win.webContents.executeJavaScript(expression)) return; }
      catch (error) { lastError = error; }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('SMOKE FAIL [' + label + ']: renderer did not become ready' + (lastError ? ': ' + lastError.message : ''));
  }
  await waitFor(overlay, 'Boolean(window.lyricView && document.querySelector(".line.current"))', 'overlay and preload');
  await waitFor(panel, 'Boolean(window.lyricView && document.querySelector("#fontSize").value === "32")', 'settings and preload');
  console.log('SMOKE OK: overlay and settings renderers ready');
  const isolated = await panel.webContents.executeJavaScript('typeof require === "undefined" && typeof process === "undefined"');
  if (!isolated) throw new Error('SMOKE FAIL [isolation]: Node globals exposed to renderer');
  const result = await panel.webContents.executeJavaScript('window.lyricView.updateSettings({ fontSize: 40 }).then(() => true)');
  if (!result || store.settings.fontSize !== 40) throw new Error('SMOKE FAIL [IPC]: settings update did not reach main process');
  const saved = JSON.parse(fs.readFileSync(store.file, 'utf8'));
  if (saved.fontSize !== 40) throw new Error('SMOKE FAIL [persistence]: settings were not written to disk');
  await waitFor(overlay, 'document.documentElement.style.getPropertyValue("--font-size") === "40px"', 'live appearance update');
  // Screenshot capture depends on Chromium's graphics compositor and is not
  // required to validate rendering, IPC, isolation, or settings persistence.
  console.log('SMOKE PASS: overlay, settings, sandboxed preload, settings IPC, persistence, live updates');
  app.quit();
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { overlay?.showInactive(); openSettings(); });
  app.whenReady().then(async () => {
    store = new Store(app.getPath('userData'));
    if (smoke) store.reset();
    lyrics = new Lyrics(app.getPath('userData'));
    spotify = new Spotify({ directory: app.getPath('userData'), safeStorage, openExternal: url => shell.openExternal(url), getClientId: () => store.settings.spotifyClientId });
    setupIpc(); createOverlay(); Menu.setApplicationMenu(null);
    if (!registerShortcuts(store.settings.hotkey)) {
      store.update({ clickThrough: false }); applyWindowSettings();
      setState({ message: 'Global shortcut unavailable. Right-click the overlay to open Settings.' });
    }
    if (spotify.restore()) state.connected = true;
    if (demo || state.connected) poll(generation);
    if (smoke) await smokeTest();
  }).catch(error => { console.error(error); app.exit(1); });
}
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => {
  clearTimeout(boundsTimer); stopPolling(); globalShortcut.unregisterAll(); spotify?.close();
  if (store && overlay && !overlay.isDestroyed()) store.update({ position: overlay.getBounds() });
});
