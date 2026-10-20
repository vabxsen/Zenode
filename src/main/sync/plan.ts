// Deciding what a sync pass does, file by file, from three views of each path:
//   base:   its hash when this computer last synced (absent if never synced)
//   local:  its hash on disk now (absent if it isn't there)
//   remote: what changed in the account since the last sync (absent if nothing)
// Nothing is ever silently lost: when both sides changed a file differently,
// this computer's version stays and the account's version is kept beside it
// as a conflict copy.

export interface RemoteChange {
  hash: string
  deleted: boolean
}

export interface SyncPlan {
  upload: string[]
  // Deleted here: mark deleted in the account.
  deleteRemote: string[]
  download: string[]
  // Deleted in the account: move to the trash here.
  deleteLocal: string[]
  // Both changed: keep this computer's version (and upload it), save the account's as a copy.
  conflict: string[]
  // What base becomes once the plan is carried out.
  base: Record<string, string>
}

export function planSync(base: Record<string, string>, local: Record<string, string>, remote: Record<string, RemoteChange>): SyncPlan {
  const plan: SyncPlan = { upload: [], deleteRemote: [], download: [], deleteLocal: [], conflict: [], base: {} }
  const paths = new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)])
  for (const path of paths) {
    const b = base[path]
    const l = local[path]
    const r = remote[path]
    const remoteHash = r && !r.deleted ? r.hash : undefined
    const localChanged = l !== b
    const remoteChanged = r !== undefined && remoteHash !== b
    let next: string | undefined = b
    if (!localChanged && !remoteChanged) {
      next = b
    } else if (localChanged && !remoteChanged) {
      if (l === undefined) plan.deleteRemote.push(path)
      else plan.upload.push(path)
      next = l
    } else if (!localChanged && remoteChanged) {
      if (remoteHash === undefined) {
        if (l !== undefined) plan.deleteLocal.push(path)
      } else plan.download.push(path)
      next = remoteHash
    } else if (l === remoteHash) {
      next = l
    } else if (l === undefined) {
      // Deleted here, edited elsewhere: the edit wins.
      plan.download.push(path)
      next = remoteHash
    } else if (remoteHash === undefined) {
      // Edited here, deleted elsewhere: the edit wins.
      plan.upload.push(path)
      next = l
    } else {
      plan.conflict.push(path)
      next = l
    }
    if (next !== undefined) plan.base[path] = next
  }
  for (const list of [plan.upload, plan.deleteRemote, plan.download, plan.deleteLocal, plan.conflict]) list.sort()
  return plan
}

// The name for the account's version of a file both sides changed, e.g.
// "Plan (Zenode conflict from LAPTOP 2026-10-20 154233).md". Zenode lists
// these with the other sync conflicts so they can be compared and merged.
export function conflictPath(path: string, device: string, when: Date): string {
  const slash = path.lastIndexOf('/')
  const dir = path.slice(0, slash + 1)
  const name = path.slice(slash + 1)
  const dot = name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ''
  const pad = (n: number): string => String(n).padStart(2, '0')
  const stamp = `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())} ${pad(when.getHours())}${pad(when.getMinutes())}${pad(when.getSeconds())}`
  return `${dir}${stem} (Zenode conflict from ${device} ${stamp})${ext}`
}

// A computer name that is safe inside a file name.
export function deviceLabel(hostname: string): string {
  const clean = hostname.replace(/[<>:"/\\|?*\x00-\x1f()]/g, '').trim().slice(0, 30)
  return clean || 'another computer'
}
