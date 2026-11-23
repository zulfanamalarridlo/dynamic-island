import { mergeSettings, WINDHAWK_SETTINGS_DEFAULTS, type WindhawkSettings } from './appearanceSettings';
import { LAYOUT_PRESETS, type IslandLayoutSettings } from './layoutSettings';
import { readAppSetting, saveAppSetting } from './storage';

export interface SavedIslandProfile {
  id: string;
  name: string;
  settings: WindhawkSettings;
  layout: IslandLayoutSettings;
}

const SAVED_PROFILES_KEY = 'di-saved-profiles';

export function readSavedProfiles(): SavedIslandProfile[] {
  const stored = readAppSetting<unknown>(SAVED_PROFILES_KEY, []);
  if (!Array.isArray(stored)) return [];
  return stored.filter((item): item is SavedIslandProfile => (
    Boolean(item)
    && typeof item === 'object'
    && typeof (item as SavedIslandProfile).id === 'string'
    && typeof (item as SavedIslandProfile).name === 'string'
    && Boolean((item as SavedIslandProfile).settings)
    && Boolean((item as SavedIslandProfile).layout)
  ));
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
    const settings = mergeSettings<WindhawkSettings>(WINDHAWK_SETTINGS_DEFAULTS, parsed.settings);
    const layoutRecord = parsed.layout && typeof parsed.layout === 'object'
      ? parsed.layout as Partial<IslandLayoutSettings>
      : {};
    const layout: IslandLayoutSettings = {
      ...LAYOUT_PRESETS.balanced,
      ...layoutRecord,
      idleWidgets: Array.isArray(layoutRecord.idleWidgets) ? layoutRecord.idleWidgets : LAYOUT_PRESETS.balanced.idleWidgets,
      launcherItems: Array.isArray(layoutRecord.launcherItems) ? layoutRecord.launcherItems : LAYOUT_PRESETS.balanced.launcherItems,
      customShortcuts: Array.isArray(layoutRecord.customShortcuts) ? layoutRecord.customShortcuts : [],
      toolsTabs: Array.isArray(layoutRecord.toolsTabs) ? layoutRecord.toolsTabs : LAYOUT_PRESETS.balanced.toolsTabs
    };
    return { settings, layout };
  } catch {
    return null;
  }
}

