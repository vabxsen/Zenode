// The open vault's property types (.zenode/types.json), shared by every editor.
// Picking a type for a property sets it for that name across the vault.
import { sanitizeTypes, type PropertyType, type TypeRegistry } from './model'

let registry: TypeRegistry = {}
let saveError: (message: string) => void = () => undefined

export function propertyTypes(): TypeRegistry {
  return registry
}

export async function loadPropertyTypes(onError: (message: string) => void): Promise<void> {
  saveError = onError
  registry = sanitizeTypes(await window.zenode.readConfig('types').catch(() => null))
}

export function setPropertyType(key: string, type: PropertyType): void {
  registry = { ...registry, [key.toLowerCase()]: type }
  window.zenode.writeConfig('types', { types: registry }).catch((e: Error) => saveError(`Could not save property types: ${e.message}`))
}
