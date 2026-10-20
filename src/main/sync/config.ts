// Firebase and Google sign-in settings, baked in at build time from MAIN_VITE_*
// environment variables (.env.local when building locally, repository
// secrets in CI). Only the main process sees them.

export interface SyncConfig {
  firebaseApiKey: string
  projectId: string
  googleClientId: string
  // A desktop app's client secret isn't confidential (Google treats installed
  // apps as public clients), but it stays out of the repository anyway.
  googleClientSecret: string
}

export function syncConfig(): SyncConfig | null {
  const env = import.meta.env
  const config = {
    firebaseApiKey: env.MAIN_VITE_FIREBASE_API_KEY ?? '',
    projectId: env.MAIN_VITE_FIREBASE_PROJECT_ID ?? '',
    googleClientId: env.MAIN_VITE_GOOGLE_CLIENT_ID ?? '',
    googleClientSecret: env.MAIN_VITE_GOOGLE_CLIENT_SECRET ?? ''
  }
  return Object.values(config).every((v) => v.trim()) ? config : null
}
