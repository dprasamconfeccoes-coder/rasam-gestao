import { useEffect, useState } from 'react'

function readValue<T>(storage: Storage, key: string, fallback: T): T {
  try {
    const raw = storage.getItem(key)
    return raw ? JSON.parse(raw) as T : fallback
  } catch { return fallback }
}

export function usePersistentState<T>(key: string, fallback: T, storage: Storage = sessionStorage) {
  const [value, setValue] = useState<T>(() => readValue(storage, key, fallback))
  useEffect(() => {
    try { storage.setItem(key, JSON.stringify(value)) } catch { /* armazenamento indisponível */ }
  }, [key, storage, value])
  return [value, setValue] as const
}

export function clearPersistentState(key: string, storage: Storage = sessionStorage) {
  try { storage.removeItem(key) } catch { /* armazenamento indisponível */ }
}
