import { readAppSetting, saveAppSetting } from './settings';

export const WINDHAWK_SETTINGS_KEY = 'di-windhawk-settings';

export const WINDHAWK_SETTINGS_DEFAULTS = {
  appearance: {
    position: 'top-center',
    targetMonitor: 'primary',
    offsetX: 0,
    offsetY: 0,
    separateExpandedOffsetY: false,
    offsetYExpanded: 0,
    borderMergedMode: false,
    shapeStyle: 'default',
    progressStyle: 'slim',
    spectrumStyle: 'bars',
    sizeScale: '1.0',
    autoDpiScale: true
  },
  behavior: {
    alwaysOnTop: true,
    expandOnHover: true,
    autoHideIdleSeconds: 0,
    autoHideFullscreen: true,
    unhideOnHover: true
  },
  animations: {
    targetFps: 'auto',
    animationStyle: 'default',
    animationSpeed: 'normal',
    expandedMediaTransitions: false,
    pillCoverSpin: false
  },
  themes: {
    themePreset: 'obsidian',
    pillOpacity: 96,
    tintIntensity: 72,
    backdropMaterial: 'none',
    backdropFillOpacity: 45,
    backdropTint: 55,
    materialDepth: true,
    dropShadow: true,
    accentBloom: 100,
    textScale: 100,
    accentColorMode: 'auto',
    customAccentHex: '#4cc9f0',
    calendarAccent: 'red',
    clockAccentGlow: true,
    fontFamily: '',
    contourBorderMode: 'default',
    contourBorderHex: '#1E1E22',
    pillBgColor: '#08080A',
    textPrimaryColor: '#FFFFFF',
    textSecondaryColor: '#9B9BA5'
  },
  indicators: {
    privacyDots: true,
    privacyDotsMic: true,
    privacyDotsMicHex: '#FF9500',
    privacyDotsCam: true,
    privacyDotsCamHex: '#34C759'
  },
  modules: {
    media: true,
    mediaAutoExpand: false,
    mediaPillClock: false,
    volume: true,
    brightness: true,
    capsLock: true,
    battery: true,
    bluetoothIndicator: true,
    bluetoothShowBattery: true,
    progress: true,
    timerModule: true,
    clipboard: true,
    statusCountdownProgress: false,
    doNotDisturbIndicator: true,
    notificationRespectDnD: true,
    hardwareMonitorModule: true,
    gameOverlay: false,
    showMetricText: false,
    weather: true,
    weatherCity: '',
    weatherFahrenheit: false,
    mediaTabLyrics: false,
    lyrics: false,
    lyricsVisualizer: true,
    karaokeLyrics: true,
    karaokeLetterGlow: true,
    lyricsOffsetMs: 0,
    lyricsOffsetBluetoothMs: 0,
    lyricsNeighborLinesVisible: false,
    lyricsCache: true,
    lyricsCacheMaxMB: 25,
    language: 'auto',
    clockFormat: 'system',
    showSeconds: false,
    dateFormat: '',
    dateFirst: false,
    firstDayOfWeek: 'auto',
    quickLookup: false,
    fileTrayModule: false,
    fileTrayMaxItems: 10,
    fileTrayPersist: true,
    mediaExpandBlocklist: '',
    gameOverlayShowFps: true,
    gameOverlayShowCpu: true,
    gameOverlayShowGpu: true,
    gameOverlayShowRam: true,
    gameOverlayShowDisk: true,
    gameOverlayCompact: false
  },
  shortcuts: {
    hideShowHotkeyEnabled: true,
    hideShowModifiers: 'ctrl_alt',
    hideShowKey: 'D',
    lookupModifiers: 'ctrl_alt',
    lookupKey: 'Space'
  }
} as const;

export type WindhawkSettings = {
  appearance: {
    position: 'top-center' | 'top-left' | 'top-right' | 'bottom-center' | 'bottom-left' | 'bottom-right';
    targetMonitor: 'primary' | '1' | '2' | '3' | '4' | '5' | 'follow';
    offsetX: number;
    offsetY: number;
    separateExpandedOffsetY: boolean;
    offsetYExpanded: number;
    borderMergedMode: boolean;
    shapeStyle: 'default' | 'w11' | 'notch';
    progressStyle: 'slim' | 'wavy' | 'squiggle' | 'bar';
    spectrumStyle: 'bars' | 'led' | 'plasma' | 'orb';
    sizeScale: '0.8' | '1.0' | '1.2' | '1.5' | '1.8' | '2.0' | '2.5';
    autoDpiScale: boolean;
  };
  behavior: {
    alwaysOnTop: boolean;
    expandOnHover: boolean;
    autoHideIdleSeconds: -1 | 0 | 5 | 10 | 30 | 60;
    autoHideFullscreen: boolean;
    unhideOnHover: boolean;
  };
  animations: {
    targetFps: 'auto' | '60' | '90' | '120' | '144' | '165' | '240' | '360' | '500';
    animationStyle: 'smooth' | 'default' | 'bouncy' | 'snappy';
    animationSpeed: 'very-slow' | 'slow' | 'normal' | 'fast' | 'very-fast' | 'ultra-fast';
    expandedMediaTransitions: boolean;
    pillCoverSpin: boolean;
  };
  themes: {
    themePreset: 'obsidian' | 'graphite' | 'slate' | 'nord' | 'evergreen' | 'espresso' | 'plum' | 'porcelain' | 'custom';
    pillOpacity: number;
    tintIntensity: number;
    backdropMaterial: 'none' | 'blur' | 'acrylic';
    backdropFillOpacity: number;
    backdropTint: number;
    materialDepth: boolean;
    dropShadow: boolean;
    accentBloom: number;
    textScale: number;
    accentColorMode: 'auto' | 'system' | 'custom';
    customAccentHex: string;
    calendarAccent: 'red' | 'system';
    clockAccentGlow: boolean;
    fontFamily: string;
    contourBorderMode: 'default' | 'auto' | 'borderless';
    contourBorderHex: string;
    pillBgColor: string;
    textPrimaryColor: string;
    textSecondaryColor: string;
  };
  indicators: {
    privacyDots: boolean;
    privacyDotsMic: boolean;
    privacyDotsMicHex: string;
    privacyDotsCam: boolean;
    privacyDotsCamHex: string;
  };
  modules: {
    media: boolean;
    mediaAutoExpand: boolean;
    mediaPillClock: boolean;
    volume: boolean;
    brightness: boolean;
    capsLock: boolean;
    battery: boolean;
    bluetoothIndicator: boolean;
    bluetoothShowBattery: boolean;
    progress: boolean;
    timerModule: boolean;
    clipboard: boolean;
    statusCountdownProgress: boolean;
    doNotDisturbIndicator: boolean;
    notificationRespectDnD: boolean;
    hardwareMonitorModule: boolean;
    gameOverlay: boolean;
    showMetricText: boolean;
    weather: boolean;
    weatherCity: string;
    weatherFahrenheit: boolean;
    mediaTabLyrics: boolean;
    lyrics: boolean;
    lyricsVisualizer: boolean;
    karaokeLyrics: boolean;
    karaokeLetterGlow: boolean;
    lyricsOffsetMs: number;
    lyricsOffsetBluetoothMs: number;
    lyricsNeighborLinesVisible: boolean;
    lyricsCache: boolean;
    lyricsCacheMaxMB: 0 | 10 | 25 | 100;
    language: 'auto' | 'en' | 'fr' | 'es' | 'de' | 'pt' | 'it' | 'ru' | 'tr' | 'hi' | 'zh' | 'ja' | 'ko';
    clockFormat: 'system' | '12h' | '24h';
    showSeconds: boolean;
    dateFormat: string;
    dateFirst: boolean;
    firstDayOfWeek: 'auto' | 'monday' | 'sunday';
    quickLookup: boolean;
    fileTrayModule: boolean;
    fileTrayMaxItems: number;
    fileTrayPersist: boolean;
    mediaExpandBlocklist: string;
    gameOverlayShowFps: boolean;
    gameOverlayShowCpu: boolean;
    gameOverlayShowGpu: boolean;
    gameOverlayShowRam: boolean;
    gameOverlayShowDisk: boolean;
    gameOverlayCompact: boolean;
  };
  shortcuts: {
    hideShowHotkeyEnabled: boolean;
    hideShowModifiers: 'ctrl_alt' | 'ctrl_shift' | 'alt_shift' | 'win_alt' | 'ctrl_alt_shift';
    hideShowKey: string;
    lookupModifiers: 'ctrl_alt' | 'ctrl_shift' | 'alt_shift' | 'win_alt' | 'ctrl_alt_shift';
    lookupKey: string;
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mergeSettings<T>(defaults: T, stored: unknown): T {
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
