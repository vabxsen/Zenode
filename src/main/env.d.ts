// Build-time settings for the main process (see sync/config.ts).
interface ImportMetaEnv {
  readonly MAIN_VITE_FIREBASE_API_KEY?: string
  readonly MAIN_VITE_FIREBASE_PROJECT_ID?: string
  readonly MAIN_VITE_GOOGLE_CLIENT_ID?: string
  readonly MAIN_VITE_GOOGLE_CLIENT_SECRET?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
