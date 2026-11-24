import {
  mergeSettings,
  WINDHAWK_SETTINGS_DEFAULTS,
  type ClickThroughMode,
  type IdleDisplayStyle,
  type PetStyle,
  type WindhawkSettings
} from './appearanceSettings';
import { normalizeLayoutSettings, type IslandLayoutSettings } from './layoutSettings';
import { readAppSetting, saveAppSetting } from './storage';

export interface SavedIslandProfile {
  id: string;
  name: string;
  settings: WindhawkSettings;
  layout: IslandLayoutSettings;
}

const SAVED_PROFILES_KEY = 'di-saved-profiles';

function sanitizeProfileSettings(raw: unknown): WindhawkSettings {
  const settings = mergeSettings<WindhawkSettings>(WINDHAWK_SETTINGS_DEFAULTS, raw);
  const validPets: PetStyle[] = ['none', 'luffy', 'ghost', 'bot', 'custom'];
  if (!validPets.includes(settings.appearance.petStyle)) {
    settings.appearance.petStyle = 'luffy';
  }
  const validClickThrough: ClickThroughMode[] = ['off', 'always', 'hold-alt-pass', 'hold-alt-interact'];
  if (!validClickThrough.includes(settings.appearance.clickThroughMode)) {
    settings.appearance.clickThroughMode = 'off';
  }
  const validIdleStyles: IdleDisplayStyle[] = ['standard', 'stealth', 'prayer', 'dual', 'hud', 'vinyl', 'ticker'];
  if (!validIdleStyles.includes(settings.appearance.idleStyle)) {
    settings.appearance.idleStyle = 'standard';
  }
  return settings;
}

export function readSavedProfiles(): SavedIslandProfile[] {
  const stored = readAppSetting<unknown>(SAVED_PROFILES_KEY, []);
  if (!Array.isArray(stored)) return [];
  return stored
    .filter((item): item is SavedIslandProfile => (
      Boolean(item)
      && typeof item === 'object'
      && typeof (item as SavedIslandProfile).id === 'string'
      && typeof (item as SavedIslandProfile).name === 'string'
      && Boolean((item as SavedIslandProfile).settings)
      && Boolean((item as SavedIslandProfile).layout)
    ))
    .map((item) => ({
      id: item.id,
      name: item.name,
      settings: sanitizeProfileSettings(item.settings),
      layout: normalizeLayoutSettings(item.layout)
    }));
}

export function saveProfiles(profiles: SavedIslandProfile[]): void {
  saveAppSetting(SAVED_PROFILES_KEY, profiles.slice(0, 12));
}

export function serializeConfigBundle(
  settings: WindhawkSettings,
  layout: IslandLayoutSettings
): string {
  return JSON.stringify({ version: 1, settings, layout }, null, 2);
}

export function parseConfigBundle(raw: string): {
  settings: WindhawkSettings;
  layout: IslandLayoutSettings;
} | null {
  try {
    const parsed = JSON.parse(raw) as { settings?: unknown; layout?: unknown };
    if (!parsed || typeof parsed !== 'object') return null;
    const settings = sanitizeProfileSettings(parsed.settings);
    const layout = normalizeLayoutSettings(parsed.layout);
    return { settings, layout };
  } catch {
    return null;
  }
}

