import { invoke } from '@tauri-apps/api/core';

type SettingsMap = Record<string, unknown>;

const settings = new Map<string, unknown>();
const serializedCache = new Map<string, string>();
const pendingWrites = new Map<string, { value: unknown; timer: ReturnType<typeof setTimeout> }>();
let initialized = false;
let writeQueue: Promise<void> = Promise.resolve();

function parseLegacyValue(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function enqueuePersist(key: string, value: unknown): void {
  writeQueue = writeQueue
    .catch(() => undefined)
    .then(() => invoke('save_app_setting', { key, value }))
    .then(() => undefined)
    .catch((error: unknown) => {
      console.error(`Tidak dapat menyimpan pengaturan ${key}:`, error);
    });
}

function flushPendingWrites(): void {
  pendingWrites.forEach(({ value, timer }, key) => {
    clearTimeout(timer);
    enqueuePersist(key, value);
  });
  pendingWrites.clear();
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushPendingWrites);
  window.addEventListener('beforeunload', flushPendingWrites);
}

export async function initializeAppSettings(): Promise<void> {
  await invoke<SettingsMap>('load_app_settings');

  const legacyPreferences: SettingsMap = {};
  const legacyKeys: string[] = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key?.startsWith('di-')) continue;
    const value = localStorage.getItem(key);
    if (value === null) continue;
    legacyPreferences[key] = parseLegacyValue(value);
    legacyKeys.push(key);
  }

  const migrated = await invoke<SettingsMap>('migrate_legacy_settings', { legacyPreferences });
  settings.clear();
  serializedCache.clear();
  Object.entries(migrated).forEach(([key, value]) => {
    settings.set(key, value);
    try {
      serializedCache.set(key, JSON.stringify(value));
    } catch {
      // ignore non-serializable values
    }
  });
  legacyKeys.forEach((key) => localStorage.removeItem(key));
  initialized = true;
}

export function readAppSetting<T>(key: string, fallback: T): T {
  if (!initialized) {
    throw new Error('Pengaturan aplikasi belum selesai dimuat.');
  }
  return settings.has(key) ? settings.get(key) as T : fallback;
}

export function saveAppSetting(key: string, value: unknown): void {
  if (!initialized) {
    throw new Error('Pengaturan aplikasi belum selesai dimuat.');
  }
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch {
    serialized = undefined;
  }
  if (serialized !== undefined && serializedCache.get(key) === serialized) {
    return;
  }
  settings.set(key, value);
  if (serialized !== undefined) {
    serializedCache.set(key, serialized);
  }

  const existing = pendingWrites.get(key);
  if (existing) clearTimeout(existing.timer);
  const timer = setTimeout(() => {
    pendingWrites.delete(key);
    enqueuePersist(key, value);
  }, 300);
  pendingWrites.set(key, { value, timer });
}
