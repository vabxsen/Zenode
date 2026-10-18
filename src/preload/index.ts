import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { ZenodeAPI } from '../shared/api'

// The only bridge between the page and the system. The page gets these
// functions and nothing else: no Node, no raw ipcRenderer.
const api: ZenodeAPI = {
  chooseVault: () => ipcRenderer.invoke('vault:choose'),
  openVault: (root) => ipcRenderer.invoke('vault:open', root),
  currentVault: () => ipcRenderer.invoke('vault:current'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  readConfig: (name) => ipcRenderer.invoke('config:read', name),
  writeConfig: (name, data) => ipcRenderer.invoke('config:write', name, data),

  list: () => ipcRenderer.invoke('fs:list'),
  read: (path) => ipcRenderer.invoke('fs:read', path),
  readMany: (paths) => ipcRenderer.invoke('fs:readMany', paths),
  write: (path, content) => ipcRenderer.invoke('fs:write', path, content),
  writeChecked: (path, content, expectHash) => ipcRenderer.invoke('fs:writeChecked', path, content, expectHash),
  createFile: (dir, baseName, ext) => ipcRenderer.invoke('fs:createFile', dir, baseName, ext),
  createFolder: (dir, name) => ipcRenderer.invoke('fs:createFolder', dir, name),
  rename: (path, newName) => ipcRenderer.invoke('fs:rename', path, newName),
  trash: (path) => ipcRenderer.invoke('fs:trash', path),
  reveal: (path) => ipcRenderer.invoke('fs:reveal', path),
  openExternal: (path) => ipcRenderer.invoke('fs:openExternal', path),
  openUrl: (url) => ipcRenderer.invoke('app:openUrl', url),
  log: (level, message) => ipcRenderer.invoke('app:log', level, message),
  listSnapshots: (path) => ipcRenderer.invoke('snapshots:list', path),
  readSnapshot: (path, id) => ipcRenderer.invoke('snapshots:read', path, id),
  keepSnapshot: (path, content) => ipcRenderer.invoke('snapshots:keep', path, content),

  onVaultChanged: (cb) => {
    const listener = (_e: IpcRendererEvent, paths: string[]): void => cb(paths)
    ipcRenderer.on('vault:changed', listener)
    return () => ipcRenderer.removeListener('vault:changed', listener)
  },
  onBeforeClose: (cb) => {
    ipcRenderer.on('app:before-close', () => {
      cb().finally(() => ipcRenderer.send('app:ready-to-close'))
    })
  }
}

contextBridge.exposeInMainWorld('zenode', api)
