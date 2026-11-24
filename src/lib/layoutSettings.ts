import { readAppSetting, saveAppSetting } from './storage';

export type IdleWidgetId = 'pet' | 'privacy' | 'live' | 'clock' | 'date' | 'battery';
export type LauncherItemId = 'tools' | 'music' | 'monitor' | 'ai' | 'capture' | 'lock';
export type ToolTabId = 'focus' | 'tasks' | 'notes' | 'ai' | 'clipboard' | 'shelf' | 'prayer' | 'capture';
export type LayoutPresetId = 'balanced' | 'minimal' | 'dashboard' | 'focus-mode';
export type ToolsNavLayout = 'auto' | 'top' | 'left' | 'right';
export type LauncherColumns = 2 | 3 | 4;

export interface LayoutItemConfig<T extends string> {
  id: T;
  visible: boolean;
}

export interface CustomShortcut {
  id: string;
  label: string;
  target: string;
}

export interface IslandLayoutSettings {
  preset: LayoutPresetId | 'custom';
  idleWidgets: LayoutItemConfig<IdleWidgetId>[];
  launcherItems: LayoutItemConfig<LauncherItemId>[];
  launcherColumns: LauncherColumns;
  customShortcuts: CustomShortcut[];
  toolsTabs: LayoutItemConfig<ToolTabId>[];
  toolsNavLayout: ToolsNavLayout;
  toolsTabLabels: boolean;
}

export const LAYOUT_SETTINGS_KEY = 'di-island-layout';

const ALL_IDLE_WIDGETS: IdleWidgetId[] = ['pet', 'privacy', 'live', 'clock', 'date', 'battery'];
const ALL_LAUNCHER_ITEMS: LauncherItemId[] = ['tools', 'music', 'monitor', 'ai', 'capture', 'lock'];
const ALL_TOOL_TABS: ToolTabId[] = ['focus', 'tasks', 'notes', 'ai', 'clipboard', 'shelf', 'prayer', 'capture'];

export const LAYOUT_PRESETS: Record<LayoutPresetId, IslandLayoutSettings> = {
  balanced: {
    preset: 'balanced',
    idleWidgets: [
      { id: 'pet', visible: true },
      { id: 'privacy', visible: true },
      { id: 'live', visible: true },
      { id: 'clock', visible: true },
      { id: 'date', visible: true },
      { id: 'battery', visible: true }
    ],
    launcherItems: [
      { id: 'tools', visible: true },
      { id: 'music', visible: true },
      { id: 'monitor', visible: true },
      { id: 'lock', visible: true },
      { id: 'ai', visible: false },
      { id: 'capture', visible: false }
    ],
    launcherColumns: 4,
    customShortcuts: [],
    toolsTabs: [
      { id: 'focus', visible: true },
      { id: 'tasks', visible: true },
      { id: 'notes', visible: true },
      { id: 'ai', visible: true },
      { id: 'clipboard', visible: true },
      { id: 'shelf', visible: true },
      { id: 'prayer', visible: true },
      { id: 'capture', visible: true }
    ],
    toolsNavLayout: 'auto',
    toolsTabLabels: false
  },
  minimal: {
    preset: 'minimal',
    idleWidgets: [
      { id: 'pet', visible: true },
      { id: 'privacy', visible: true },
      { id: 'clock', visible: true },
      { id: 'battery', visible: true },
      { id: 'date', visible: false },
      { id: 'live', visible: false }
    ],
    launcherItems: [
      { id: 'tools', visible: true },
      { id: 'music', visible: true },
      { id: 'monitor', visible: true },
      { id: 'lock', visible: true },
      { id: 'ai', visible: false },
      { id: 'capture', visible: false }
    ],
    launcherColumns: 2,
    customShortcuts: [],
    toolsTabs: [
      { id: 'focus', visible: true },
      { id: 'ai', visible: true },
      { id: 'capture', visible: true },
      { id: 'tasks', visible: false },
      { id: 'notes', visible: false },
      { id: 'clipboard', visible: false },
      { id: 'shelf', visible: false },
      { id: 'prayer', visible: false }
    ],
    toolsNavLayout: 'top',
    toolsTabLabels: false
  },
  dashboard: {
    preset: 'dashboard',
    idleWidgets: [
      { id: 'pet', visible: true },
      { id: 'privacy', visible: true },
      { id: 'live', visible: true },
      { id: 'clock', visible: true },
      { id: 'date', visible: true },
      { id: 'battery', visible: true }
    ],
    launcherItems: [
      { id: 'tools', visible: true },
      { id: 'music', visible: true },
      { id: 'monitor', visible: true },
      { id: 'ai', visible: true },
      { id: 'capture', visible: true },
      { id: 'lock', visible: true }
    ],
    launcherColumns: 3,
    customShortcuts: [],
    toolsTabs: [
      { id: 'ai', visible: true },
      { id: 'tasks', visible: true },
      { id: 'focus', visible: true },
      { id: 'capture', visible: true },
      { id: 'clipboard', visible: true },
      { id: 'shelf', visible: true },
      { id: 'prayer', visible: true },
      { id: 'notes', visible: true }
    ],
    toolsNavLayout: 'left',
    toolsTabLabels: false
  },
  'focus-mode': {
    preset: 'focus-mode',
    idleWidgets: [
      { id: 'clock', visible: true },
      { id: 'battery', visible: true },
      { id: 'privacy', visible: true },
      { id: 'pet', visible: false },
      { id: 'date', visible: false },
      { id: 'live', visible: false }
    ],
    launcherItems: [
      { id: 'tools', visible: true },
      { id: 'music', visible: true },
      { id: 'lock', visible: true },
      { id: 'monitor', visible: false },
      { id: 'ai', visible: false },
      { id: 'capture', visible: false }
    ],
    launcherColumns: 3,
    customShortcuts: [],
    toolsTabs: [
      { id: 'focus', visible: true },
      { id: 'tasks', visible: true },
      { id: 'prayer', visible: true },
      { id: 'notes', visible: true },
      { id: 'ai', visible: false },
      { id: 'clipboard', visible: false },
      { id: 'shelf', visible: false },
      { id: 'capture', visible: false }
    ],
    toolsNavLayout: 'top',
    toolsTabLabels: true
  }
};

function normalizeItemList<T extends string>(
  stored: unknown,
  allIds: readonly T[],
  defaults: LayoutItemConfig<T>[],
  alwaysVisible?: T
): LayoutItemConfig<T>[] {
  if (!Array.isArray(stored)) return defaults.map((item) => ({ ...item }));
  const seen = new Set<T>();
  const result: LayoutItemConfig<T>[] = [];
  for (const entry of stored) {
    if (!entry || typeof entry !== 'object') continue;
    const candidate = entry as { id?: unknown; visible?: unknown };
    if (typeof candidate.id !== 'string') continue;
    const id = candidate.id as T;
    if (!allIds.includes(id) || seen.has(id)) continue;
    seen.add(id);
    result.push({
      id,
      visible: id === alwaysVisible ? true : typeof candidate.visible === 'boolean' ? candidate.visible : true
    });
  }
  for (const fallback of defaults) {
    if (!seen.has(fallback.id)) {
      result.push({ ...fallback, visible: fallback.id === alwaysVisible ? true : fallback.visible });
    }
  }
  return result;
}

export function normalizeLayoutSettings(raw: unknown): IslandLayoutSettings {
  const defaults = LAYOUT_PRESETS.balanced;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      ...defaults,
      idleWidgets: defaults.idleWidgets.map((i) => ({ ...i })),
      launcherItems: defaults.launcherItems.map((i) => ({ ...i })),
      toolsTabs: defaults.toolsTabs.map((i) => ({ ...i }))
    };
  }
  const record = raw as Record<string, unknown>;
  const preset = record.preset;
  const validPresets = ['balanced', 'minimal', 'dashboard', 'focus-mode', 'custom'];
  const cols = record.launcherColumns;
  const nav = record.toolsNavLayout;
  const validNavs: ToolsNavLayout[] = ['auto', 'top', 'left', 'right'];

  const rawShortcuts = Array.isArray(record.customShortcuts) ? record.customShortcuts : [];
  const customShortcuts: CustomShortcut[] = rawShortcuts
    .filter((entry): entry is CustomShortcut => (
      Boolean(entry)
      && typeof entry === 'object'
      && typeof (entry as CustomShortcut).id === 'string'
      && typeof (entry as CustomShortcut).label === 'string'
      && typeof (entry as CustomShortcut).target === 'string'
      && Boolean((entry as CustomShortcut).label.trim())
      && Boolean((entry as CustomShortcut).target.trim())
    ))
    .slice(0, 8);

  return {
    preset: typeof preset === 'string' && validPresets.includes(preset)
      ? (preset as IslandLayoutSettings['preset'])
      : 'custom',
    idleWidgets: normalizeItemList(record.idleWidgets, ALL_IDLE_WIDGETS, defaults.idleWidgets),
    launcherItems: normalizeItemList(record.launcherItems, ALL_LAUNCHER_ITEMS, defaults.launcherItems),
    launcherColumns: cols === 2 || cols === 3 || cols === 4 ? cols : defaults.launcherColumns,
    customShortcuts,
    toolsTabs: normalizeItemList(record.toolsTabs, ALL_TOOL_TABS, defaults.toolsTabs, 'focus'),
    toolsNavLayout: typeof nav === 'string' && validNavs.includes(nav as ToolsNavLayout)
      ? (nav as ToolsNavLayout)
      : defaults.toolsNavLayout,
    toolsTabLabels: typeof record.toolsTabLabels === 'boolean' ? record.toolsTabLabels : defaults.toolsTabLabels
  };
}

export function readLayoutSettings(): IslandLayoutSettings {
  const stored = readAppSetting<unknown>(LAYOUT_SETTINGS_KEY, null);
  return normalizeLayoutSettings(stored);
}

export function saveLayoutSettings(layout: IslandLayoutSettings): void {
  saveAppSetting(LAYOUT_SETTINGS_KEY, layout);
}

export function cloneLayoutPreset(presetId: LayoutPresetId, keepShortcuts: CustomShortcut[] = []): IslandLayoutSettings {
  const source = LAYOUT_PRESETS[presetId];
  return {
    ...source,
    idleWidgets: source.idleWidgets.map((item) => ({ ...item })),
    launcherItems: source.launcherItems.map((item) => ({ ...item })),
    customShortcuts: keepShortcuts.map((item) => ({ ...item })),
    toolsTabs: source.toolsTabs.map((item) => ({ ...item }))
  };
}

