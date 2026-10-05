const { contextBridge, ipcRenderer } = require('electron');
async function invoke(channel, ...args) {
  const result = await ipcRenderer.invoke(channel, ...args);
  if (!result.ok) throw new Error(result.error);
  return result.value;
}
contextBridge.exposeInMainWorld('lyricView', {
  getState: () => invoke('get-state'),
  openSettings: () => invoke('open-settings'), closeSettings: () => invoke('close-settings'),
  updateSettings: patch => invoke('settings-update', patch), resetSettings: () => invoke('settings-reset'),
  login: () => invoke('spotify-login'), logout: () => invoke('spotify-logout'),
  setDemo: enabled => invoke('demo', enabled), quit: () => invoke('quit'),
  beginDrag: () => invoke('drag-begin'), moveDrag: () => invoke('drag-move'), endDrag: () => invoke('drag-end'),
  reportGearBounds: rect => invoke('gear-bounds', rect), refreshHover: () => invoke('refresh-hover'),
  onLockedHover: callback => {
    const listener = (_event, hovered) => callback(hovered);
    ipcRenderer.on('locked-hover', listener);
    return () => ipcRenderer.removeListener('locked-hover', listener);
  },
  onState: callback => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('state', listener);
    return () => ipcRenderer.removeListener('state', listener);
  }
});
