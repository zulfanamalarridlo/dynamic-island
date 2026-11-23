import { invoke } from '@tauri-apps/api/core';

type SettingsMap = Record<string, unknown>;

const settings = new Map<string, unknown>();
let initialized = false;
let writeQueue: Promise<void> = Promise.resolve();

function parseLegacyValue(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
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
  Object.entries(migrated).forEach(([key, value]) => settings.set(key, value));
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
  settings.set(key, value);
  writeQueue = writeQueue
    .catch(() => undefined)
    .then(() => invoke('save_app_setting', { key, value }))
    .then(() => undefined)
    .catch((error: unknown) => {
      console.error(`Tidak dapat menyimpan pengaturan ${key}:`, error);
    });
}
