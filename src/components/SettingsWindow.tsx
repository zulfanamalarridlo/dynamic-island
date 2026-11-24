import { useEffect, useState, type FormEvent } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import {
  Activity, Bell, CheckCircle2, KeyRound, LayoutTemplate, Palette, Plus, RotateCcw, Save,
  Settings, Smile, Trash2, Upload
} from 'lucide-react';
import LayoutEditor from './LayoutEditor';
import { localize, readAppLanguage, type AppLanguage } from '../lib/i18n';
import { readAppSetting, saveAppSetting, updateCachedAppSetting } from '../lib/storage';
import {
  readWindhawkSettings,
  saveWindhawkSettings,
  WINDHAWK_SETTINGS_KEY,
  type AnimationSpeed,
  type ClickThroughMode,
  type ClockFormat,
  type DateFormatStyle,
  type IdleDisplayStyle,
  type IslandShapeStyle,
  type WindhawkSettings
} from '../lib/appearanceSettings';
import {
  LAYOUT_SETTINGS_KEY,
  readLayoutSettings,
  saveLayoutSettings,
  type IslandLayoutSettings
} from '../lib/layoutSettings';
import {
  parseConfigBundle,
  readSavedProfiles,
  saveProfiles,
  serializeConfigBundle,
  type SavedIslandProfile
} from '../lib/profiles';
import { ACTIVITY_MODULE_DEFAULTS, type ActivityModule, type ActivityModuleSettings } from '../types';

type SettingsSection = 'general' | 'theme' | 'layout' | 'profiles' | 'pet' | 'activity' | 'clickup';
type IslandPosition = 0 | 1 | 2;

interface MonitorOption {
  index: number;
  name: string;
  width: number;
  height: number;
  isPrimary: boolean;
}

interface WindowsStartupConfig {
  enabled: boolean;
  startHidden: boolean;
  delaySeconds: number;
  isDebugBuild: boolean;
}

interface ClickUpConfig {
  api_key_configured: boolean;
  list_ids: string[];
  settings_path: string;
}

const WINDHAWK_THEMES = [
  ['obsidian', 'Obsidian', '#08080a'],
  ['graphite', 'Graphite', '#18181b'],
  ['slate', 'Slate', '#1e293b'],
  ['nord', 'Nord', '#2e3440'],
  ['evergreen', 'Evergreen', '#0c2118'],
  ['espresso', 'Espresso', '#21180f'],
  ['plum', 'Plum', '#241b2f'],
  ['porcelain', 'Porcelain', '#f4f2ee'],
  ['custom', 'Custom', '#1e293b']
] as const;

const ACTIVITY_LABELS: { id: ActivityModule; idLabel: string; enLabel: string }[] = [
  { id: 'capsLock', idLabel: 'Caps Lock', enLabel: 'Caps Lock' },
  { id: 'numLock', idLabel: 'Num Lock', enLabel: 'Num Lock' },
  { id: 'scrollLock', idLabel: 'Scroll Lock', enLabel: 'Scroll Lock' },
  { id: 'microphone', idLabel: 'Mute Mikrofon', enLabel: 'Microphone Mute' },
  { id: 'speaker', idLabel: 'Mute Speaker', enLabel: 'Speaker Mute' },
  { id: 'volume', idLabel: 'Perubahan Volume', enLabel: 'Volume Change' },
  { id: 'clipboard', idLabel: 'Aktivitas Clipboard', enLabel: 'Clipboard Activity' },
  { id: 'brightness', idLabel: 'Kecerahan Layar', enLabel: 'Display Brightness' },
  { id: 'wifi', idLabel: 'Status Wi-Fi', enLabel: 'Wi-Fi Status' },
  { id: 'power', idLabel: 'Daya / Charger', enLabel: 'Power / Charger' },
  { id: 'battery', idLabel: 'Baterai Rendah & Penuh', enLabel: 'Battery Low & Full' }
];

function readPosition(): IslandPosition {
  const raw = readAppSetting<unknown>('di-island-position', 0);
  return raw === 1 || raw === 2 ? raw : 0;
}

function readActivity(): ActivityModuleSettings {
  const stored = readAppSetting<unknown>('di-activity-modules', null);
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
    return { ...ACTIVITY_MODULE_DEFAULTS };
  }
  const merged: ActivityModuleSettings = { ...ACTIVITY_MODULE_DEFAULTS };
  for (const key of Object.keys(ACTIVITY_MODULE_DEFAULTS) as ActivityModule[]) {
    const val = (stored as Record<string, unknown>)[key];
    if (typeof val === 'boolean') merged[key] = val;
  }
  return merged;
}

export default function SettingsWindow() {
  const [section, setSection] = useState<SettingsSection>('general');
  const [language, setLanguage] = useState<AppLanguage>(readAppLanguage);
  const [islandPosition, setIslandPosition] = useState<IslandPosition>(readPosition);
  const [settings, setSettings] = useState<WindhawkSettings>(readWindhawkSettings);
  const [layout, setLayout] = useState<IslandLayoutSettings>(readLayoutSettings);
  const [activityModules, setActivityModules] = useState<ActivityModuleSettings>(readActivity);
  const [notifEnabled, setNotifEnabled] = useState<boolean>(() => Boolean(readAppSetting('di-windows-notification-notices', true)));
  const [notifFilters, setNotifFilters] = useState<Record<string, boolean>>(() => {
    const raw = readAppSetting<unknown>('di-notification-app-filters', {});
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, boolean>) : {};
  });
  const [newNotifApp, setNewNotifApp] = useState('');
  const [monitors, setMonitors] = useState<MonitorOption[]>([]);
  const [startupConfig, setStartupConfig] = useState<WindowsStartupConfig>({
    enabled: false,
    startHidden: false,
    delaySeconds: 0,
    isDebugBuild: false
  });
  const [startupBusy, setStartupBusy] = useState(false);
  const [startupStatus, setStartupStatus] = useState('');
  const [savedProfiles, setSavedProfiles] = useState<SavedIslandProfile[]>(readSavedProfiles);
  const [newProfileName, setNewProfileName] = useState('');
  const [importJson, setImportJson] = useState('');
  const [statusBanner, setStatusBanner] = useState('');
  const [clickUpConfig, setClickUpConfig] = useState<ClickUpConfig | null>(null);
  const [clickUpApiKey, setClickUpApiKey] = useState('');
  const [clickUpListIds, setClickUpListIds] = useState('');
  const [clickUpStatus, setClickUpStatus] = useState('');

  useEffect(() => {
    void invoke<MonitorOption[]>('list_monitors').then(setMonitors).catch(() => {});
    void invoke<WindowsStartupConfig>('get_windows_startup_config').then(setStartupConfig).catch(() => {});
    void invoke<ClickUpConfig>('get_clickup_config').then((cfg) => {
      setClickUpConfig(cfg);
      setClickUpListIds(cfg.list_ids.join(', '));
    }).catch(() => {});
  }, []);

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | null = null;
    void listen<{ key: string; value: unknown }>('app-setting-changed', (event) => {
      if (!active) return;
      const { key, value } = event.payload;
      updateCachedAppSetting(key, value);
      if (key === WINDHAWK_SETTINGS_KEY) setSettings(readWindhawkSettings());
      else if (key === LAYOUT_SETTINGS_KEY) setLayout(readLayoutSettings());
      else if (key === 'di-island-position') setIslandPosition(value === 1 || value === 2 ? value : 0);
      else if (key === 'di-language' && (value === 'id' || value === 'en')) setLanguage(value);
    }).then((stop) => {
      if (active) unlisten = stop;
      else stop();
    });
    return () => {
      active = false;
      unlisten?.();
    };
  }, []);

  const flashStatus = (msg: string) => {
    setStatusBanner(msg);
    window.setTimeout(() => setStatusBanner((cur) => (cur === msg ? '' : cur)), 2400);
  };

  const updateSettings = (next: WindhawkSettings) => {
    setSettings(next);
    saveWindhawkSettings(next);
  };

  const updateLayout = (next: IslandLayoutSettings) => {
    setLayout(next);
    saveLayoutSettings(next);
  };

  const updatePosition = (pos: IslandPosition) => {
    setIslandPosition(pos);
    saveAppSetting('di-island-position', pos);
  };

  const updateLanguage = (lang: AppLanguage) => {
    setLanguage(lang);
    saveAppSetting('di-language', lang);
  };

  const updateStartup = async (next: { enabled: boolean; startHidden: boolean; delaySeconds: number }) => {
    setStartupBusy(true);
    setStartupStatus('');
    try {
      const updated = await invoke<WindowsStartupConfig>('set_windows_startup_config', next);
      setStartupConfig(updated);
      flashStatus(localize(language, 'Auto-startup diperbarui', 'Auto-startup updated'));
    } catch (error) {
      setStartupStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setStartupBusy(false);
    }
  };

  const handleSaveClickUp = async (event: FormEvent) => {
    event.preventDefault();
    try {
      const cfg = await invoke<ClickUpConfig>('save_clickup_config', {
        apiKey: clickUpApiKey,
        listIds: clickUpListIds
      });
      setClickUpConfig(cfg);
      setClickUpApiKey('');
      setClickUpListIds(cfg.list_ids.join(', '));
      setClickUpStatus(localize(language, 'Konfigurasi ClickUp tersimpan.', 'ClickUp configuration saved.'));
    } catch (error) {
      setClickUpStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const navItems: { id: SettingsSection; label: string; icon: React.ReactNode }[] = [
    { id: 'general', label: localize(language, 'Umum', 'General'), icon: <Settings size={15} /> },
    { id: 'theme', label: localize(language, 'Tema & Ukuran', 'Theme & Size'), icon: <Palette size={15} /> },
    { id: 'layout', label: localize(language, 'Tata Letak', 'Layout Builder'), icon: <LayoutTemplate size={15} /> },
    { id: 'profiles', label: localize(language, 'Profil & Backup', 'Profiles'), icon: <Save size={15} /> },
    { id: 'pet', label: localize(language, 'Karakter Pet', 'Island Pet'), icon: <Smile size={15} /> },
    { id: 'activity', label: localize(language, 'Aktivitas & Notif', 'Activity & Notif'), icon: <Activity size={15} /> },
    { id: 'clickup', label: 'ClickUp', icon: <KeyRound size={15} /> }
  ];

  return (
    <div className="settings-window">
      <aside className="settings-window__sidebar">
        <div className="settings-window__brand">
          <strong>Dynamic Island</strong>
          <span>{localize(language, 'Pengaturan', 'Settings')}</span>
        </div>
        <nav className="settings-window__nav">
          {navItems.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`settings-window__nav-item${section === item.id ? ' is-active' : ''}`}
              onClick={() => setSection(item.id)}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="settings-window__sync-badge">
          <CheckCircle2 size={13} />
          <span>{statusBanner || localize(language, 'Sinkron langsung aktif', 'Live sync active')}</span>
        </div>
      </aside>

      <main className="settings-window__content">
        {section === 'general' && (
          <div className="settings-window__page">
            <h2>{localize(language, 'Pengaturan Umum', 'General Settings')}</h2>
            <div className="settings-window__grid">
              <div className="settings-window__card">
                <label className="settings-language-field">
                  <span>{localize(language, 'Bahasa', 'Language')}</span>
                  <select value={language} onChange={(e) => updateLanguage(e.target.value as AppLanguage)}>
                    <option value="id">Indonesia</option>
                    <option value="en">English</option>
                  </select>
                </label>
                <label className="settings-language-field">
                  <span>{localize(language, 'Posisi Island', 'Island position')}</span>
                  <select value={islandPosition} onChange={(e) => updatePosition(Number(e.target.value) as IslandPosition)}>
                    <option value={0}>{localize(language, 'Atas Tengah', 'Top Center')}</option>
                    <option value={1}>{localize(language, 'Kiri Tengah', 'Left Center')}</option>
                    <option value={2}>{localize(language, 'Kanan Tengah', 'Right Center')}</option>
                  </select>
                </label>
                <label className="settings-language-field">
                  <span>Monitor</span>
                  <select
                    value={settings.appearance.monitorIndex}
                    onChange={(e) => updateSettings({ ...settings, appearance: { ...settings.appearance, monitorIndex: Number(e.target.value) } })}
                  >
                    <option value={-1}>{localize(language, 'Monitor utama (otomatis)', 'Primary monitor (auto)')}</option>
                    {monitors.map((m) => (
                      <option key={m.index} value={m.index}>
                        {m.name} ({m.width}×{m.height}){m.isPrimary ? ' ★' : ''}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="settings-language-field">
                  <span>{localize(language, 'Gaya & bentuk', 'Shape & style')}</span>
                  <select
                    value={settings.appearance.shapeStyle}
                    onChange={(e) => updateSettings({ ...settings, appearance: { ...settings.appearance, shapeStyle: e.target.value as IslandShapeStyle } })}
                  >
                    <option value="default">Pill</option>
                    <option value="w11">Windows 11</option>
                    <option value="notch">macOS Notch</option>
                    <option value="capsule">Capsule</option>
                    <option value="sharp">Minimal Sharp</option>
                    <option value="cyber">Cyber Chamfer</option>
                  </select>
                </label>
                <label className="settings-language-field">
                  <span>{localize(language, 'Mode tampilan Idle', 'Idle display mode')}</span>
                  <select
                    value={settings.appearance.idleStyle}
                    onChange={(e) => updateSettings({ ...settings, appearance: { ...settings.appearance, idleStyle: e.target.value as IdleDisplayStyle } })}
                  >
                    <option value="standard">{localize(language, 'Standar', 'Standard')}</option>
                    <option value="stealth">{localize(language, 'Stealth (mekar saat hover)', 'Stealth (expand on hover)')}</option>
                    <option value="prayer">{localize(language, 'Countdown salat', 'Prayer countdown')}</option>
                    <option value="dual">{localize(language, 'Dual-Pill Split', 'Dual-Pill Split')}</option>
                    <option value="hud">{localize(language, 'HUD Developer / Gamer', 'Developer / Gamer HUD')}</option>
                    <option value="vinyl">{localize(language, 'Vinyl Spin', 'Vinyl Spin')}</option>
                    <option value="ticker">{localize(language, 'Smart Status Ticker', 'Smart Status Ticker')}</option>
                  </select>
                </label>
              </div>

              <div className="settings-window__card">
                <label className="settings-language-field">
                  <span>{localize(language, 'Tembus klik', 'Click-through')}</span>
                  <select
                    value={settings.appearance.clickThroughMode}
                    onChange={(e) => updateSettings({ ...settings, appearance: { ...settings.appearance, clickThroughMode: e.target.value as ClickThroughMode } })}
                  >
                    <option value="off">{localize(language, 'Mati (normal)', 'Off (normal)')}</option>
                    <option value="hold-alt-pass">{localize(language, 'Tahan Alt → tembus', 'Hold Alt → pass through')}</option>
                    <option value="hold-alt-interact">{localize(language, 'Tembus saat idle (tahan Alt klik)', 'Pass idle (hold Alt to click)')}</option>
                    <option value="always">{localize(language, 'Selalu tembus klik', 'Always click-through')}</option>
                  </select>
                </label>
                <div className="settings-shortcut-hints">
                  <span><kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>G</kbd> {localize(language, 'Toggle tembus klik', 'Toggle click-through')}</span>
                  <span><kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>Space</kbd> {localize(language, 'Sembunyikan / tampilkan', 'Hide / show panel')}</span>
                </div>
                <label className="settings-inline-row">
                  <span>{localize(language, 'Scroll volume & kecerahan', 'Scroll volume & brightness')}</span>
                  <input
                    type="checkbox"
                    role="switch"
                    checked={settings.appearance.scrollControlEnabled}
                    onChange={(e) => updateSettings({ ...settings, appearance: { ...settings.appearance, scrollControlEnabled: e.target.checked } })}
                  />
                </label>
                <label className="settings-inline-row">
                  <span>{localize(language, 'Auto-sembunyi saat fullscreen', 'Auto-hide in fullscreen')}</span>
                  <input
                    type="checkbox"
                    role="switch"
                    checked={settings.appearance.autoHideFullscreen}
                    onChange={(e) => updateSettings({ ...settings, appearance: { ...settings.appearance, autoHideFullscreen: e.target.checked } })}
                  />
                </label>
                <label className="settings-inline-row">
                  <span>{localize(language, 'Auto-startup Windows', 'Windows auto-startup')}</span>
                  <input
                    type="checkbox"
                    role="switch"
                    disabled={startupBusy || (startupConfig.isDebugBuild && !startupConfig.enabled)}
                    checked={startupConfig.enabled}
                    onChange={(e) => { void updateStartup({ enabled: e.target.checked, startHidden: startupConfig.startHidden, delaySeconds: startupConfig.delaySeconds }); }}
                  />
                </label>
                {startupConfig.enabled && (
                  <>
                    <label className="settings-inline-row">
                      <span>{localize(language, 'Mulai tersembunyi di Tray', 'Start hidden in Tray')}</span>
                      <input
                        type="checkbox"
                        role="switch"
                        checked={startupConfig.startHidden}
                        onChange={(e) => { void updateStartup({ enabled: true, startHidden: e.target.checked, delaySeconds: startupConfig.delaySeconds }); }}
                      />
                    </label>
                    <label className="settings-language-field">
                      <span>{localize(language, 'Delay startup', 'Startup delay')}</span>
                      <select
                        value={startupConfig.delaySeconds}
                        onChange={(e) => { void updateStartup({ enabled: true, startHidden: startupConfig.startHidden, delaySeconds: Number(e.target.value) }); }}
                      >
                        <option value={0}>0s</option>
                        <option value={3}>3s</option>
                        <option value={5}>5s</option>
                        <option value={10}>10s</option>
                      </select>
                    </label>
                  </>
                )}
                {startupStatus && <p className="tool-status">{startupStatus}</p>}
              </div>

              <div className="settings-window__card">
                <label className="settings-language-field">
                  <span>{localize(language, 'Format jam', 'Clock format')}</span>
                  <select
                    value={settings.appearance.clockFormat}
                    onChange={(e) => updateSettings({ ...settings, appearance: { ...settings.appearance, clockFormat: e.target.value as ClockFormat } })}
                  >
                    <option value="24h">24h</option>
                    <option value="12h">12h (AM/PM)</option>
                  </select>
                </label>
                <label className="settings-inline-row">
                  <span>{localize(language, 'Tampilkan detik', 'Show seconds')}</span>
                  <input
                    type="checkbox"
                    role="switch"
                    checked={settings.appearance.showSeconds}
                    onChange={(e) => updateSettings({ ...settings, appearance: { ...settings.appearance, showSeconds: e.target.checked } })}
                  />
                </label>
                <label className="settings-language-field">
                  <span>{localize(language, 'Format tanggal', 'Date format')}</span>
                  <select
                    value={settings.appearance.dateFormat}
                    onChange={(e) => updateSettings({ ...settings, appearance: { ...settings.appearance, dateFormat: e.target.value as DateFormatStyle } })}
                  >
                    <option value="short">{localize(language, 'Ringkas', 'Short')}</option>
                    <option value="numeric">{localize(language, 'Angka', 'Numeric')}</option>
                    <option value="full">{localize(language, 'Lengkap', 'Full')}</option>
                  </select>
                </label>
                <label className="settings-language-field">
                  <span>{localize(language, 'Kecepatan animasi', 'Animation speed')}</span>
                  <select
                    value={settings.appearance.animationSpeed}
                    onChange={(e) => updateSettings({ ...settings, appearance: { ...settings.appearance, animationSpeed: e.target.value as AnimationSpeed } })}
                  >
                    <option value="snappy">{localize(language, 'Cepat', 'Snappy')}</option>
                    <option value="normal">Normal</option>
                    <option value="smooth">{localize(language, 'Halus', 'Smooth')}</option>
                    <option value="off">{localize(language, 'Mati', 'Off')}</option>
                  </select>
                </label>
                <label className="settings-language-field">
                  <span>{localize(language, 'Jarak tepi layar', 'Edge offset')} ({settings.appearance.edgeOffset}px)</span>
                  <input
                    type="range"
                    min={0}
                    max={48}
                    value={settings.appearance.edgeOffset}
                    onChange={(e) => updateSettings({ ...settings, appearance: { ...settings.appearance, edgeOffset: Number(e.target.value) } })}
                  />
                </label>
              </div>
            </div>
          </div>
        )}

        {section === 'theme' && (
          <div className="settings-window__page">
            <h2>{localize(language, 'Tema & Ukuran', 'Theme & Size')}</h2>
            <div className="settings-window__card">
              <div className="settings-theme-grid">
                {WINDHAWK_THEMES.map(([id, label, swatch]) => (
                  <button
                    key={id}
                    type="button"
                    className={`settings-theme-chip${settings.themes.themePreset === id ? ' is-active' : ''}`}
                    onClick={() => updateSettings({ ...settings, themes: { ...settings.themes, themePreset: id } })}
                  >
                    <i className="settings-theme-chip__swatch" style={{ backgroundColor: id === 'custom' ? settings.themes.pillBgColor : swatch }} />
                    <span>{label}</span>
                  </button>
                ))}
              </div>
              {settings.themes.themePreset === 'custom' && (
                <div className="settings-window__color-row">
                  <label>BG <input type="color" value={settings.themes.pillBgColor} onChange={(e) => updateSettings({ ...settings, themes: { ...settings.themes, pillBgColor: e.target.value } })} /></label>
                  <label>Border <input type="color" value={settings.themes.contourBorderHex} onChange={(e) => updateSettings({ ...settings, themes: { ...settings.themes, contourBorderHex: e.target.value } })} /></label>
                  <label>Text <input type="color" value={settings.themes.textPrimaryColor} onChange={(e) => updateSettings({ ...settings, themes: { ...settings.themes, textPrimaryColor: e.target.value } })} /></label>
                </div>
              )}
            </div>
            <div className="settings-window__grid">
              <div className="settings-window__card">
                <label className="settings-language-field">
                  <span>{localize(language, 'Opasitas', 'Opacity')} ({settings.themes.pillOpacity}%)</span>
                  <input type="range" min={35} max={100} value={settings.themes.pillOpacity} onChange={(e) => updateSettings({ ...settings, themes: { ...settings.themes, pillOpacity: Number(e.target.value) } })} />
                </label>
                <label className="settings-language-field">
                  <span>{localize(language, 'Skala teks', 'Text scale')} ({settings.themes.textScale}%)</span>
                  <input type="range" min={80} max={130} step={5} value={settings.themes.textScale} onChange={(e) => updateSettings({ ...settings, themes: { ...settings.themes, textScale: Number(e.target.value) } })} />
                </label>
                <label className="settings-language-field">
                  <span>{localize(language, 'Lebar panel Tools', 'Tools width')} ({settings.appearance.panelWidth}px)</span>
                  <input type="range" min={260} max={560} step={8} value={settings.appearance.panelWidth} onChange={(e) => updateSettings({ ...settings, appearance: { ...settings.appearance, panelWidth: Number(e.target.value) } })} />
                </label>
                <label className="settings-language-field">
                  <span>{localize(language, 'Tinggi panel Tools', 'Tools height')} ({settings.appearance.panelHeight}px)</span>
                  <input type="range" min={220} max={520} step={8} value={settings.appearance.panelHeight} onChange={(e) => updateSettings({ ...settings, appearance: { ...settings.appearance, panelHeight: Number(e.target.value) } })} />
                </label>
              </div>
              <div className="settings-window__card">
                <label className="settings-inline-row">
                  <span>{localize(language, 'Gradien latar', 'Background gradient')}</span>
                  <input type="checkbox" role="switch" checked={settings.themes.bgGradientEnabled} onChange={(e) => updateSettings({ ...settings, themes: { ...settings.themes, bgGradientEnabled: e.target.checked } })} />
                </label>
                <label className="settings-inline-row">
                  <span>{localize(language, 'Border glow', 'Border glow')}</span>
                  <input type="checkbox" role="switch" checked={settings.themes.borderGlowEnabled} onChange={(e) => updateSettings({ ...settings, themes: { ...settings.themes, borderGlowEnabled: e.target.checked } })} />
                </label>
                <label className="settings-inline-row">
                  <span>{localize(language, 'Aura reaktif musik', 'Music-reactive aura')}</span>
                  <input type="checkbox" role="switch" checked={settings.themes.musicReactiveGlow} onChange={(e) => updateSettings({ ...settings, themes: { ...settings.themes, musicReactiveGlow: e.target.checked } })} />
                </label>
                <label className="settings-language-field">
                  <span>{localize(language, 'Warna teks global', 'Global text color')}</span>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <input type="color" value={settings.themes.textColorOverride || '#ffffff'} onChange={(e) => updateSettings({ ...settings, themes: { ...settings.themes, textColorOverride: e.target.value } })} />
                    {settings.themes.textColorOverride && (
                      <button type="button" className="tool-text-button" onClick={() => updateSettings({ ...settings, themes: { ...settings.themes, textColorOverride: '' } })}>
                        <RotateCcw size={12} /> Reset
                      </button>
                    )}
                  </div>
                </label>
              </div>
            </div>
          </div>
        )}

        {section === 'layout' && (
          <div className="settings-window__page">
            <h2>{localize(language, 'Layout Builder', 'Layout Builder')}</h2>
            <div className="settings-window__card">
              <LayoutEditor language={language} layout={layout} onChange={updateLayout} />
            </div>
          </div>
        )}

        {section === 'profiles' && (
          <div className="settings-window__page">
            <h2>{localize(language, 'Profil & Backup JSON', 'Profiles & JSON Backup')}</h2>
            <div className="settings-window__card">
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  className="settings-window__input"
                  value={newProfileName}
                  placeholder={localize(language, 'Nama profil baru…', 'New profile name…')}
                  onChange={(e) => setNewProfileName(e.target.value)}
                />
                <button
                  type="button"
                  className="tool-primary"
                  disabled={!newProfileName.trim()}
                  onClick={() => {
                    const next: SavedIslandProfile = {
                      id: `p-${Date.now()}`,
                      name: newProfileName.trim(),
                      settings,
                      layout
                    };
                    const updated = [next, ...savedProfiles].slice(0, 12);
                    setSavedProfiles(updated);
                    saveProfiles(updated);
                    setNewProfileName('');
                    flashStatus(localize(language, 'Profil tersimpan', 'Profile saved'));
                  }}
                >
                  <Plus size={13} /> {localize(language, 'Simpan', 'Save')}
                </button>
              </div>
              <div className="settings-window__list">
                {savedProfiles.map((p) => (
                  <div key={p.id} className="settings-window__list-row">
                    <span>{p.name}</span>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button type="button" className="tool-text-button" onClick={() => { updateSettings(p.settings); updateLayout(p.layout); flashStatus(`Profil "${p.name}" aktif`); }}>
                        {localize(language, 'Terapkan', 'Apply')}
                      </button>
                      <button type="button" className="history-action-btn" onClick={() => { const updated = savedProfiles.filter((x) => x.id !== p.id); setSavedProfiles(updated); saveProfiles(updated); }}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <button
                  type="button"
                  className="tool-text-button"
                  onClick={() => {
                    void invoke('write_clipboard_text', { text: serializeConfigBundle(settings, layout) });
                    flashStatus(localize(language, 'JSON disalin ke clipboard', 'JSON copied to clipboard'));
                  }}
                >
                  Export JSON (Copy)
                </button>
              </div>
              <textarea
                className="notes-textarea"
                style={{ minHeight: 90, marginTop: 8 }}
                value={importJson}
                placeholder={localize(language, 'Tempel JSON konfigurasi untuk impor…', 'Paste config JSON to import…')}
                onChange={(e) => setImportJson(e.target.value)}
              />
              <button
                type="button"
                className="tool-primary"
                disabled={!importJson.trim()}
                onClick={() => {
                  const bundle = parseConfigBundle(importJson);
                  if (!bundle) {
                    flashStatus(localize(language, 'Format JSON tidak valid', 'Invalid JSON format'));
                    return;
                  }
                  updateSettings(bundle.settings);
                  updateLayout(bundle.layout);
                  setImportJson('');
                  flashStatus(localize(language, 'Konfigurasi berhasil diimpor', 'Config imported'));
                }}
              >
                Import JSON
              </button>
            </div>
          </div>
        )}

        {section === 'pet' && (
          <div className="settings-window__page">
            <h2>{localize(language, 'Karakter Pet', 'Island Pet')}</h2>
            <div className="settings-window__card">
              <label className="settings-language-field">
                <span>{localize(language, 'Karakter', 'Character')}</span>
                <select
                  value={settings.appearance.petStyle}
                  onChange={(e) => updateSettings({ ...settings, appearance: { ...settings.appearance, petStyle: e.target.value as WindhawkSettings['appearance']['petStyle'] } })}
                >
                  <option value="luffy">Luffy (Default)</option>
                  <option value="custom">{localize(language, 'Gambar Kustom (PNG/GIF)', 'Custom Image (PNG/GIF)')}</option>
                  <option value="none">{localize(language, 'Sembunyikan', 'Hidden')}</option>
                </select>
              </label>
              {settings.appearance.petStyle === 'custom' && (
                <label className="tool-text-button" style={{ cursor: 'pointer', display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                  <Upload size={13} /> {localize(language, 'Unggah PNG / GIF', 'Upload PNG / GIF')}
                  <input
                    type="file"
                    accept="image/png,image/gif,image/webp"
                    hidden
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const reader = new FileReader();
                      reader.onload = () => {
                        if (typeof reader.result === 'string') {
                          updateSettings({ ...settings, appearance: { ...settings.appearance, customPetImage: reader.result } });
                        }
                      };
                      reader.readAsDataURL(file);
                    }}
                  />
                </label>
              )}
              <label className="settings-language-field">
                <span>{localize(language, 'Waktu tidur PC idle', 'PC idle sleep timer')} ({settings.appearance.petIdleMinutes} {localize(language, 'mnt', 'min')})</span>
                <input
                  type="range"
                  min={1}
                  max={60}
                  value={settings.appearance.petIdleMinutes}
                  onChange={(e) => updateSettings({ ...settings, appearance: { ...settings.appearance, petIdleMinutes: Number(e.target.value) } })}
                />
              </label>
            </div>
          </div>
        )}

        {section === 'activity' && (
          <div className="settings-window__page">
            <h2>{localize(language, 'Aktivitas Windows & Notifikasi', 'Windows Activity & Notifications')}</h2>
            <div className="settings-window__grid">
              <div className="settings-window__card">
                {ACTIVITY_LABELS.map((item) => (
                  <label key={item.id} className="settings-inline-row">
                    <span>{language === 'id' ? item.idLabel : item.enLabel}</span>
                    <input
                      type="checkbox"
                      role="switch"
                      checked={activityModules[item.id]}
                      onChange={(e) => {
                        const next = { ...activityModules, [item.id]: e.target.checked };
                        setActivityModules(next);
                        saveAppSetting('di-activity-modules', next);
                      }}
                    />
                  </label>
                ))}
              </div>
              <div className="settings-window__card">
                <label className="settings-inline-row">
                  <span><Bell size={13} style={{ display: 'inline', marginRight: 6 }} />{localize(language, 'Notifikasi Windows', 'Windows Notifications')}</span>
                  <input
                    type="checkbox"
                    role="switch"
                    checked={notifEnabled}
                    onChange={(e) => {
                      setNotifEnabled(e.target.checked);
                      saveAppSetting('di-windows-notification-notices', e.target.checked);
                    }}
                  />
                </label>
                <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                  <input
                    className="settings-window__input"
                    value={newNotifApp}
                    placeholder={localize(language, 'Nama aplikasi (mis. WhatsApp)…', 'App name (e.g. WhatsApp)…')}
                    onChange={(e) => setNewNotifApp(e.target.value)}
                  />
                  <button
                    type="button"
                    className="tool-primary"
                    disabled={!newNotifApp.trim()}
                    onClick={() => {
                      const name = newNotifApp.trim();
                      const next = { ...notifFilters, [name]: true };
                      setNotifFilters(next);
                      saveAppSetting('di-notification-app-filters', next);
                      setNewNotifApp('');
                    }}
                  >
                    <Plus size={13} />
                  </button>
                </div>
                <div className="settings-window__list">
                  {Object.entries(notifFilters).map(([appName, allowed]) => (
                    <label key={appName} className="settings-inline-row">
                      <span>{appName}</span>
                      <input
                        type="checkbox"
                        role="switch"
                        checked={allowed}
                        onChange={(e) => {
                          const next = { ...notifFilters, [appName]: e.target.checked };
                          setNotifFilters(next);
                          saveAppSetting('di-notification-app-filters', next);
                        }}
                      />
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {section === 'clickup' && (
          <div className="settings-window__page">
            <h2>ClickUp</h2>
            <form className="settings-window__card" onSubmit={(e) => { void handleSaveClickUp(e); }}>
              <label className="settings-language-field">
                <span>API Key {clickUpConfig?.api_key_configured ? '(tersimpan)' : ''}</span>
                <input
                  type="password"
                  className="settings-window__input"
                  value={clickUpApiKey}
                  placeholder="pk_..."
                  onChange={(e) => setClickUpApiKey(e.target.value)}
                />
              </label>
              <label className="settings-language-field">
                <span>List IDs (pisahkan dengan koma)</span>
                <input
                  type="text"
                  className="settings-window__input"
                  value={clickUpListIds}
                  placeholder="123456, 789012"
                  onChange={(e) => setClickUpListIds(e.target.value)}
                />
              </label>
              <button type="submit" className="tool-primary">{localize(language, 'Simpan ClickUp', 'Save ClickUp')}</button>
              {clickUpStatus && <p className="tool-status">{clickUpStatus}</p>}
            </form>
          </div>
        )}
      </main>
    </div>
  );
}

