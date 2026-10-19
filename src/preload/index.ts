import { contextBridge, ipcRenderer, webFrame, type IpcRendererEvent } from 'electron'
import type { ZenodeAPI } from '../shared/api'
import type { UpdateStatus } from '../shared/updates'

// Electron reports main-process errors as "Error invoking remote method 'x': Error: msg";
// the page only needs the message, which main already words for people.
const REMOTE_PREFIX = /^Error invoking remote method '[^']+': (?:[A-Za-z]*Error: )?/
const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> =>
  ipcRenderer.invoke(channel, ...args).catch((e: unknown) => {
    throw new Error(String((e as Error)?.message ?? e).replace(REMOTE_PREFIX, ''))
  })

// The only bridge between the page and the system. The page gets these
// functions and nothing else: no Node, no raw ipcRenderer.
const api: ZenodeAPI = {
  chooseVault: () => invoke('vault:choose'),
  openVault: (root) => invoke('vault:open', root),
  openVaultInNewWindow: (root) => invoke('vault:openInNewWindow', root),
  createVault: (name, newWindow) => invoke('vault:create', name, newWindow),
  openHelpVault: (newWindow) => invoke('vault:openHelp', newWindow),
  forgetVault: (root) => invoke('settings:forgetVault', root),
  setZoom: (factor) => webFrame.setZoomFactor(Math.min(2, Math.max(0.5, Number(factor) || 1))),
  setTitleBarColors: (color, symbolColor) => invoke('app:titleBar', color, symbolColor),
  appInfo: () => invoke('app:info'),
  updateStatus: () => invoke('update:status'),
  checkForUpdates: () => invoke('update:check'),
  setUpdatePrefs: (change) => invoke('update:setPrefs', change),
  installUpdate: () => invoke('update:install'),
  listCss: () => invoke('css:list'),
  readCss: (kind, name) => invoke('css:read', kind, name),
  openCssFolder: (kind) => invoke('css:openFolder', kind),
  exportPdf: (req) => invoke('export:pdf', req),
  currentVault: () => invoke('vault:current'),
  takeOpenRequest: () => invoke('app:takeOpenRequest'),
  getSettings: () => invoke('settings:get'),
  readConfig: (name) => invoke('config:read', name),
  writeConfig: (name, data) => invoke('config:write', name, data),

  list: () => invoke('fs:list'),
  read: (path) => invoke('fs:read', path),
  readMany: (paths) => invoke('fs:readMany', paths),
  write: (path, content) => invoke('fs:write', path, content),
  writeChecked: (path, content, expectHash) => invoke('fs:writeChecked', path, content, expectHash),
  createAt: (path, content) => invoke('fs:createAt', path, content),
  createFile: (dir, baseName, ext) => invoke('fs:createFile', dir, baseName, ext),
  createFolder: (dir, name) => invoke('fs:createFolder', dir, name),
  saveAttachment: (dir, fileName, bytes) => invoke('fs:saveAttachment', dir, fileName, bytes),
  rename: (path, newName) => invoke('fs:rename', path, newName),
  move: (path, destDir) => invoke('fs:move', path, destDir),
  trash: (path) => invoke('fs:trash', path),
  reveal: (path) => invoke('fs:reveal', path),
  openExternal: (path) => invoke('fs:openExternal', path),
  openUrl: (url) => invoke('app:openUrl', url),
  log: (level, message) => invoke('app:log', level, message),
  listSnapshots: (path) => invoke('snapshots:list', path),
  readSnapshot: (path, id) => invoke('snapshots:read', path, id),
  keepSnapshot: (path, content) => invoke('snapshots:keep', path, content),
  journalPut: (path, content, baseHash) => invoke('journal:put', path, content, baseHash),
  journalRemove: (path) => invoke('journal:remove', path),
  journalList: () => invoke('journal:list'),

  onVaultChanged: (cb) => {
    const listener = (_e: IpcRendererEvent, paths: string[]): void => cb(paths)
    ipcRenderer.on('vault:changed', listener)
    return () => ipcRenderer.removeListener('vault:changed', listener)
  },
  onUpdateStatus: (cb) => {
    const listener = (_e: IpcRendererEvent, status: UpdateStatus): void => cb(status)
    ipcRenderer.on('update:state', listener)
    return () => ipcRenderer.removeListener('update:state', listener)
  },
  onOpenRequested: (cb) => {
    const listener = (): void => cb()
    ipcRenderer.on('app:open-requested', listener)
    return () => ipcRenderer.removeListener('app:open-requested', listener)
  },
  onBeforeClose: (cb) => {
    ipcRenderer.on('app:before-close', () => {
      cb().finally(() => ipcRenderer.send('app:ready-to-close'))
    })
  }
}

contextBridge.exposeInMainWorld('zenode', api)
