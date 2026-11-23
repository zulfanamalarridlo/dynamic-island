import { readAppSetting, saveAppSetting } from './settings';

export const WINDHAWK_SETTINGS_KEY = 'di-windhawk-settings';

export const WINDHAWK_SETTINGS_DEFAULTS = {
  appearance: {
    shapeStyle: 'default',
    sizeScale: '1.0'
  },
  themes: {
    themePreset: 'obsidian',
    pillOpacity: 96,
    textScale: 100,
    fontFamily: '',
    contourBorderHex: '#1E1E22',
    pillBgColor: '#08080A',
    textPrimaryColor: '#FFFFFF'
  }
} as const;

export type WindhawkSettings = {
  appearance: {
    shapeStyle: 'default' | 'w11' | 'notch';
    sizeScale: '0.8' | '1.0' | '1.2' | '1.5' | '1.8' | '2.0' | '2.5';
  };
  themes: {
    themePreset: 'obsidian' | 'graphite' | 'slate' | 'nord' | 'evergreen' | 'espresso' | 'plum' | 'porcelain' | 'custom';
    pillOpacity: number;
    textScale: number;
    fontFamily: string;
    contourBorderHex: string;
    pillBgColor: string;
    textPrimaryColor: string;
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function mergeSettings<T>(defaults: T, stored: unknown): T {
  if (!isRecord(defaults) || !isRecord(stored)) return defaults;
  const merged: Record<string, unknown> = { ...defaults };
  for (const [key, defaultValue] of Object.entries(defaults)) {
    const storedValue = stored[key];
    if (isRecord(defaultValue)) {
      merged[key] = mergeSettings(defaultValue, storedValue);
    } else if (typeof storedValue === typeof defaultValue) {
      merged[key] = storedValue;
    }
  }
  return merged as T;
}

export function readWindhawkSettings(): WindhawkSettings {
  const stored = readAppSetting<unknown>(WINDHAWK_SETTINGS_KEY, null);
  return mergeSettings<WindhawkSettings>(WINDHAWK_SETTINGS_DEFAULTS, stored);
}

export function saveWindhawkSettings(settings: WindhawkSettings): void {
  saveAppSetting(WINDHAWK_SETTINGS_KEY, settings);
}
