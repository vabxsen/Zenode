import type { ZenodeAPI } from '../../shared/api'

declare global {
  interface Window {
    zenode: ZenodeAPI
  }
}

export {}
