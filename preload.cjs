const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('winV', {
  getClips: () => ipcRenderer.invoke('clips:get'),
  pasteClip: (id) => ipcRenderer.invoke('clips:paste', id),
  togglePin: (id) => ipcRenderer.invoke('clips:toggle-pin', id),
  removeClip: (id) => ipcRenderer.invoke('clips:remove', id),
  clearHistory: () => ipcRenderer.invoke('clips:clear'),
  hide: () => ipcRenderer.invoke('window:hide'),
  getStatus: () => ipcRenderer.invoke('app:status'),
  setMonitoring: (enabled) => ipcRenderer.invoke('monitoring:set', enabled),
  onClipsUpdated: (callback) => {
    const handler = (_event, clips) => callback(clips);
    ipcRenderer.on('clips:updated', handler);
    return () => ipcRenderer.removeListener('clips:updated', handler);
  },
  onWindowShown: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('window:shown', handler);
    return () => ipcRenderer.removeListener('window:shown', handler);
  },
  onStatusUpdated: (callback) => {
    const handler = (_event, status) => callback(status);
    ipcRenderer.on('status:updated', handler);
    return () => ipcRenderer.removeListener('status:updated', handler);
  },
});
