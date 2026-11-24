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

  const navItems: { id: SettingsSection; label: string; color: string; icon: React.ReactNode }[] = [
    { id: 'general', label: localize(language, 'Umum', 'General'), color: '#8e8e93', icon: <Settings size={14} /> },
    { id: 'theme', label: localize(language, 'Tampilan & Tema', 'Display & Theme'), color: '#0a84ff', icon: <Palette size={14} /> },
    { id: 'layout', label: localize(language, 'Tata Letak', 'Layout Builder'), color: '#bf5af2', icon: <LayoutTemplate size={14} /> },
    { id: 'profiles', label: localize(language, 'Profil & Backup', 'Profiles'), color: '#30d158', icon: <Save size={14} /> },
    { id: 'pet', label: localize(language, 'Karakter Pet', 'Island Pet'), color: '#ff9f0a', icon: <Smile size={14} /> },
    { id: 'activity', label: localize(language, 'Notifikasi & Aktivitas', 'Notifications'), color: '#ff453a', icon: <Activity size={14} /> },
    { id: 'clickup', label: 'ClickUp', color: '#5e5ce6', icon: <KeyRound size={14} /> }
  ];

  return (
    <div className="ios-settings">
      <aside className="ios-settings__sidebar">
        <div className="ios-settings__sidebar-title">
          <h1>{localize(language, 'Pengaturan', 'Settings')}</h1>
          <small>Dynamic Island</small>
        </div>
        <nav className="ios-settings__nav">
          {navItems.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`ios-settings__nav-item${section === item.id ? ' is-active' : ''}`}
              onClick={() => setSection(item.id)}
            >
              <span className="ios-squircle" style={{ backgroundColor: item.color }} aria-hidden="true">
                {item.icon}
              </span>
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="ios-settings__sync">
          <CheckCircle2 size={13} />
          <span>{statusBanner || localize(language, 'Sinkron langsung', 'Live synced')}</span>
        </div>
      </aside>

      <main className="ios-settings__content">
        {section === 'general' && (
          <div className="ios-page">
            <h2 className="ios-page__title">{localize(language, 'Umum', 'General')}</h2>

            <section className="ios-group">
              <h3 className="ios-group__label">{localize(language, 'TAMPILAN & POSISI', 'DISPLAY & POSITION')}</h3>
              <div className="ios-card">
                <label className="ios-row">
                  <span className="ios-row__label">{localize(language, 'Bahasa', 'Language')}</span>
                  <select className="ios-select" value={language} onChange={(e) => updateLanguage(e.target.value as AppLanguage)}>
                    <option value="id">Indonesia</option>
                    <option value="en">English</option>
                  </select>
                </label>
                <label className="ios-row">
                  <span className="ios-row__label">{localize(language, 'Posisi Island', 'Island Position')}</span>
                  <select className="ios-select" value={islandPosition} onChange={(e) => updatePosition(Number(e.target.value) as IslandPosition)}>
                    <option value={0}>{localize(language, 'Atas Tengah', 'Top Center')}</option>
                    <option value={1}>{localize(language, 'Kiri Tengah', 'Left Center')}</option>
                    <option value={2}>{localize(language, 'Kanan Tengah', 'Right Center')}</option>
                  </select>
                </label>
                <label className="ios-row">
                  <span className="ios-row__label">Monitor</span>
                  <select
                    className="ios-select"
                    value={settings.appearance.monitorIndex}
                    onChange={(e) => updateSettings({ ...settings, appearance: { ...settings.appearance, monitorIndex: Number(e.target.value) } })}
                  >
                    <option value={-1}>{localize(language, 'Utama (otomatis)', 'Primary (auto)')}</option>
                    {monitors.map((m) => (
                      <option key={m.index} value={m.index}>
                        {m.name} ({m.width}×{m.height}){m.isPrimary ? ' ★' : ''}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="ios-row">
                  <span className="ios-row__label">{localize(language, 'Gaya & Bentuk', 'Shape & Style')}</span>
                  <select
                    className="ios-select"
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
                <label className="ios-row">
                  <span className="ios-row__label">{localize(language, 'Mode Idle', 'Idle Mode')}</span>
                  <select
                    className="ios-select"
                    value={settings.appearance.idleStyle}
                    onChange={(e) => updateSettings({ ...settings, appearance: { ...settings.appearance, idleStyle: e.target.value as IdleDisplayStyle } })}
                  >
                    <option value="standard">{localize(language, 'Standar', 'Standard')}</option>
                    <option value="stealth">{localize(language, 'Stealth (Hover)', 'Stealth (Hover)')}</option>
                    <option value="prayer">{localize(language, 'Countdown Salat', 'Prayer Countdown')}</option>
                    <option value="dual">Dual-Pill Split</option>
                    <option value="hud">HUD Developer</option>
                    <option value="vinyl">Vinyl Spin</option>
                    <option value="ticker">Smart Ticker</option>
                  </select>
                </label>
                <label className="ios-row">
                  <span className="ios-row__label">{localize(language, 'Jarak Tepi Layar', 'Edge Offset')}</span>
                  <div className="ios-slider-wrap">
                    <input
                      className="ios-slider"
                      type="range"
                      min={0}
                      max={48}
                      value={settings.appearance.edgeOffset}
                      onChange={(e) => updateSettings({ ...settings, appearance: { ...settings.appearance, edgeOffset: Number(e.target.value) } })}
                    />
                    <span className="ios-value">{settings.appearance.edgeOffset}px</span>
                  </div>
                </label>
              </div>
            </section>

            <section className="ios-group">
              <h3 className="ios-group__label">{localize(language, 'INTERAKSI & STARTUP', 'INTERACTION & STARTUP')}</h3>
              <div className="ios-card">
                <label className="ios-row">
                  <span className="ios-row__label">{localize(language, 'Tembus Klik', 'Click-Through')}</span>
                  <select
                    className="ios-select"
                    value={settings.appearance.clickThroughMode}
                    onChange={(e) => updateSettings({ ...settings, appearance: { ...settings.appearance, clickThroughMode: e.target.value as ClickThroughMode } })}
                  >
                    <option value="off">{localize(language, 'Mati (Normal)', 'Off (Normal)')}</option>
                    <option value="hold-alt-pass">{localize(language, 'Tahan Alt → Tembus', 'Hold Alt → Pass')}</option>
                    <option value="hold-alt-interact">{localize(language, 'Idle Tembus (Alt Klik)', 'Idle Pass (Alt Click)')}</option>
                    <option value="always">{localize(language, 'Selalu Tembus', 'Always Pass')}</option>
                  </select>
                </label>
                <label className="ios-row">
                  <span className="ios-row__label">{localize(language, 'Scroll Volume & Kecerahan', 'Scroll Volume & Brightness')}</span>
                  <input
                    className="ios-switch"
                    type="checkbox"
                    role="switch"
                    checked={settings.appearance.scrollControlEnabled}
                    onChange={(e) => updateSettings({ ...settings, appearance: { ...settings.appearance, scrollControlEnabled: e.target.checked } })}
                  />
                </label>
                <label className="ios-row">
                  <span className="ios-row__label">{localize(language, 'Sembunyi saat Fullscreen', 'Auto-Hide Fullscreen')}</span>
                  <input
                    className="ios-switch"
                    type="checkbox"
                    role="switch"
                    checked={settings.appearance.autoHideFullscreen}
                    onChange={(e) => updateSettings({ ...settings, appearance: { ...settings.appearance, autoHideFullscreen: e.target.checked } })}
                  />
                </label>
                <label className="ios-row">
                  <span className="ios-row__copy">
                    <span className="ios-row__label">{localize(language, 'Auto-Startup Windows', 'Windows Auto-Startup')}</span>
                    {startupConfig.isDebugBuild && <small className="ios-row__sub">{localize(language, 'Hanya aktif pada build rilis', 'Release builds only')}</small>}
                  </span>
                  <input
                    className="ios-switch"
                    type="checkbox"
                    role="switch"
                    disabled={startupBusy || (startupConfig.isDebugBuild && !startupConfig.enabled)}
                    checked={startupConfig.enabled}
                    onChange={(e) => { void updateStartup({ enabled: e.target.checked, startHidden: startupConfig.startHidden, delaySeconds: startupConfig.delaySeconds }); }}
                  />
                </label>
                {startupConfig.enabled && (
                  <>
                    <label className="ios-row">
                      <span className="ios-row__label">{localize(language, 'Mulai Tersembunyi di Tray', 'Start Hidden in Tray')}</span>
                      <input
                        className="ios-switch"
                        type="checkbox"
                        role="switch"
                        checked={startupConfig.startHidden}
                        onChange={(e) => { void updateStartup({ enabled: true, startHidden: e.target.checked, delaySeconds: startupConfig.delaySeconds }); }}
                      />
                    </label>
                    <label className="ios-row">
                      <span className="ios-row__label">{localize(language, 'Delay Startup', 'Startup Delay')}</span>
                      <select
                        className="ios-select"
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
              </div>
              <p className="ios-group__footnote">
                {localize(language, 'Pintasan global: Ctrl+Alt+G (Tembus klik) · Ctrl+Alt+Space (Sembunyikan/Tampilkan).', 'Global shortcuts: Ctrl+Alt+G (Click-through) · Ctrl+Alt+Space (Hide/Show).')}
                {startupStatus ? ` ${startupStatus}` : ''}
              </p>
            </section>

            <section className="ios-group">
              <h3 className="ios-group__label">{localize(language, 'JAM & ANIMASI', 'CLOCK & ANIMATION')}</h3>
              <div className="ios-card">
                <label className="ios-row">
                  <span className="ios-row__label">{localize(language, 'Format Jam', 'Clock Format')}</span>
                  <select
                    className="ios-select"
                    value={settings.appearance.clockFormat}
                    onChange={(e) => updateSettings({ ...settings, appearance: { ...settings.appearance, clockFormat: e.target.value as ClockFormat } })}
                  >
                    <option value="24h">24h</option>
                    <option value="12h">12h (AM/PM)</option>
                  </select>
                </label>
                <label className="ios-row">
                  <span className="ios-row__label">{localize(language, 'Tampilkan Detik', 'Show Seconds')}</span>
                  <input
                    className="ios-switch"
                    type="checkbox"
                    role="switch"
                    checked={settings.appearance.showSeconds}
                    onChange={(e) => updateSettings({ ...settings, appearance: { ...settings.appearance, showSeconds: e.target.checked } })}
                  />
                </label>
                <label className="ios-row">
                  <span className="ios-row__label">{localize(language, 'Format Tanggal', 'Date Format')}</span>
                  <select
                    className="ios-select"
                    value={settings.appearance.dateFormat}
                    onChange={(e) => updateSettings({ ...settings, appearance: { ...settings.appearance, dateFormat: e.target.value as DateFormatStyle } })}
                  >
                    <option value="short">{localize(language, 'Ringkas', 'Short')}</option>
                    <option value="numeric">{localize(language, 'Angka', 'Numeric')}</option>
                    <option value="full">{localize(language, 'Lengkap', 'Full')}</option>
                  </select>
                </label>
                <label className="ios-row">
                  <span className="ios-row__label">{localize(language, 'Kecepatan Animasi', 'Animation Speed')}</span>
                  <select
                    className="ios-select"
                    value={settings.appearance.animationSpeed}
                    onChange={(e) => updateSettings({ ...settings, appearance: { ...settings.appearance, animationSpeed: e.target.value as AnimationSpeed } })}
                  >
                    <option value="snappy">{localize(language, 'Cepat', 'Snappy')}</option>
                    <option value="normal">Normal</option>
                    <option value="smooth">{localize(language, 'Halus', 'Smooth')}</option>
                    <option value="off">{localize(language, 'Mati', 'Off')}</option>
                  </select>
                </label>
              </div>
            </section>
          </div>
        )}

        {section === 'theme' && (
          <div className="ios-page">
            <h2 className="ios-page__title">{localize(language, 'Tampilan & Tema', 'Display & Theme')}</h2>

            <section className="ios-group">
              <h3 className="ios-group__label">{localize(language, 'PRESET WARNA', 'COLOR PRESETS')}</h3>
              <div className="ios-card ios-card--padded">
                <div className="ios-theme-grid">
                  {WINDHAWK_THEMES.map(([id, label, swatch]) => (
                    <button
                      key={id}
                      type="button"
                      className={`ios-theme-chip${settings.themes.themePreset === id ? ' is-active' : ''}`}
                      onClick={() => updateSettings({ ...settings, themes: { ...settings.themes, themePreset: id } })}
                    >
                      <i className="ios-theme-chip__dot" style={{ backgroundColor: id === 'custom' ? settings.themes.pillBgColor : swatch }} />
                      <span>{label}</span>
                    </button>
                  ))}
                </div>
                {settings.themes.themePreset === 'custom' && (
                  <div className="ios-color-pickers">
                    <label>BG <input type="color" value={settings.themes.pillBgColor} onChange={(e) => updateSettings({ ...settings, themes: { ...settings.themes, pillBgColor: e.target.value } })} /></label>
                    <label>Border <input type="color" value={settings.themes.contourBorderHex} onChange={(e) => updateSettings({ ...settings, themes: { ...settings.themes, contourBorderHex: e.target.value } })} /></label>
                    <label>Text <input type="color" value={settings.themes.textPrimaryColor} onChange={(e) => updateSettings({ ...settings, themes: { ...settings.themes, textPrimaryColor: e.target.value } })} /></label>
                  </div>
                )}
              </div>
            </section>

            <section className="ios-group">
              <h3 className="ios-group__label">{localize(language, 'UKURAN & OPASITAS', 'SIZE & OPACITY')}</h3>
              <div className="ios-card">
                <label className="ios-row">
                  <span className="ios-row__label">{localize(language, 'Opasitas', 'Opacity')}</span>
                  <div className="ios-slider-wrap">
                    <input className="ios-slider" type="range" min={35} max={100} value={settings.themes.pillOpacity} onChange={(e) => updateSettings({ ...settings, themes: { ...settings.themes, pillOpacity: Number(e.target.value) } })} />
                    <span className="ios-value">{settings.themes.pillOpacity}%</span>
                  </div>
                </label>
                <label className="ios-row">
                  <span className="ios-row__label">{localize(language, 'Skala Teks', 'Text Scale')}</span>
                  <div className="ios-slider-wrap">
                    <input className="ios-slider" type="range" min={80} max={130} step={5} value={settings.themes.textScale} onChange={(e) => updateSettings({ ...settings, themes: { ...settings.themes, textScale: Number(e.target.value) } })} />
                    <span className="ios-value">{settings.themes.textScale}%</span>
                  </div>
                </label>
                <label className="ios-row">
                  <span className="ios-row__label">{localize(language, 'Lebar Panel Tools', 'Tools Width')}</span>
                  <div className="ios-slider-wrap">
                    <input className="ios-slider" type="range" min={260} max={560} step={8} value={settings.appearance.panelWidth} onChange={(e) => updateSettings({ ...settings, appearance: { ...settings.appearance, panelWidth: Number(e.target.value) } })} />
                    <span className="ios-value">{settings.appearance.panelWidth}px</span>
                  </div>
                </label>
                <label className="ios-row">
                  <span className="ios-row__label">{localize(language, 'Tinggi Panel Tools', 'Tools Height')}</span>
                  <div className="ios-slider-wrap">
                    <input className="ios-slider" type="range" min={220} max={520} step={8} value={settings.appearance.panelHeight} onChange={(e) => updateSettings({ ...settings, appearance: { ...settings.appearance, panelHeight: Number(e.target.value) } })} />
                    <span className="ios-value">{settings.appearance.panelHeight}px</span>
                  </div>
                </label>
              </div>
            </section>

            <section className="ios-group">
              <h3 className="ios-group__label">{localize(language, 'EFEK VISUAL', 'VISUAL EFFECTS')}</h3>
              <div className="ios-card">
                <label className="ios-row">
                  <span className="ios-row__label">{localize(language, 'Gradien Latar', 'Background Gradient')}</span>
                  <input className="ios-switch" type="checkbox" role="switch" checked={settings.themes.bgGradientEnabled} onChange={(e) => updateSettings({ ...settings, themes: { ...settings.themes, bgGradientEnabled: e.target.checked } })} />
                </label>
                <label className="ios-row">
                  <span className="ios-row__label">Border Glow</span>
                  <input className="ios-switch" type="checkbox" role="switch" checked={settings.themes.borderGlowEnabled} onChange={(e) => updateSettings({ ...settings, themes: { ...settings.themes, borderGlowEnabled: e.target.checked } })} />
                </label>
                <label className="ios-row">
                  <span className="ios-row__label">{localize(language, 'Aura Reaktif Musik', 'Music-Reactive Aura')}</span>
                  <input className="ios-switch" type="checkbox" role="switch" checked={settings.themes.musicReactiveGlow} onChange={(e) => updateSettings({ ...settings, themes: { ...settings.themes, musicReactiveGlow: e.target.checked } })} />
                </label>
                <label className="ios-row">
                  <span className="ios-row__label">{localize(language, 'Warna Teks Global', 'Global Text Color')}</span>
                  <div className="ios-inline-end">
                    <input type="color" value={settings.themes.textColorOverride || '#ffffff'} onChange={(e) => updateSettings({ ...settings, themes: { ...settings.themes, textColorOverride: e.target.value } })} />
                    {settings.themes.textColorOverride && (
                      <button type="button" className="ios-link-btn" onClick={() => updateSettings({ ...settings, themes: { ...settings.themes, textColorOverride: '' } })}>
                        <RotateCcw size={12} /> Reset
                      </button>
                    )}
                  </div>
                </label>
              </div>
            </section>
          </div>
        )}

        {section === 'layout' && (
          <div className="ios-page">
            <h2 className="ios-page__title">{localize(language, 'Tata Letak', 'Layout Builder')}</h2>
            <div className="ios-card ios-card--padded">
              <LayoutEditor language={language} layout={layout} onChange={updateLayout} />
            </div>
          </div>
        )}

        {section === 'profiles' && (
          <div className="ios-page">
            <h2 className="ios-page__title">{localize(language, 'Profil & Backup', 'Profiles & Backup')}</h2>
            <section className="ios-group">
              <h3 className="ios-group__label">{localize(language, 'PROFIL TERSIMPAN', 'SAVED PROFILES')}</h3>
              <div className="ios-card">
                <div className="ios-row">
                  <input
                    className="ios-input"
                    value={newProfileName}
                    placeholder={localize(language, 'Nama profil baru…', 'New profile name…')}
                    onChange={(e) => setNewProfileName(e.target.value)}
                  />
                  <button
                    type="button"
                    className="ios-pill-btn"
                    disabled={!newProfileName.trim()}
                    onClick={() => {
                      const next: SavedIslandProfile = { id: `p-${Date.now()}`, name: newProfileName.trim(), settings, layout };
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
                {savedProfiles.map((p) => (
                  <div key={p.id} className="ios-row">
                    <span className="ios-row__label">{p.name}</span>
                    <div className="ios-inline-end">
                      <button type="button" className="ios-link-btn" onClick={() => { updateSettings(p.settings); updateLayout(p.layout); flashStatus(`Profil "${p.name}" aktif`); }}>
                        {localize(language, 'Terapkan', 'Apply')}
                      </button>
                      <button type="button" className="ios-icon-danger" onClick={() => { const updated = savedProfiles.filter((x) => x.id !== p.id); setSavedProfiles(updated); saveProfiles(updated); }}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="ios-group">
              <h3 className="ios-group__label">JSON EXPORT / IMPORT</h3>
              <div className="ios-card ios-card--padded">
                <button
                  type="button"
                  className="ios-link-btn"
                  onClick={() => {
                    void invoke('write_clipboard_text', { text: serializeConfigBundle(settings, layout) });
                    flashStatus(localize(language, 'JSON disalin ke clipboard', 'JSON copied to clipboard'));
                  }}
                >
                  {localize(language, 'Salin Konfigurasi JSON', 'Copy Config JSON')}
                </button>
                <textarea
                  className="ios-textarea"
                  value={importJson}
                  placeholder={localize(language, 'Tempel JSON konfigurasi di sini…', 'Paste config JSON here…')}
                  onChange={(e) => setImportJson(e.target.value)}
                />
                <button
                  type="button"
                  className="ios-pill-btn"
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
                    flashStatus(localize(language, 'Konfigurasi diimpor', 'Config imported'));
                  }}
                >
                  Import JSON
                </button>
              </div>
            </section>
          </div>
        )}

        {section === 'pet' && (
          <div className="ios-page">
            <h2 className="ios-page__title">{localize(language, 'Karakter Pet', 'Island Pet')}</h2>
            <section className="ios-group">
              <h3 className="ios-group__label">{localize(language, 'KARAKTER & TIDUR', 'CHARACTER & SLEEP')}</h3>
              <div className="ios-card">
                <label className="ios-row">
                  <span className="ios-row__label">{localize(language, 'Karakter', 'Character')}</span>
                  <select
                    className="ios-select"
                    value={settings.appearance.petStyle}
                    onChange={(e) => updateSettings({ ...settings, appearance: { ...settings.appearance, petStyle: e.target.value as WindhawkSettings['appearance']['petStyle'] } })}
                  >
                    <option value="luffy">Luffy (Default)</option>
                    <option value="custom">{localize(language, 'Gambar Kustom', 'Custom Image')}</option>
                    <option value="none">{localize(language, 'Sembunyikan', 'Hidden')}</option>
                  </select>
                </label>
                {settings.appearance.petStyle === 'custom' && (
                  <label className="ios-row" style={{ cursor: 'pointer' }}>
                    <span className="ios-row__label">{localize(language, 'Unggah PNG / GIF', 'Upload PNG / GIF')}</span>
                    <span className="ios-link-btn"><Upload size={13} /> {localize(language, 'Pilih File', 'Choose File')}</span>
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
                <label className="ios-row">
                  <span className="ios-row__label">{localize(language, 'Tidur saat PC Idle', 'Sleep on PC Idle')}</span>
                  <div className="ios-slider-wrap">
                    <input className="ios-slider" type="range" min={1} max={60} value={settings.appearance.petIdleMinutes} onChange={(e) => updateSettings({ ...settings, appearance: { ...settings.appearance, petIdleMinutes: Number(e.target.value) } })} />
                    <span className="ios-value">{settings.appearance.petIdleMinutes}m</span>
                  </div>
                </label>
              </div>
            </section>
          </div>
        )}

        {section === 'activity' && (
          <div className="ios-page">
            <h2 className="ios-page__title">{localize(language, 'Notifikasi & Aktivitas', 'Notifications & Activity')}</h2>

            <section className="ios-group">
              <h3 className="ios-group__label">{localize(language, 'NOTIFIKASI WINDOWS', 'WINDOWS NOTIFICATIONS')}</h3>
              <div className="ios-card">
                <label className="ios-row">
                  <span className="ios-row__label"><Bell size={14} style={{ display: 'inline', marginRight: 6, verticalAlign: -2 }} />{localize(language, 'Tampilkan Notifikasi', 'Show Notifications')}</span>
                  <input
                    className="ios-switch"
                    type="checkbox"
                    role="switch"
                    checked={notifEnabled}
                    onChange={(e) => {
                      setNotifEnabled(e.target.checked);
                      saveAppSetting('di-windows-notification-notices', e.target.checked);
                    }}
                  />
                </label>
                <div className="ios-row">
                  <input
                    className="ios-input"
                    value={newNotifApp}
                    placeholder={localize(language, 'Filter aplikasi (mis. WhatsApp)…', 'Filter app (e.g. WhatsApp)…')}
                    onChange={(e) => setNewNotifApp(e.target.value)}
                  />
                  <button
                    type="button"
                    className="ios-pill-btn"
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
                {Object.entries(notifFilters).map(([appName, allowed]) => (
                  <label key={appName} className="ios-row">
                    <span className="ios-row__label">{appName}</span>
                    <input
                      className="ios-switch"
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
            </section>

            <section className="ios-group">
              <h3 className="ios-group__label">{localize(language, 'AKTIVITAS SISTEM', 'SYSTEM ACTIVITY')}</h3>
              <div className="ios-card">
                {ACTIVITY_LABELS.map((item) => (
                  <label key={item.id} className="ios-row">
                    <span className="ios-row__label">{language === 'id' ? item.idLabel : item.enLabel}</span>
                    <input
                      className="ios-switch"
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
            </section>
          </div>
        )}

        {section === 'clickup' && (
          <div className="ios-page">
            <h2 className="ios-page__title">ClickUp</h2>
            <form className="ios-group" onSubmit={(e) => { void handleSaveClickUp(e); }}>
              <h3 className="ios-group__label">{localize(language, 'KREDENSIAL API', 'API CREDENTIALS')}</h3>
              <div className="ios-card">
                <label className="ios-row">
                  <span className="ios-row__label">API Key {clickUpConfig?.api_key_configured ? '✓' : ''}</span>
                  <input
                    type="password"
                    className="ios-input ios-input--right"
                    value={clickUpApiKey}
                    placeholder="pk_..."
                    onChange={(e) => setClickUpApiKey(e.target.value)}
                  />
                </label>
                <label className="ios-row">
                  <span className="ios-row__label">List IDs</span>
                  <input
                    type="text"
                    className="ios-input ios-input--right"
                    value={clickUpListIds}
                    placeholder="123456, 789012"
                    onChange={(e) => setClickUpListIds(e.target.value)}
                  />
                </label>
                <div className="ios-row">
                  <span className="ios-row__sub">{clickUpStatus || localize(language, 'Pisahkan beberapa List ID dengan koma', 'Separate multiple List IDs with commas')}</span>
                  <button type="submit" className="ios-pill-btn">{localize(language, 'Simpan', 'Save')}</button>
                </div>
              </div>
            </form>
          </div>
        )}
      </main>
    </div>
  );
}
