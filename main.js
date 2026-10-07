const { app, BrowserWindow, ipcMain, globalShortcut, screen, shell, safeStorage, Menu } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { Store, DEFAULTS, fitBounds, lockedHitTest } = require('./store');
const { Spotify, REDIRECT_URI } = require('./spotify');
const { Lyrics } = require('./lyrics');

const smoke = process.argv.includes('--smoke-test');
let demo = process.argv.includes('--demo') || smoke;
if (smoke) app.setPath('userData', path.join(__dirname, 'tmp', 'smoke-data'));
let overlay, settingsWindow, store, spotify, lyrics, pollTimer, boundsTimer;
let dragOrigin;
let gearBounds, gamingTimer, lockTimer, mouseIgnored, lastHoverKey, appliedLocked;
let exiting = false;
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
  dragOrigin = null;
  const s = store.settings;
  // Appearance updates must not change native window styles or focus while a
  // Settings color picker is open. Only a lock transition needs these calls.
  if (appliedLocked !== s.clickThrough) {
    overlay.setMovable(!s.clickThrough); overlay.setResizable(!s.clickThrough);
    overlay.setFocusable(!s.clickThrough);
    appliedLocked = s.clickThrough;
    enforceTopmost();
    clearInterval(lockTimer); lastHoverKey = undefined;
    updateLockedHover();
    if (s.clickThrough && !smoke) lockTimer = setInterval(updateLockedHover, 50);
  }
}
function maintainGamingOverlay() {
  if (exiting || !store.settings.gamingMode || !overlay || overlay.isDestroyed() || !overlay.isVisible() || overlay.isMinimized()) return;
  // Settings and native color dialogs must keep their focus and stacking.
  if (settingsWindow && !settingsWindow.isDestroyed() && settingsWindow.isVisible()) return;
  enforceTopmost();
  overlay.moveTop(); // Raises the window without activating it or taking game input.
}
function enforceTopmost() {
  if (!overlay || overlay.isDestroyed() || exiting) return;
  if (!overlay.isAlwaysOnTop()) overlay.setAlwaysOnTop(true, 'screen-saver');
}
function updateLockedHover(cursor = screen.getCursorScreenPoint()) {
  if (!overlay || overlay.isDestroyed()) return;
  const locked = store.settings.clickThrough;
  const hit = locked && (smoke || overlay.isVisible()) ? lockedHitTest(overlay.getBounds(), gearBounds, cursor) : { hovered: false, gearHovered: false };
  const ignore = locked && !hit.gearHovered;
  if (mouseIgnored !== ignore) { overlay.setIgnoreMouseEvents(ignore, { forward: true }); mouseIgnored = ignore; enforceTopmost(); }
  const key = `${locked}:${hit.hovered}`;
  if (key !== lastHoverKey) { lastHoverKey = key; overlay.webContents.send('locked-hover', hit.hovered); }
}
function registerShortcuts(hotkey) {
  // Hidden tests must not compete with shortcuts owned by a running real app.
  if (smoke) return true;
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
  overlay = new BrowserWindow({ ...bounds, minWidth: 80, minHeight: 80, transparent: true, frame: false, hasShadow: false, skipTaskbar: true, alwaysOnTop: true, focusable: !store.settings.clickThrough, resizable: true, show: false, title: 'LyricView', backgroundColor: '#00000000', webPreferences });
  secureWindow(overlay); overlay.loadFile(path.join(__dirname, 'overlay', 'index.html'));
  overlay.once('ready-to-show', () => { if (!smoke) overlay.showInactive(); });
  const saveBounds = () => { clearTimeout(boundsTimer); boundsTimer = setTimeout(() => { if (!overlay || overlay.isDestroyed()) return; store.update({ position: overlay.getBounds() }); broadcast(); }, 250); };
  overlay.on('move', saveBounds); overlay.on('resize', saveBounds);
  overlay.on('blur', enforceTopmost); overlay.on('show', enforceTopmost); overlay.on('restore', enforceTopmost);
  overlay.webContents.on('context-menu', () => Menu.buildFromTemplate([
    { label: 'Settings', click: () => openSettings() }, { label: demo ? 'Leave demo' : 'Preview demo', click: () => switchDemo(!demo) },
    { type: 'separator' }, { label: 'Quit LyricView', click: () => app.quit() }
  ]).popup({ window: overlay }));
  overlay.on('closed', () => { overlay = null; app.quit(); });
  applyWindowSettings();
  if (!smoke) gamingTimer = setInterval(maintainGamingOverlay, 1000);
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
    if (exiting) return { ok: true };
    if (![overlay, settingsWindow].some(win => win && !win.isDestroyed() && win.webContents === event.sender) || event.senderFrame !== event.sender.mainFrame) throw new Error('Invalid sender');
    try { return { ok: true, value: await handler(...args) }; } catch (error) { return { ok: false, error: error.message }; }
  });
}
function setupIpc() {
  handle('gear-bounds', rect => {
    if (!rect || !['x', 'y', 'width', 'height'].every(key => Number.isFinite(rect[key])) || rect.width < 1 || rect.width > 100 || rect.height < 1 || rect.height > 100) throw new Error('Invalid settings button bounds');
    gearBounds = rect; updateLockedHover();
  });
  handle('refresh-hover', () => { if (!smoke) updateLockedHover(); });
  handle('drag-begin', () => {
    if (store.settings.clickThrough) return;
    const cursor = screen.getCursorScreenPoint(), bounds = overlay.getBounds();
    dragOrigin = { x: cursor.x - bounds.x, y: cursor.y - bounds.y };
  });
  handle('drag-move', () => {
    if (!dragOrigin || store.settings.clickThrough) return;
    const cursor = screen.getCursorScreenPoint();
    overlay.setPosition(Math.round(cursor.x - dragOrigin.x), Math.round(cursor.y - dragOrigin.y));
  });
  handle('drag-end', () => { dragOrigin = null; });
  handle('get-state', () => snapshot());
  handle('open-settings', () => { openSettings(); });
  handle('close-settings', () => settingsWindow?.close());
  handle('quit', () => app.quit());
  handle('demo', enabled => { if (typeof enabled !== 'boolean') throw new Error('Invalid demo option'); switchDemo(enabled); });
  handle('settings-update', patch => {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Invalid settings');
    const allowed = ['fontSize', 'fontFamily', 'currentColor', 'otherColor', 'opacity', 'linesShown', 'clickThrough', 'gamingMode', 'alwaysOnTop', 'hotkey', 'spotifyClientId', 'backdropColor', 'backdropStrength', 'windowWidth', 'windowHeight'];
    if (Object.keys(patch).some(key => !allowed.includes(key))) throw new Error('Unknown setting');
    if (patch.spotifyClientId !== undefined && patch.spotifyClientId !== '' && !/^[a-f0-9]{32}$/i.test(patch.spotifyClientId.trim())) throw new Error('A Spotify Client ID must contain 32 hexadecimal characters.');
    if ((patch.hotkey !== undefined || patch.clickThrough === true) && !registerShortcuts(patch.hotkey ?? store.settings.hotkey)) { registerShortcuts(store.settings.hotkey); throw new Error('That shortcut is invalid, reserved, or already in use.'); }
    if (patch.spotifyClientId !== undefined && patch.spotifyClientId.trim() !== store.settings.spotifyClientId) { stopPolling(); spotify.logout(); demo = false; disconnected(); }
    // Capture live native bounds before applying explicit size changes.
    const bounds = overlay.getBounds();
    const sized = patch.windowWidth !== undefined || patch.windowHeight !== undefined;
    const position = { ...bounds, ...(patch.windowWidth !== undefined ? { width: patch.windowWidth } : {}), ...(patch.windowHeight !== undefined ? { height: patch.windowHeight } : {}) };
    const { windowWidth, windowHeight, ...appearance } = patch;
    if (sized && (![windowWidth, windowHeight].every(value => value === undefined || (Number.isFinite(value) && value >= 80 && value <= 16000)))) throw new Error('Window dimensions must be between 80 and 16000 pixels.');
    store.update({ ...appearance, position });
    if (sized) {
      const display = screen.getDisplayMatching(bounds).workArea;
      const fitted = fitBounds(store.settings.position, [display]);
      overlay.setBounds(fitted); store.update({ position: fitted });
    }
    applyWindowSettings(); broadcast(); return snapshot();
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
      try {
        const ready = await Promise.race([win.webContents.executeJavaScript(expression), new Promise((_, reject) => setTimeout(() => reject(new Error('Renderer check timed out')), 1000))]);
        if (ready) return;
      }
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
  await panel.webContents.executeJavaScript(`(() => {
    const color = document.querySelector('#backdropColor'); color.value = '#224466'; color.dispatchEvent(new Event('input', { bubbles: true }));
    const strength = document.querySelector('#backdropStrength'); strength.value = '0.5'; strength.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await waitFor(overlay, 'getComputedStyle(document.querySelector("#overlay"), "::before").backgroundColor === "rgba(34, 68, 102, 0.5)"', 'backdrop color and strength');
  await waitFor(panel, 'document.querySelector("#backdropStrengthValue").textContent === "50%"', 'backdrop strength label');
  const backdropSaved = JSON.parse(fs.readFileSync(store.file, 'utf8'));
  if (backdropSaved.backdropColor !== '#224466' || backdropSaved.backdropStrength !== 0.5) throw new Error('SMOKE FAIL [backdrop]: preference not persisted');
  await panel.webContents.executeJavaScript('window.lyricView.updateSettings({ backdropStrength: 0 })');
  await waitFor(overlay, 'getComputedStyle(document.querySelector("#overlay"), "::before").backgroundColor === "rgba(34, 68, 102, 0)"', 'backdrop off');
  await panel.webContents.executeJavaScript(`(() => { const width = document.querySelector('#windowWidth'); width.value = '360'; width.dispatchEvent(new Event('change')); const height = document.querySelector('#windowHeight'); height.value = '400'; height.dispatchEvent(new Event('change')); })()`);
  await waitFor(panel, 'state.settings.position.width === 360 && state.settings.position.height === 400', 'size controls');
  const chosenBounds = overlay.getBounds();
  if (chosenBounds.width !== 360 || chosenBounds.height !== 400) throw new Error('SMOKE FAIL [size]: explicit window dimensions ignored');
  for (const clickThrough of [false, true]) {
    for (const fontSize of [12, 72, 32, 12]) {
      await panel.webContents.executeJavaScript(`window.lyricView.updateSettings({ clickThrough: ${clickThrough}, fontSize: ${fontSize} })`);
      await waitFor(overlay, `document.documentElement.style.getPropertyValue('--font-size') === '${fontSize}px'`, 'font update');
      const bounds = overlay.getBounds();
      if (JSON.stringify(bounds) !== JSON.stringify(chosenBounds)) throw new Error('SMOKE FAIL [position]: font update changed window size or position');
    }
  }
  await panel.webContents.executeJavaScript('window.lyricView.updateSettings({ fontSize: 32, linesShown: 1, clickThrough: false })');
  await waitFor(overlay, 'document.querySelector(".line.current").getBoundingClientRect().height > 32 * 1.4 + 1', 'long lyrics wrap');
  await waitFor(overlay, 'document.querySelector(".line.current").scrollWidth <= document.querySelector(".line.current").clientWidth + 1', 'wrapped lyrics fit width');
  overlay.setBounds({ ...chosenBounds, width: 500, height: 420 });
  await waitFor(panel, 'state.settings.position.width === 500 && state.settings.position.height === 420', 'native resize persisted');
  if (JSON.parse(fs.readFileSync(store.file, 'utf8')).position.width !== 500) throw new Error('SMOKE FAIL [size]: native width not persisted');
  await panel.webContents.executeJavaScript('window.lyricView.updateSettings({ fontSize: 40, linesShown: 3 })');
  overlay.webContents.sendInputEvent({ type: 'mouseMove', x: 200, y: 80 });
  await waitFor(overlay, 'Number(getComputedStyle(document.querySelector("#gear")).opacity) > 0.9', 'hover settings gear');
  stopPolling(); demo = false;
  setState({ status: 'ready', connected: true, message: '', playback: { trackId: 'smoke-track-a', progress_ms: 0, duration_ms: 20000, is_playing: false }, sampledAt: performance.now(), lyrics: { kind: 'synced', lines: demoLines, plain: '' } });
  await waitFor(overlay, 'layerTrack === "smoke-track-a" && renderedIndex === 0', 'first track');
  await new Promise(resolve => setTimeout(resolve, 350));
  setState({ playback: { ...state.playback, progress_ms: 4100 }, sampledAt: performance.now() });
  await waitFor(overlay, 'renderedIndex === 1', 'next lyric row');
  const motion = await overlay.webContents.executeJavaScript('reducedMotion.matches || [...document.querySelectorAll(".line")].some(row => row.getAnimations().some(animation => animation.effect.getKeyframes().some(frame => frame.transform?.includes("translateY"))))');
  if (!motion) throw new Error('SMOKE FAIL [line animation]: lyric rows did not slide');
  setState({ playback: { ...state.playback, trackId: 'smoke-track-b', progress_ms: 0 }, sampledAt: performance.now() });
  await waitFor(overlay, 'layerTrack === "smoke-track-b" && renderedIndex === 0', 'song transition');
  await new Promise(resolve => setTimeout(resolve, 350));
  await waitFor(overlay, 'document.querySelectorAll(".lyric-layer").length === 1', 'previous song cleanup');
  await panel.webContents.executeJavaScript('window.lyricView.updateSettings({ clickThrough: true })');
  if (!overlay.isAlwaysOnTop() || overlay.isResizable() || overlay.isFocusable()) throw new Error('SMOKE FAIL [locked window]: topmost, resize or focus flags incorrect: ' + JSON.stringify({ topmost: overlay.isAlwaysOnTop(), resizable: overlay.isResizable(), focusable: overlay.isFocusable() }));
  overlay.emit('blur');
  if (!overlay.isAlwaysOnTop()) throw new Error('SMOKE FAIL [topmost]: blur cleared topmost');
  // Color input events must not disturb native focus/stacking in locked mode.
  const nativeCalls = [];
  const nativeMethods = ['setFocusable', 'setMovable', 'setResizable', 'setAlwaysOnTop', 'setIgnoreMouseEvents'];
  const originals = new Map(nativeMethods.map(name => [name, overlay[name]]));
  try {
    for (const name of nativeMethods) overlay[name] = function (...args) { nativeCalls.push(name); return originals.get(name).apply(this, args); };
    await panel.webContents.executeJavaScript(`(async () => {
      const picker = document.querySelector('#currentColor'); picker.focus();
      for (const color of ['#123456', '#345678', '#abcdef']) {
        picker.value = color; picker.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    })()`);
    await waitFor(panel, 'state.settings.currentColor === "#abcdef"', 'live locked color updates');
    if (nativeCalls.length) throw new Error('SMOKE FAIL [picker focus]: color input changed native window state: ' + nativeCalls.join(', '));
    if (!(await panel.webContents.executeJavaScript('document.activeElement === document.querySelector("#currentColor")'))) throw new Error('SMOKE FAIL [picker focus]: color control lost focus');
  } finally { for (const [name, method] of originals) overlay[name] = method; }
  if (!gearBounds) throw new Error('SMOKE FAIL [gear]: settings button bounds missing');
  const lockedBounds = overlay.getBounds();
  updateLockedHover({ x: lockedBounds.x - 10, y: lockedBounds.y - 10 });
  if (!mouseIgnored) throw new Error('SMOKE FAIL [lock]: outside overlay is not click-through');
  await waitFor(overlay, 'Number(getComputedStyle(document.querySelector("#gear")).opacity) < 0.1', 'locked gear hides outside overlay');
  updateLockedHover({ x: lockedBounds.x + 100, y: lockedBounds.y + 80 });
  if (!mouseIgnored) throw new Error('SMOKE FAIL [lock]: lyrics are not click-through');
  await waitFor(overlay, 'Number(getComputedStyle(document.querySelector("#gear")).opacity) > 0.9', 'locked hover reveals gear');
  updateLockedHover({ x: lockedBounds.x + gearBounds.x + gearBounds.width / 2, y: lockedBounds.y + gearBounds.y + gearBounds.height / 2 });
  if (mouseIgnored) throw new Error('SMOKE FAIL [lock]: settings button still ignores clicks');
  panel.close();
  overlay.webContents.sendInputEvent({ type: 'mouseDown', x: Math.round(gearBounds.x + gearBounds.width / 2), y: Math.round(gearBounds.y + gearBounds.height / 2), button: 'left', clickCount: 1 });
  overlay.webContents.sendInputEvent({ type: 'mouseUp', x: Math.round(gearBounds.x + gearBounds.width / 2), y: Math.round(gearBounds.y + gearBounds.height / 2), button: 'left', clickCount: 1 });
  for (let i = 0; i < 50 && (!settingsWindow || settingsWindow.isDestroyed()); i++) await new Promise(resolve => setTimeout(resolve, 100));
  if (!settingsWindow || settingsWindow.isDestroyed()) throw new Error('SMOKE FAIL [lock]: clicking gear did not reopen Settings');
  console.log('SMOKE OK: locked settings gear reopened Settings');
  const originalVisible = overlay.isVisible, originalMoveTop = overlay.moveTop;
  const originalSettingsVisible = settingsWindow.isVisible;
  let raises = 0;
  try {
    overlay.isVisible = () => true; overlay.moveTop = () => { raises++; };
    settingsWindow.isVisible = () => true;
    maintainGamingOverlay();
    if (raises) throw new Error('SMOKE FAIL [gaming]: overlay raised over Settings');
    settingsWindow.isVisible = () => false;
    maintainGamingOverlay();
    if (raises !== 1) throw new Error('SMOKE FAIL [gaming]: enabled gaming mode did not raise overlay');
    store.update({ gamingMode: false }); maintainGamingOverlay();
    if (raises !== 1) throw new Error('SMOKE FAIL [gaming]: disabled mode raised overlay');
    store.update({ gamingMode: true }); overlay.isVisible = () => false; maintainGamingOverlay();
    if (raises !== 1) throw new Error('SMOKE FAIL [gaming]: hidden overlay was raised');
  } finally {
    overlay.isVisible = originalVisible; overlay.moveTop = originalMoveTop; settingsWindow.isVisible = originalSettingsVisible;
    store.update({ gamingMode: true });
  }
  await overlay.webContents.executeJavaScript('window.lyricView.updateSettings({ clickThrough: false })');
  if (!overlay.isAlwaysOnTop() || !overlay.isResizable() || !overlay.isFocusable()) throw new Error('SMOKE FAIL [unlocked window]: topmost, resize or focus flags incorrect: ' + JSON.stringify({ topmost: overlay.isAlwaysOnTop(), resizable: overlay.isResizable(), focusable: overlay.isFocusable() }));
  // Screenshot capture depends on Chromium's graphics compositor and is not
  // required to validate rendering, IPC, isolation, or settings persistence.
  console.log('SMOKE PASS: overlay, settings, persistence, backdrop, manual width/height, wrapped lyrics, lyric slide, song transition, topmost in both modes, fixed position through font changes, gaming raise and Settings exclusion, locked color input without native focus changes, locked click-through and clickable hover gear');
  // Exit the isolated fixture directly: the newly opened test window may still
  // be loading, and graceful window closure can defer test shutdown.
  app.emit('before-quit');
  exiting = true;
  app.exit(0);
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
  exiting = true;
  clearInterval(gamingTimer); clearInterval(lockTimer);
  clearTimeout(boundsTimer); stopPolling(); globalShortcut.unregisterAll(); spotify?.close();
  if (store && overlay && !overlay.isDestroyed()) store.update({ position: overlay.getBounds() });
});


