import { readAppSetting, saveAppSetting } from './storage';

export const WINDHAWK_SETTINGS_KEY = 'di-windhawk-settings';

export type PetStyle = 'none' | 'luffy' | 'ghost' | 'bot' | 'custom';
export type IslandShapeStyle = 'default' | 'w11' | 'notch' | 'capsule' | 'sharp' | 'cyber';
export type ClockFormat = '24h' | '12h';
export type DateFormatStyle = 'short' | 'numeric' | 'full';
export type AnimationSpeed = 'snappy' | 'normal' | 'smooth' | 'off';
export type ClickThroughMode = 'off' | 'always' | 'hold-alt-pass' | 'hold-alt-interact';

export const WINDHAWK_SETTINGS_DEFAULTS = {
  appearance: {
    shapeStyle: 'default',
    sizeScale: '1.0',
    petStyle: 'luffy',
    customPetImage: '',
    petIdleMinutes: 10,
    edgeOffset: 0,
    monitorIndex: -1,
    scrollControlEnabled: true,
    autoHideFullscreen: true,
    clickThroughMode: 'off',
    clockFormat: '24h',
    showSeconds: false,
    dateFormat: 'short',
    animationSpeed: 'normal',
    noticeDurationSec: 4,
    panelWidth: 368,
    panelHeight: 332
  },
  themes: {
    themePreset: 'obsidian',
    pillOpacity: 96,
    textScale: 100,
    fontFamily: '',
    textColorOverride: '',
    bgGradientEnabled: false,
    bgGradientTo: '#1e293b',
    borderGlowEnabled: false,
    borderGlowColor: '#60a5fa',
    musicReactiveGlow: false,
    contourBorderHex: '#1E1E22',
    pillBgColor: '#08080A',
    textPrimaryColor: '#FFFFFF'
  }
} as const;

export type WindhawkSettings = {
  appearance: {
    shapeStyle: IslandShapeStyle;
    sizeScale: '0.8' | '1.0' | '1.2' | '1.5' | '1.8' | '2.0' | '2.5';
    petStyle: PetStyle;
    customPetImage: string;
    petIdleMinutes: number;
    edgeOffset: number;
    monitorIndex: number;
    scrollControlEnabled: boolean;
    autoHideFullscreen: boolean;
    clickThroughMode: ClickThroughMode;
    clockFormat: ClockFormat;
    showSeconds: boolean;
    dateFormat: DateFormatStyle;
    animationSpeed: AnimationSpeed;
    noticeDurationSec: number;
    panelWidth: number;
    panelHeight: number;
  };
  themes: {
    themePreset: 'obsidian' | 'graphite' | 'slate' | 'nord' | 'evergreen' | 'espresso' | 'plum' | 'porcelain' | 'custom';
    pillOpacity: number;
    textScale: number;
    fontFamily: string;
    textColorOverride: string;
    bgGradientEnabled: boolean;
    bgGradientTo: string;
    borderGlowEnabled: boolean;
    borderGlowColor: string;
    musicReactiveGlow: boolean;
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
  const merged = mergeSettings<WindhawkSettings>(WINDHAWK_SETTINGS_DEFAULTS, stored);
  const validPets: PetStyle[] = ['none', 'luffy', 'ghost', 'bot', 'custom'];
  if (!validPets.includes(merged.appearance.petStyle)) {
    merged.appearance.petStyle = 'luffy';
  }
  const validClickThrough: ClickThroughMode[] = ['off', 'always', 'hold-alt-pass', 'hold-alt-interact'];
  if (!validClickThrough.includes(merged.appearance.clickThroughMode)) {
    merged.appearance.clickThroughMode = 'off';
  }
  return merged;
}

export function saveWindhawkSettings(settings: WindhawkSettings): void {
  saveAppSetting(WINDHAWK_SETTINGS_KEY, settings);
}
