import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { openPath } from '@tauri-apps/plugin-opener';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { AnimatePresence, m } from 'framer-motion';
import {
  Activity, AlarmClock, ArrowLeft, ArrowRight, Bell, CalendarDays, Camera, ChevronLeft, ChevronRight, Clipboard, Copy, File, KeyRound, LayoutTemplate, ListTodo,
  LocateFixed, Palette, Pause, Play, Plus, RotateCcw, Save, ScanText, Scissors, Settings, Smile, Sparkles, Trash2, Upload, X
} from 'lucide-react';
import AiChatTab from './AiChatTab';
import LayoutEditor from './LayoutEditor';
import { localize, type AppLanguage } from '../lib/i18n';
import { readAppSetting, saveAppSetting } from '../lib/storage';
import type { AnimationSpeed, ClockFormat, DateFormatStyle, IslandShapeStyle, WindhawkSettings } from '../lib/appearanceSettings';
import type { IslandLayoutSettings, ToolTabId } from '../lib/layoutSettings';
import { parseConfigBundle, readSavedProfiles, saveProfiles, serializeConfigBundle, type SavedIslandProfile } from '../lib/profiles';

export interface ClipboardItem {
  text: string;
  timestamp: number;
}

export interface FocusLiveState {
  running: boolean;
  remainingSeconds: number;
  totalSeconds: number;
  isBreak: boolean;
}

interface ClickUpTask {
  id: string;
  name: string;
  status?: { status: string } | null;
  due_date?: string | null;
}

interface MonitorOption {
  index: number;
  name: string;
  width: number;
  height: number;
  isPrimary: boolean;
}

interface ClickUpConfig {
  api_key_configured: boolean;
  list_ids: string[];
  settings_path: string;
}

interface ClickUpTaskDateRange {
  dueDateGt: number;
}

interface PrayerLocation {
  latitude: number;
  longitude: number;
}

type PrayerTime = [string, string];

interface AladhanResponse {
  code: number;
  data?: {
    timings?: Record<string, string>;
  };
}

type ActivityModule =
  | 'capsLock'
  | 'numLock'
  | 'scrollLock'
  | 'microphone'
  | 'speaker'
  | 'volume'
  | 'clipboard'
  | 'brightness'
  | 'wifi'
  | 'power'
  | 'battery';

type IslandPosition = 0 | 1 | 2; // 0 = top center, 1 = left center, 2 = right center

type ActivityModuleSettings = Record<ActivityModule, boolean>;

const ACTIVITY_MODULES: { id: ActivityModule; label: string }[] = [
  { id: 'capsLock', label: 'Caps Lock' },
  { id: 'numLock', label: 'Num Lock' },
  { id: 'scrollLock', label: 'Scroll Lock' },
  { id: 'microphone', label: 'Mikrofon' },
  { id: 'speaker', label: 'Speaker' },
  { id: 'volume', label: 'Volume' },
  { id: 'clipboard', label: 'Copy, cut, paste, dan clipboard' },
  { id: 'brightness', label: 'Tombol kecerahan' },
  { id: 'wifi', label: 'Wi-Fi' },
  { id: 'power', label: 'Charger' },
  { id: 'battery', label: 'Baterai rendah dan penuh' }
];

const WINDHAWK_THEMES = [
  'obsidian', 'graphite', 'slate', 'nord', 'evergreen', 'espresso', 'plum', 'porcelain', 'custom'
] as const;

const ISLAND_SCALES = ['0.8', '1.0', '1.2', '1.5', '1.8', '2.0', '2.5'] as const;

interface ToolsPanelProps {
  language: AppLanguage;
  onLanguageChange: (language: AppLanguage) => void;
  clipboardItems: ClipboardItem[];
  shelfPaths: string[];
  activityModuleSettings: ActivityModuleSettings;
  windowsNotificationNotices: boolean;
  notificationAppFilters: Record<string, boolean>;
  onActivityModuleSettingsChange: (settings: ActivityModuleSettings) => void;
  onWindowsNotificationNoticesChange: (enabled: boolean) => void;
  onNotificationAppFiltersChange: (filters: Record<string, boolean>) => void;
  onClose: () => void;
  onReturnToMenu: () => void;
  onClearClipboard: () => void;
  onRemoveShelfItem: (path: string) => void;
  onCopyClipboard: (text: string) => void;
  onNotice: (title: string, body: string) => void;
  onCapture: () => void;
  onScreenshot: () => void;
  islandPosition: IslandPosition;
  onIslandPositionChange: (position: IslandPosition) => void;
  windhawkSettings: WindhawkSettings;
  onWindhawkSettingsChange: (settings: WindhawkSettings) => void;
  layoutSettings: IslandLayoutSettings;
  onLayoutSettingsChange: (layout: IslandLayoutSettings) => void;
  openSettingsRequest: number;
  openTabRequest: { tab: ToolTabId; seq: number } | null;
  onFocusStateChange?: (state: FocusLiveState) => void;
}

type ToolTab = 'focus' | 'tasks' | 'ai' | 'clipboard' | 'shelf' | 'prayer' | 'capture' | 'settings';

const TABS: { id: ToolTab; label: string }[] = [
  { id: 'focus', label: 'Focus' },
  { id: 'tasks', label: 'To-do' },
  { id: 'ai', label: 'AI' },
  { id: 'clipboard', label: 'Clipboard' },
  { id: 'shelf', label: 'Shelf' },
  { id: 'prayer', label: 'Prayer' },
  { id: 'capture', label: 'Capture' },
  { id: 'settings', label: 'Settings' }
];

function getActivityModuleLabel(id: ActivityModule, _label: string, language: AppLanguage) {
  const englishLabels: Record<ActivityModule, string> = {
    capsLock: 'Caps Lock',
    numLock: 'Num Lock',
    scrollLock: 'Scroll Lock',
    microphone: 'Microphone',
    speaker: 'Speaker',
    volume: 'Volume',
    clipboard: 'Clipboard',
    brightness: 'Brightness',
    wifi: 'Wi-Fi',
    power: 'Charger',
    battery: 'Battery'
  };
  const indonesianLabels: Record<ActivityModule, string> = {
    capsLock: 'Caps Lock',
    numLock: 'Num Lock',
    scrollLock: 'Scroll Lock',
    microphone: 'Mikrofon',
    speaker: 'Speaker',
    volume: 'Volume',
    clipboard: 'Clipboard',
    brightness: 'Kecerahan',
    wifi: 'Wi-Fi',
    power: 'Charger',
    battery: 'Baterai'
  };
  return language === 'id' ? indonesianLabels[id] : englishLabels[id];
}

function localizeMessage(language: AppLanguage, message: string) {
  if (language === 'id' || !message) return message;
  const translations: Record<string, string> = {
    'Atur API key ClickUp di settings.json': 'Set the ClickUp API key in settings.json',
    'Atur List ID ClickUp di settings.json': 'Set the ClickUp List IDs in settings.json',
    'Menyimpan konfigurasi…': 'Saving configuration…',
    'Pengaturan tersimpan. Perubahan ClickUp langsung digunakan.': 'Settings saved. ClickUp changes are applied immediately.',
    'Lokasi tidak didukung perangkat': 'Location is not supported on this device',
    'Lokasi belum diambil': 'Location has not been acquired',
    'Mencari lokasi…': 'Finding your location…',
    'Lokasi saat ini': 'Current location',
    'Izin lokasi ditolak': 'Location permission denied',
    'Lokasi tidak merespons': 'Location request timed out',
    'Lokasi tidak tersedia': 'Location unavailable',
    'Memuat jadwal…': 'Loading schedule…',
    'Jadwal salat tidak tersedia': 'Prayer schedule is unavailable',
    'Gagal memuat jadwal salat': 'Failed to load prayer schedule',
    'Pilih List ID yang tersedia dan periksa konfigurasi ClickUp di settings.json': 'Select an available List ID and check the ClickUp configuration in settings.json',
    'Memuat task dari ClickUp…': 'Loading tasks from ClickUp…',
    'Konfigurasi ClickUp tidak tersedia. Periksa API key dan List ID di settings.json': 'ClickUp configuration is unavailable. Check the API key and List IDs in settings.json',
    'Isi nama task terlebih dahulu': 'Enter a task name first',
    'Pilih tanggal yang valid dan pastikan tanggal akhir tidak sebelum tanggal awal': 'Choose valid dates and make sure the end date is not before the start date',
    'Rentang tanggal maksimal 366 hari': 'The maximum date range is 366 days',
    'Tidak ada task yang dibuat karena tanggal yang dipilih hanya mencakup akhir pekan': 'No tasks were created because the selected dates only include weekends'
  };
  if (translations[message]) return translations[message];
  const loaded = message.match(/^(\d+) task dimuat$/);
  if (loaded) return `${loaded[1]} ${loaded[1] === '1' ? 'task' : 'tasks'} loaded`;
  const creating = message.match(/^Membuat (\d+) task hari kerja dan time entry di ClickUp…$/);
  if (creating) return `Creating ${creating[1]} weekday tasks and time entries in ClickUp…`;
  const prayerFailure = message.match(/^Gagal memuat jadwal: (.+)$/);
  if (prayerFailure) return `Failed to load schedule: ${prayerFailure[1]}`;
  const prayerTimeUnavailable = message.match(/^Waktu (.+) tidak tersedia$/);
  if (prayerTimeUnavailable) return `${prayerTimeUnavailable[1]} time is unavailable`;
  return message;
}

function readStored<T>(key: string, fallback: T): T {
  return readAppSetting(key, fallback);
}

function formatTime(seconds: number) {
  return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
}

function formatApiDate(date: Date) {
  return `${date.getDate().toString().padStart(2, '0')}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getFullYear()}`;
}

function formatDateInput(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function dateInputToUtcTimestamp(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [, year, month, day] = match;
  const timestamp = Date.UTC(Number(year), Number(month) - 1, Number(day));
  const date = new Date(timestamp);
  if (date.getUTCFullYear() !== Number(year) || date.getUTCMonth() !== Number(month) - 1 || date.getUTCDate() !== Number(day)) {
    return null;
  }
  return timestamp;
}

function formatWeekdayDate(date: Date) {
  const weekday = date.getDay();
  if (weekday === 6) date.setDate(date.getDate() + 2);
  if (weekday === 0) date.setDate(date.getDate() + 1);
  return formatDateInput(date);
}

function parseLocalDate(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

interface WeekdayDatePickerProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
}

function WeekdayDatePicker({ label, value, onChange, language }: WeekdayDatePickerProps & { language: AppLanguage }) {
  const [open, setOpen] = useState(false);
  const selectedDate = value ? parseLocalDate(value) : new Date();
  const [visibleMonth, setVisibleMonth] = useState(() => new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1));
  const firstDay = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), 1).getDay();
  const daysInMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 0).getDate();
  const cells = Array.from({ length: firstDay + daysInMonth }, (_, index) => {
    if (index < firstDay) return null;
    return index - firstDay + 1;
  });

  return (
    <div className="weekday-date-picker">
      <span className="weekday-date-label">{label}</span>
      <button
        type="button"
        className="weekday-date-trigger"
        aria-expanded={open}
        onClick={() => {
          if (!open && value) setVisibleMonth(new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1));
          setOpen((current) => !current);
        }}
      >
        <CalendarDays size={13} />
        <span>{selectedDate.toLocaleDateString(language === 'id' ? 'id-ID' : 'en-US', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
      </button>
      {open && (
        <div className="weekday-calendar" role="dialog" aria-label={localize(language, `Pilih ${label.toLowerCase()}`, `Choose ${label.toLowerCase()}`)}>
          <div className="weekday-calendar-header">
            <button type="button" aria-label={localize(language, 'Bulan sebelumnya', 'Previous month')} onClick={() => setVisibleMonth(new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() - 1, 1))}><ChevronLeft size={14} /></button>
            <strong>{visibleMonth.toLocaleDateString(language === 'id' ? 'id-ID' : 'en-US', { month: 'long', year: 'numeric' })}</strong>
            <button type="button" aria-label={localize(language, 'Bulan berikutnya', 'Next month')} onClick={() => setVisibleMonth(new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 1))}><ChevronRight size={14} /></button>
          </div>
          <div className="weekday-calendar-grid">
            {(language === 'id' ? ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'] : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']).map((day) => <span className="weekday-calendar-day-name" key={day}>{day}</span>)}
            {cells.map((day, index) => {
              if (!day) return <span className="weekday-calendar-empty" key={`empty-${index}`} />;
              const date = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), day);
              const weekend = date.getDay() === 0 || date.getDay() === 6;
              const dateValue = formatDateInput(date);
              const isSelected = dateValue === value;
              return (
                <button
                  type="button"
                  key={dateValue}
                  disabled={weekend}
                  aria-pressed={isSelected}
                  className={isSelected ? 'weekday-calendar-date is-selected' : 'weekday-calendar-date'}
                  onClick={() => {
                    onChange(dateValue);
                    setOpen(false);
                  }}
                >
                  {day}
                </button>
              );
            })}
          </div>
          <p>{localize(language, 'Sabtu dan Minggu tidak tersedia', 'Saturdays and Sundays are unavailable')}</p>
        </div>
      )}
    </div>
  );
}

export default function ToolsPanel({
  language, onLanguageChange, clipboardItems, shelfPaths, activityModuleSettings, windowsNotificationNotices,
  notificationAppFilters, onActivityModuleSettingsChange, onWindowsNotificationNoticesChange,
  onNotificationAppFiltersChange, onClose, onReturnToMenu, onClearClipboard,
  onRemoveShelfItem, onCopyClipboard, onNotice, onCapture, onScreenshot,
  islandPosition, onIslandPositionChange, windhawkSettings, onWindhawkSettingsChange,
  layoutSettings, onLayoutSettingsChange, openSettingsRequest, openTabRequest, onFocusStateChange
}: ToolsPanelProps) {
  const [tab, setTab] = useState<ToolTab>('focus');
  const [capturePaths, setCapturePaths] = useState<string[]>([]);
  const [ocrRunning, setOcrRunning] = useState(false);
  const [ocrText, setOcrText] = useState<string | null>(null);
  const [newNotifApp, setNewNotifApp] = useState('');
  const [savedProfiles, setSavedProfiles] = useState<SavedIslandProfile[]>(readSavedProfiles);
  const [newProfileName, setNewProfileName] = useState('');
  const [importJsonText, setImportJsonText] = useState('');
  const [showImportJson, setShowImportJson] = useState(false);
  const [monitors, setMonitors] = useState<MonitorOption[]>([]);

  useEffect(() => {
    if (tab !== 'settings') return;
    void invoke<MonitorOption[]>('list_monitors')
      .then((list) => setMonitors(list))
      .catch(() => {});
  }, [tab]);

  const resolvedNavLayout = layoutSettings.toolsNavLayout === 'auto'
    ? (islandPosition === 0 ? 'top' : islandPosition === 1 ? 'left' : 'right')
    : layoutSettings.toolsNavLayout;
  const isVerticalLayout = resolvedNavLayout === 'left' || resolvedNavLayout === 'right';
  const [expandedSettings, setExpandedSettings] = useState({
    general: false,
    theme: false,
    layout: false,
    profiles: false,
    pet: false,
    activity: false,
    notifications: false,
    clickUp: false
  });
  useEffect(() => {
    if (openSettingsRequest === 0) return;
    setTab('settings');
    setExpandedSettings((current) => ({ ...current, general: true }));
  }, [openSettingsRequest]);
  const [remaining, setRemaining] = useState(() => readStored('di-focus-remaining', 25 * 60));
  const [focusMinutes, setFocusMinutes] = useState(() => readStored('di-focus-minutes', 25));
  const [breakMinutes, setBreakMinutes] = useState(() => readStored('di-break-minutes', 5));
  const [running, setRunning] = useState(false);
  const [isBreak, setIsBreak] = useState(false);
  const [sessions, setSessions] = useState(() => readStored('di-focus-sessions', 0));
  const [clickUpConfig, setClickUpConfig] = useState<ClickUpConfig | null>(null);
  const [clickUpApiKeyDraft, setClickUpApiKeyDraft] = useState('');
  const [clickUpListIdsDraft, setClickUpListIdsDraft] = useState('');
  const [clickUpSettingsBusy, setClickUpSettingsBusy] = useState(false);
  const [clickUpSettingsStatus, setClickUpSettingsStatus] = useState('');
  const [clickUpListId, setClickUpListId] = useState('');
  const [clickUpTasks, setClickUpTasks] = useState<ClickUpTask[]>([]);
  const [clickUpTaskDateRange, setClickUpTaskDateRange] = useState<ClickUpTaskDateRange | null>(null);
  const [clickUpTaskInput, setClickUpTaskInput] = useState('');
  const [showClickUpCreate, setShowClickUpCreate] = useState(false);
  const [clickUpDateMode, setClickUpDateMode] = useState<'single' | 'range'>('single');
  const [clickUpDueDate, setClickUpDueDate] = useState(() => formatWeekdayDate(new Date()));
  const [clickUpRangeStart, setClickUpRangeStart] = useState(() => formatWeekdayDate(new Date()));
  const [clickUpRangeEnd, setClickUpRangeEnd] = useState(() => formatWeekdayDate(new Date()));
  const [clickUpPage, setClickUpPage] = useState(0);
  const [clickUpHasMore, setClickUpHasMore] = useState(false);
  const [clickUpBusy, setClickUpBusy] = useState(false);
  const [clickUpStatus, setClickUpStatus] = useState('');
  const [prayerReminders, setPrayerReminders] = useState(() => readStored('di-prayer-reminders', false));
  const [now, setNow] = useState(Date.now());
  const [location, setLocation] = useState<PrayerLocation | null>(null);
  const [locationStatus, setLocationStatus] = useState('Lokasi belum diambil');
  const [prayerTimes, setPrayerTimes] = useState<PrayerTime[]>([]);
  const [prayerStatus, setPrayerStatus] = useState('');
  const [prayerRefresh, setPrayerRefresh] = useState(0);

  const remainingRef = useRef(remaining);
  remainingRef.current = remaining;

  useEffect(() => {
    onFocusStateChange?.({
      running,
      remainingSeconds: remaining,
      totalSeconds: Math.max(1, (isBreak ? breakMinutes : focusMinutes) * 60),
      isBreak
    });
  }, [running, remaining, focusMinutes, breakMinutes, isBreak, onFocusStateChange]);

  useEffect(() => {
    if (tab !== 'prayer' && !prayerReminders) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, [tab, prayerReminders]);
  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;
    void listen<string>('capture-saved', ({ payload }) => {
      setCapturePaths((paths) => [payload, ...paths.filter((path) => path !== payload)]);
    }).then((stopListening) => {
      if (active) unlisten = stopListening;
      else stopListening();
    }).catch((error: unknown) => {
      console.error('Gagal memasang listener tangkapan layar:', error);
    });
    void invoke<string[]>('list_capture_files')
      .then((paths) => {
        if (active) {
          setCapturePaths((current) => [...new Set([...current, ...paths])]);
        }
      })
      .catch((error: unknown) => {
        if (active) console.error('Gagal memuat daftar tangkapan layar:', error);
      });
    return () => {
      active = false;
      unlisten?.();
    };
  }, []);
  const removeCapture = async (path: string) => {
    if (!window.confirm(localize(language, 'Hapus file tangkapan layar ini?', 'Delete this capture file?'))) return;
    try {
      await invoke('delete_capture_file', { path });
      setCapturePaths((paths) => paths.filter((item) => item !== path));
    } catch (error) {
      console.error('Gagal menghapus tangkapan layar:', error);
      onNotice(
        localize(language, 'Gagal menghapus tangkapan layar', 'Failed to delete capture'),
        error instanceof Error ? error.message : String(error)
      );
    }
  };
  const openCapture = async (path: string) => {
    try {
      await openPath(path);
    } catch (error) {
      console.error('Gagal membuka tangkapan layar:', error);
      onNotice(
        localize(language, 'Gagal membuka tangkapan layar', 'Failed to open capture'),
        error instanceof Error ? error.message : String(error)
      );
    }
  };
  useEffect(() => {
    if (!running) return;
    const timer = window.setTimeout(() => {
      if (remaining > 1) {
        setRemaining(remaining - 1);
        return;
      }
      setRunning(false);
      setIsBreak(!isBreak);
      setRemaining((isBreak ? focusMinutes : breakMinutes) * 60);
      if (!isBreak) setSessions((count) => count + 1);
      onNotice(
        isBreak
          ? localize(language, 'Waktu istirahat selesai', 'Break complete')
          : localize(language, 'Sesi fokus selesai', 'Focus session complete'),
        isBreak
          ? localize(language, 'Waktunya kembali fokus.', 'Time to get back to focus.')
          : localize(language, 'Waktunya beristirahat sejenak.', 'Time to take a short break.')
      );
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [running, remaining, isBreak, focusMinutes, breakMinutes, onNotice, language]);

  useEffect(() => {
    if (!running) saveAppSetting('di-focus-remaining', remaining);
  }, [running, remaining]);
  useEffect(() => () => {
    saveAppSetting('di-focus-remaining', remainingRef.current);
  }, []);
  useEffect(() => saveAppSetting('di-focus-minutes', focusMinutes), [focusMinutes]);
  useEffect(() => saveAppSetting('di-break-minutes', breakMinutes), [breakMinutes]);
  useEffect(() => saveAppSetting('di-focus-sessions', sessions), [sessions]);
  useEffect(() => saveAppSetting('di-prayer-reminders', prayerReminders), [prayerReminders]);
  useEffect(() => {
    let active = true;
    void invoke<ClickUpConfig>('get_clickup_config')
      .then((config) => {
        if (!active) return;
        setClickUpConfig(config);
        setClickUpListIdsDraft(config.list_ids.join(', '));
        const stored = readStored<unknown>('di-clickup-list-id', '');
        const savedListId = typeof stored === 'string' || typeof stored === 'number' ? String(stored) : '';
        const listId = config.list_ids.includes(savedListId) ? savedListId : (config.list_ids[0] ?? '');
        setClickUpListId(listId);
        if (!config.api_key_configured) setClickUpStatus('Atur API key ClickUp di settings.json');
        else if (!config.list_ids.length) setClickUpStatus('Atur List ID ClickUp di settings.json');
      })
      .catch((error: unknown) => {
        if (!active) return;
        setClickUpStatus(error instanceof Error ? error.message : String(error));
      });
    return () => { active = false; };
  }, []);

  const saveClickUpSettings = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setClickUpSettingsBusy(true);
    setClickUpSettingsStatus('Menyimpan konfigurasi…');
    try {
      const config = await invoke<ClickUpConfig>('save_clickup_config', {
        apiKey: clickUpApiKeyDraft,
        listIds: clickUpListIdsDraft
      });
      setClickUpConfig(config);
      setClickUpApiKeyDraft('');
      setClickUpListIdsDraft(config.list_ids.join(', '));
      setClickUpStatus('');
      setClickUpSettingsStatus('Pengaturan tersimpan. Perubahan ClickUp langsung digunakan.');
      if (!config.list_ids.includes(clickUpListId)) {
        const nextListId = config.list_ids[0] ?? '';
        setClickUpListId(nextListId);
        saveAppSetting('di-clickup-list-id', nextListId);
        setClickUpTasks([]);
      }
    } catch (error) {
      setClickUpSettingsStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setClickUpSettingsBusy(false);
    }
  };

  const requestLocation = () => {
    if (!navigator.geolocation) {
      setLocationStatus('Lokasi tidak didukung perangkat');
      setLocation(null);
      return;
    }

    setLocation(null);
    setPrayerTimes([]);
    setPrayerStatus('');
    setLocationStatus('Mencari lokasi…');
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setLocation({ latitude: coords.latitude, longitude: coords.longitude });
        setLocationStatus('Lokasi saat ini');
      },
      (error) => {
        setLocation(null);
        setLocationStatus(error.code === error.PERMISSION_DENIED
          ? 'Izin lokasi ditolak'
          : error.code === error.TIMEOUT
            ? 'Lokasi tidak merespons'
            : 'Lokasi tidak tersedia');
      },
      { enableHighAccuracy: false, maximumAge: 300_000, timeout: 12_000 }
    );
  };

  useEffect(() => {
    if (tab === 'prayer') requestLocation();
  }, [tab]);

  const prayerDate = formatApiDate(new Date(now));
  useEffect(() => {
    if (!location) return;

    const controller = new AbortController();
    const loadPrayerTimes = async () => {
      setPrayerStatus('Memuat jadwal…');
      const params = new URLSearchParams({
        latitude: location.latitude.toString(),
        longitude: location.longitude.toString(),
        method: '20'
      });

      try {
        const response = await fetch(`https://api.aladhan.com/v1/timings/${prayerDate}?${params}`, {
          signal: controller.signal
        });
        if (!response.ok) throw new Error(`API merespons ${response.status}`);
        const result = await response.json() as AladhanResponse;
        if (result.code !== 200 || !result.data?.timings) throw new Error('Jadwal salat tidak tersedia');

        const entries: [string, string][] = [
          ['Subuh', result.data.timings.Fajr],
          ['Dzuhur', result.data.timings.Dhuhr],
          ['Ashar', result.data.timings.Asr],
          ['Maghrib', result.data.timings.Maghrib],
          ['Isya', result.data.timings.Isha]
        ].map(([name, value]) => {
          const time = value?.match(/^(\d{1,2}:\d{2})/)?.[1];
          if (!time) throw new Error(`Waktu ${name} tidak tersedia`);
          return [name, time];
        });

        setPrayerTimes(entries);
        setPrayerStatus('');
      } catch (error) {
        if (controller.signal.aborted) return;
        setPrayerStatus(error instanceof Error ? `Gagal memuat jadwal: ${error.message}` : 'Gagal memuat jadwal salat');
      }
    };

    void loadPrayerTimes();
    return () => controller.abort();
  }, [location, prayerDate, prayerRefresh]);

  const currentTime = new Date(now).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const nextPrayer = prayerTimes.find(([, value]) => value > currentTime) ?? prayerTimes[0];
  useEffect(() => {
    if (!prayerReminders || !prayerTimes.length) return;
    const date = new Date(now);
    const prayer = prayerTimes.find(([, value]) => value === currentTime);
    if (!prayer) return;
    const dateKey = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
    const key = `${dateKey}:${prayer[0]}`;
    if (readAppSetting('di-last-prayer-notice', '') === key) return;
    saveAppSetting('di-last-prayer-notice', key);
    onNotice(`Waktu ${prayer[0]}`, 'Waktunya menunaikan salat.');
  }, [now, currentTime, prayerTimes, prayerReminders, onNotice]);
  const loadClickUpTasks = async (
    append = false,
    requestedListId = clickUpListId,
    requestedDateRange = clickUpTaskDateRange,
    showResult = true
  ) => {
    const listId = String(requestedListId ?? '').trim();
    if (!clickUpConfig?.api_key_configured || !clickUpConfig.list_ids.includes(listId)) {
      setClickUpStatus('Pilih List ID yang tersedia dan periksa konfigurasi ClickUp di settings.json');
      return;
    }

    const page = append ? clickUpPage + 1 : 0;
    setClickUpBusy(true);
    setClickUpStatus('Memuat task dari ClickUp…');
    try {
      const tasks = await invoke<ClickUpTask[]>('get_clickup_tasks', {
        listId,
        page,
        dueDateGt: requestedDateRange?.dueDateGt ?? null
      });
      setClickUpTasks((current) => append ? [...current, ...tasks] : tasks);
      setClickUpPage(page);
      setClickUpHasMore(tasks.length === 100);
      setClickUpStatus(showResult ? `${append ? clickUpTasks.length + tasks.length : tasks.length} task dimuat` : '');
    } catch (error) {
      setClickUpStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setClickUpBusy(false);
    }
  };

  const createClickUpTask = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = clickUpTaskInput.trim();
    const listId = String(clickUpListId ?? '').trim();
    if (!clickUpConfig?.api_key_configured || !clickUpConfig.list_ids.includes(listId)) {
      setClickUpStatus('Konfigurasi ClickUp tidak tersedia. Periksa API key dan List ID di settings.json');
      return;
    }
    if (!name) {
      setClickUpStatus('Isi nama task terlebih dahulu');
      return;
    }

    const startDate = dateInputToUtcTimestamp(clickUpDateMode === 'single' ? clickUpDueDate : clickUpRangeStart);
    const endDate = dateInputToUtcTimestamp(clickUpDateMode === 'single' ? clickUpDueDate : clickUpRangeEnd);
    if (startDate === null || endDate === null || endDate < startDate) {
      setClickUpStatus('Pilih tanggal yang valid dan pastikan tanggal akhir tidak sebelum tanggal awal');
      return;
    }

    const calendarDays = Math.floor((endDate - startDate) / 86_400_000) + 1;
    if (calendarDays > 366) {
      setClickUpStatus('Rentang tanggal maksimal 366 hari');
      return;
    }

    const dueDates: number[] = [];
    for (let date = startDate; date <= endDate; date += 86_400_000) {
      const dayOfWeek = new Date(date).getUTCDay();
      if (dayOfWeek === 0 || dayOfWeek === 6) {
        continue;
      } else {
        dueDates.push(date);
      }
    }
    if (dueDates.length === 0) {
      setClickUpStatus('Tidak ada task yang dibuat karena tanggal yang dipilih hanya mencakup akhir pekan');
      return;
    }
    const firstDate = new Date(dueDates[0]);
    const taskDateRange = {
      dueDateGt: Date.UTC(firstDate.getUTCFullYear(), firstDate.getUTCMonth(), 1) - 1
    };
    setClickUpBusy(true);
    setClickUpStatus(`Membuat ${dueDates.length} task hari kerja dan time entry di ClickUp…`);
    try {
      await invoke<ClickUpTask[]>('create_clickup_tasks', {
        listId,
        name,
        dueDates
      });
      setClickUpTaskInput('');
      setClickUpTaskDateRange(taskDateRange);
      setShowClickUpCreate(false);
      await loadClickUpTasks(false, listId, taskDateRange, false);
    } catch (error) {
      setClickUpStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setClickUpBusy(false);
    }
  };

  const resetFocus = () => {
    setRunning(false);
    setRemaining((isBreak ? breakMinutes : focusMinutes) * 60);
  };

  const runOcr = async (imagePath?: string) => {
    if (ocrRunning) return;
    setOcrRunning(true);
    try {
      const extracted = await invoke<string>('run_screenshot_ocr', {
        imagePath: imagePath ?? null
      });
      if (extracted) {
        setOcrText(extracted);
        onNotice(
          'OCR',
          localize(language, 'Teks berhasil diekstrak & disalin ke clipboard', 'Text extracted & copied to clipboard')
        );
      } else {
        setOcrText('');
        onNotice(
          'OCR',
          localize(language, 'Tidak ada teks terdeteksi pada layar', 'No text detected on screen')
        );
      }
    } catch (error) {
      onNotice('OCR', error instanceof Error ? error.message : String(error));
    } finally {
      setOcrRunning(false);
    }
  };

  useEffect(() => {
    if (openTabRequest) {
      setTab(openTabRequest.tab);
    }
  }, [openTabRequest]);

  const visibleTabs = layoutSettings.toolsTabs
    .filter((entry) => entry.visible || entry.id === 'settings')
    .map((entry) => TABS.find((t) => t.id === entry.id))
    .filter((item): item is { id: ToolTab; label: string } => Boolean(item));

  useEffect(() => {
    if (!visibleTabs.some((item) => item.id === tab)) {
      setTab(visibleTabs[0]?.id ?? 'settings');
    }
  }, [visibleTabs, tab]);

  const tabsIcon: Record<ToolTab, ReactNode> = {
    focus: <AlarmClock size={15} />, tasks: <ListTodo size={15} />, ai: <Sparkles size={15} />, clipboard: <Clipboard size={15} />,
    shelf: <File size={15} />, prayer: <span>☾</span>, capture: <Camera size={15} />, settings: <Settings size={15} />
  };

  return (
    <section
      className={`tools-panel${isVerticalLayout ? ' tools-panel--side' : ''}${resolvedNavLayout === 'right' ? ' tools-panel--nav-right' : ''}${layoutSettings.toolsTabLabels ? ' tools-panel--with-labels' : ''}`}
      aria-label={localize(language, 'Alat Dynamic Island', 'Dynamic Island tools')}
    >
      <header className="tools-header">
        <button className="tools-back" aria-label={localize(language, 'Kembali ke menu', 'Back to menu')} onClick={onReturnToMenu}><ArrowLeft size={15} /></button>
        <button className="tools-close" aria-label={localize(language, 'Tutup menu', 'Close menu')} onClick={onClose}><X size={15} /></button>
      </header>
      <nav className="tools-tabs" aria-label={localize(language, 'Alat', 'Tools')}>
        {visibleTabs.map((item) => (
          <button
            key={item.id}
            aria-label={item.id === 'settings' ? localize(language, 'Pengaturan', 'Settings') : item.id === 'focus' ? localize(language, 'Fokus', 'Focus') : item.id === 'tasks' ? 'To-do' : item.id === 'ai' ? 'AI Chat' : item.id === 'clipboard' ? 'Clipboard' : item.id === 'shelf' ? 'Shelf' : item.id === 'prayer' ? localize(language, 'Salat', 'Prayer') : localize(language, 'Tangkapan layar', 'Capture')}
            aria-current={tab === item.id ? 'page' : undefined}
            className={tab === item.id ? 'tools-tab is-active' : 'tools-tab'}
            onClick={() => setTab(item.id)}
          >
            <span className="tools-tab__icon">{tabsIcon[item.id]}</span>
            {layoutSettings.toolsTabLabels && !isVerticalLayout && (
              <span className="tools-tab__label">{item.label}</span>
            )}
          </button>
        ))}
      </nav>
      <div className="tools-content">
        <AnimatePresence mode="wait" initial={false}>
          <m.div
            key={tab}
            className="tools-tab-panel"
            initial={{ opacity: 0, y: 5, filter: 'blur(2px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            exit={{ opacity: 0, y: -3, filter: 'blur(1px)' }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
          >
        {tab === 'focus' && (
          <div className="tool-card focus-card">
            <span className="focus-status">{isBreak ? localize(language, 'Istirahat', 'Break') : localize(language, 'Fokus', 'Focus')}{sessions > 0 ? ` · ${sessions} ${localize(language, 'selesai', 'completed')}` : ''}</span>
            <strong className="focus-countdown">{formatTime(remaining)}</strong>
            <div className="focus-actions">
              <button className="tool-primary" onClick={() => setRunning((value) => !value)}>{running ? <Pause size={15} /> : <Play size={15} />}{running ? localize(language, 'Jeda', 'Pause') : localize(language, 'Mulai', 'Start')}</button>
              <button className="tool-icon-button" aria-label={localize(language, 'Atur ulang timer', 'Reset timer')} onClick={resetFocus}><RotateCcw size={15} /></button>
            </div>
            <div className="focus-settings">
              <label>{localize(language, 'Fokus', 'Focus')} <input type="number" min="1" max="180" value={focusMinutes} disabled={running} onChange={(event) => {
                const value = Math.max(1, Math.min(180, Number(event.target.value) || 1));
                setFocusMinutes(value);
                if (!isBreak) setRemaining(value * 60);
              }} /> min</label>
              <label>{localize(language, 'Istirahat', 'Break')} <input type="number" min="1" max="60" value={breakMinutes} disabled={running} onChange={(event) => {
                const value = Math.max(1, Math.min(60, Number(event.target.value) || 1));
                setBreakMinutes(value);
                if (isBreak) setRemaining(value * 60);
              }} /> min</label>
            </div>
          </div>
        )}
        {tab === 'tasks' && (
          <div className="tool-card">
            {clickUpConfig === null ? (
              <p className="tool-empty">{clickUpStatus ? localizeMessage(language, clickUpStatus) : localize(language, 'Memeriksa konfigurasi ClickUp…', 'Checking ClickUp configuration…')}</p>
            ) : !clickUpConfig.api_key_configured || clickUpConfig.list_ids.length === 0 ? (
              <div className="clickup-settings-help">
                <strong>{localize(language, 'Konfigurasi ClickUp belum lengkap', 'ClickUp configuration is incomplete')}</strong>
                <span>{localize(language, 'Tambahkan API key dan List ID di pengaturan aplikasi.', 'Add the API key and List IDs in app settings.')}</span>
                {clickUpStatus && <p className="clickup-status" role="status">{localizeMessage(language, clickUpStatus)}</p>}
              </div>
            ) : (
              <>
                <div className="clickup-task-toolbar">
                  <label className="clickup-list-select">
                    <span>{localize(language, 'Daftar', 'List')}</span>
                    <select value={clickUpListId} onChange={(event) => {
                    const listId = event.target.value;
                    setClickUpListId(listId);
                    saveAppSetting('di-clickup-list-id', listId);
                    setClickUpTasks([]);
                    setClickUpPage(0);
                    setClickUpHasMore(false);
                    setClickUpTaskDateRange(null);
                    }}>
                    {clickUpConfig.list_ids.map((id) => <option value={id} key={id}>{localize(language, 'Daftar', 'List')} {id}</option>)}
                    </select>
                  </label>
                  <button className="tool-primary" type="button" disabled={clickUpBusy || !clickUpListId} onClick={() => { void loadClickUpTasks(false); }}>
                    {clickUpBusy ? localize(language, 'Memuat…', 'Loading…') : localize(language, 'Muat task', 'Load tasks')}
                  </button>
                  <button className="clickup-create-button" type="button" onClick={() => {
                    setClickUpStatus('');
                    setShowClickUpCreate(true);
                  }}>
                    <Plus size={14} /> {localize(language, 'Buat task', 'Create task')}
                  </button>
                </div>
                {showClickUpCreate ? (
                  <form className="clickup-create-form" onSubmit={(event) => { void createClickUpTask(event); }}>
                    <div className="clickup-create-heading">
                    <div><strong>{localize(language, 'Task baru', 'New task')}</strong><span>{localize(language, 'Task dibuat untuk hari kerja yang dipilih.', 'Tasks are created for the selected weekdays.')}</span></div>
                    <button type="button" className="tools-close" aria-label={localize(language, 'Tutup form', 'Close form')} onClick={() => setShowClickUpCreate(false)}><X size={14} /></button>
                    </div>
                    <label className="clickup-task-name">
                    <span>{localize(language, 'Nama task', 'Task name')}</span>
                    <input value={clickUpTaskInput} onChange={(event) => setClickUpTaskInput(event.target.value)} maxLength={500} placeholder={localize(language, 'Contoh: Follow up project', 'Example: Follow up project')} required />
                    </label>
                    <div className="clickup-date-mode">
                    <button type="button" className={clickUpDateMode === 'single' ? 'is-active' : ''} onClick={() => setClickUpDateMode('single')}>{localize(language, 'Satu hari', 'Single day')}</button>
                    <button type="button" className={clickUpDateMode === 'range' ? 'is-active' : ''} onClick={() => setClickUpDateMode('range')}>{localize(language, 'Rentang tanggal', 'Date range')}</button>
                    </div>
                    {clickUpDateMode === 'single' ? (
                    <WeekdayDatePicker label={localize(language, 'Tanggal task', 'Task date')} value={clickUpDueDate} onChange={setClickUpDueDate} language={language} />
                    ) : (
                    <div className="clickup-date-range">
                      <WeekdayDatePicker label={localize(language, 'Mulai', 'From')} value={clickUpRangeStart} onChange={setClickUpRangeStart} language={language} />
                      <WeekdayDatePicker label={localize(language, 'Sampai', 'To')} value={clickUpRangeEnd} onChange={setClickUpRangeEnd} language={language} />
                    </div>
                    )}
                    {clickUpStatus && <p className="clickup-status" role="status">{localizeMessage(language, clickUpStatus)}</p>}
                    <div className="clickup-create-actions">
                    <button type="button" className="tool-text-button" disabled={clickUpBusy} onClick={() => setShowClickUpCreate(false)}>{localize(language, 'Batal', 'Cancel')}</button>
                    <button className="tool-primary" type="submit" disabled={clickUpBusy}>
                      {clickUpBusy ? localize(language, 'Memproses…', 'Processing…') : localize(language, 'Buat task', 'Create task')}
                    </button>
                    </div>
                  </form>
                ) : (
                  <>
                    {clickUpStatus && <p className="clickup-status" role="status">{localizeMessage(language, clickUpStatus)}</p>}
                    <div className="clickup-task-table-wrap">
                    <table className="clickup-task-table">
                      <thead><tr><th>{localize(language, 'Nama', 'Name')}</th><th>{localize(language, 'Status', 'Status')}</th><th>{localize(language, 'Batas waktu', 'Due date')}</th></tr></thead>
                      <tbody>
                        {clickUpTasks.map((task) => (
                          <tr key={task.id}>
                            <td>{task.name}</td>
                            <td><span className="clickup-task-status">{task.status?.status ?? localize(language, 'Tanpa status', 'No status')}</span></td>
                            <td>{task.due_date ? new Date(Number(task.due_date)).toLocaleDateString(language === 'id' ? 'id-ID' : 'en-US') : '—'}</td>
                          </tr>
                        ))}
                        {!clickUpTasks.length && <tr><td className="clickup-table-empty" colSpan={3}>{localize(language, 'Pilih daftar, lalu muat task.', 'Select a list, then load tasks.')}</td></tr>}
                      </tbody>
                    </table>
                    </div>
                    {clickUpHasMore && <button className="tool-text-button" type="button" disabled={clickUpBusy} onClick={() => { void loadClickUpTasks(true); }}>{localize(language, 'Muat lebih', 'Load more')}</button>}
                  </>
                )}
              </>
            )}
          </div>
        )}
        {tab === 'clipboard' && (
          <div className="tool-card">
            <div className="tool-card-heading"><span className="tool-count">{clipboardItems.length} {localize(language, 'item', 'items')}</span><button className="tool-text-button" onClick={onClearClipboard}>{localize(language, 'Hapus semua', 'Clear all')}</button></div>
            <div className="history-list">
              {clipboardItems.length === 0 && <p className="tool-empty">{localize(language, 'Belum ada teks yang disalin.', 'No copied text yet.')}</p>}
              {clipboardItems.map((item, index) => (
                <button className="history-row" key={`${item.timestamp}-${index}`} title={localize(language, 'Klik untuk menyalin', 'Click to copy')} onClick={() => onCopyClipboard(item.text)}>
                  <span>{item.text}</span><small>{new Date(item.timestamp).toLocaleTimeString(language === 'id' ? 'id-ID' : 'en-US', { hour: '2-digit', minute: '2-digit' })}</small>
                </button>
              ))}
            </div>
          </div>
        )}
        {tab === 'shelf' && (
          <div className="tool-card">
            <div className="shelf-drop">{localize(language, 'Lepaskan file di sini untuk menyimpannya sementara.', 'Drop files here to keep them temporarily.')}</div>
            <div className="shelf-list">
              {shelfPaths.length === 0 && <p className="tool-empty">{localize(language, 'Belum ada file di shelf.', 'No files on the shelf yet.')}</p>}
              {shelfPaths.map((path) => (
                <div className="shelf-row" key={path}>
                  <button className="shelf-open" onClick={() => void openPath(path)}><File size={14} /><span>{path.split(/[\\/]/).pop() || path}</span></button>
                  <button className="task-delete" aria-label={localize(language, 'Hapus dari shelf', 'Remove from shelf')} onClick={() => onRemoveShelfItem(path)}><X size={14} /></button>
                </div>
              ))}
            </div>
          </div>
        )}
        {tab === 'prayer' && (
          <div className="tool-card">
            <div className="tool-card-heading">
              <span className="tool-count">{localizeMessage(language, locationStatus)}</span>
              {nextPrayer && <span className="prayer-next">{nextPrayer[0]} · {nextPrayer[1]}</span>}
              {(locationStatus !== 'Lokasi saat ini' || (prayerStatus && prayerStatus !== 'Memuat jadwal…')) && (
                <button
                  className="prayer-retry"
                  aria-label={localize(language, 'Coba lagi', 'Retry')}
                  title={localize(language, 'Coba lagi', 'Retry')}
                  onClick={() => {
                    if (location) setPrayerRefresh((count) => count + 1);
                    else requestLocation();
                  }}
                >
                  <LocateFixed size={14} />
                </button>
              )}
            </div>
            {prayerStatus && <p className="prayer-status" role="status">{localizeMessage(language, prayerStatus)}</p>}
            {prayerTimes.length > 0 && (
              <div className="prayer-list">{prayerTimes.map(([name, value]) => <div key={name}><span>{name}</span><strong>{value}</strong></div>)}</div>
            )}
            <label className="prayer-reminder-toggle"><input type="checkbox" checked={prayerReminders} onChange={(event) => setPrayerReminders(event.target.checked)} /> {localize(language, 'Ingatkan saat waktu salat', 'Remind me at prayer times')}</label>
          </div>
        )}
        {tab === 'ai' && (
          <AiChatTab
            language={language}
            onCopy={onCopyClipboard}
            onNotice={onNotice}
          />
        )}
        {tab === 'capture' && (
          <div className="tool-card capture-card">
            <div className="capture-actions">
              <button type="button" className="capture-action" onClick={onScreenshot}>
                <Camera size={16} />
                <span>{localize(language, 'Shot', 'Shot')}</span>
              </button>
              <button type="button" className="capture-action" onClick={onCapture}>
                <Scissors size={16} />
                <span>{localize(language, 'Snip', 'Snip')}</span>
              </button>
              <button type="button" className="capture-action" onClick={() => { void runOcr(); }} disabled={ocrRunning}>
                <ScanText size={16} />
                <span>{ocrRunning ? '…' : 'OCR'}</span>
              </button>
            </div>
            {ocrText !== null && (
              <div className="ocr-result">
                <div className="ocr-result__header">
                  <span>{localize(language, 'Hasil OCR', 'OCR Result')}</span>
                  {ocrText && (
                    <button
                      type="button"
                      className="ocr-result__copy"
                      onClick={() => onCopyClipboard(ocrText)}
                      title={localize(language, 'Salin hasil OCR', 'Copy OCR text')}
                    >
                      <Copy size={11} />
                    </button>
                  )}
                </div>
                <p>{ocrText || localize(language, 'Tidak ada teks ditemukan.', 'No text found.')}</p>
              </div>
            )}
            <div className="capture-shortcuts" aria-label={localize(language, 'Slot pintasan tangkapan', 'Capture shortcut slots')}>
              {capturePaths.map((path) => {
                const fileName = path.split(/[\\/]/).pop() || path;
                return (
                  <div className="capture-shortcut capture-shortcut--file" key={path}>
                    <button
                      type="button"
                      className="capture-shortcut-button capture-shortcut-button--file"
                      onClick={() => { void openCapture(path); }}
                      aria-label={localize(language, `Buka ${fileName}`, `Open ${fileName}`)}
                      title={fileName}
                    >
                      <File size={20} />
                    </button>
                    <button
                      type="button"
                      className="capture-file-remove"
                      onClick={() => { void removeCapture(path); }}
                      aria-label={localize(language, `Hapus ${fileName}`, `Delete ${fileName}`)}
                      title={localize(language, 'Hapus file', 'Delete file')}
                    >
                      <X size={12} />
                    </button>
                    <span className="capture-file-name">{fileName}</span>
                  </div>
                );
              })}
              {Array.from({ length: Math.max(0, 6 - capturePaths.length) }, (_, index) => (
                <div className="capture-shortcut" key={index}>
                  <button
                    type="button"
                    className="capture-shortcut-button"
                    disabled
                    aria-label={localize(language, `Slot ${index + 1} belum tersedia`, `Slot ${index + 1} unavailable`)}
                    title={localize(language, 'Pintasan tambahan segera hadir', 'Additional shortcuts coming soon')}
                  >
                    <Plus size={22} />
                  </button>
                  <span>{localize(language, 'Tambah', 'Add')}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {tab === 'settings' && (
          <div className="tool-card">
            <header className="settings-page-heading">
              <span className="settings-page-icon"><Settings size={16} /></span>
              <div>
                <h2>{localize(language, 'Pengaturan', 'Settings')}</h2>
                <p>{localize(language, 'Atur notifikasi dan koneksi aplikasi.', 'Configure notifications and app connections.')}</p>
                {clickUpConfig?.settings_path && (
                  <small className="settings-location" title={clickUpConfig.settings_path}>
                    {clickUpConfig.settings_path}
                  </small>
                )}
              </div>
            </header>

            <p className="settings-group-label">{localize(language, 'UMUM & TEMA', 'GENERAL & THEME')}</p>
            <section className="settings-section settings-section--general">
              <button
                className="settings-section-toggle"
                type="button"
                aria-expanded={expandedSettings.general}
                aria-controls="settings-general-content"
                onClick={() => setExpandedSettings((current) => ({ ...current, general: !current.general }))}
              >
                <span className="settings-section-icon"><Settings size={13} /></span>
                <span className="settings-section-title">
                  <strong>{localize(language, 'Umum', 'General')}</strong>
                  <small>{localize(language, 'Bahasa, posisi & bentuk', 'Language, position & shape')}</small>
                </span>
                <ChevronRight className="settings-section-chevron" size={14} />
              </button>
              {expandedSettings.general && (
                <div className="settings-section-content" id="settings-general-content">
                  <section className="settings-section settings-language-section">
                    <label className="settings-language-field">
                      <span>{localize(language, 'Bahasa', 'Language')}</span>
                      <select value={language} onChange={(event) => onLanguageChange(event.target.value as AppLanguage)}>
                        <option value="id">Indonesia</option>
                        <option value="en">English</option>
                      </select>
                    </label>
                  </section>

                  <section className="settings-section settings-position-section">
                    <label className="settings-section-title">
                      <strong>{localize(language, 'Posisi layar', 'Screen position')}</strong>
                    </label>
                    <div className="settings-position-options">
                      {([1, 0, 2] as const).map((value) => (
                        <button
                          key={value}
                          type="button"
                          className={`settings-position-btn ${islandPosition === value ? 'settings-position-btn-active' : ''}`}
                          onClick={() => {
                            const position: IslandPosition = value;
                            onIslandPositionChange(position);
                          }}
                          aria-pressed={islandPosition === value}
                        >
                          {value === 0 ? <LocateFixed size={13} /> : value === 1 ? <ArrowLeft size={13} /> : <ArrowRight size={13} />}
                          <span>{localize(language, value === 0 ? 'Atas' : value === 1 ? 'Kiri' : 'Kanan', value === 0 ? 'Top' : value === 1 ? 'Left' : 'Right')}</span>
                        </button>
                      ))}
                    </div>
                  </section>

                  <section className="settings-section settings-position-section">
                    <label className="settings-language-field">
                      <span>{localize(language, 'Jarak tepi', 'Edge offset')}</span>
                      <input
                        className="settings-range"
                        type="range"
                        min={0}
                        max={48}
                        step={2}
                        value={Math.min(48, Math.max(0, windhawkSettings.appearance.edgeOffset))}
                        onChange={(event) => onWindhawkSettingsChange({
                          ...windhawkSettings,
                          appearance: { ...windhawkSettings.appearance, edgeOffset: Number(event.target.value) }
                        })}
                      />
                      <small className="settings-range-value">
                        {Math.min(48, Math.max(0, windhawkSettings.appearance.edgeOffset))}px
                      </small>
                    </label>
                  </section>

                  <section className="settings-section settings-position-section">
                    <label className="settings-language-field">
                      <span>Monitor</span>
                      <select
                        value={windhawkSettings.appearance.monitorIndex}
                        onChange={(event) => onWindhawkSettingsChange({
                          ...windhawkSettings,
                          appearance: { ...windhawkSettings.appearance, monitorIndex: Number(event.target.value) }
                        })}
                      >
                        <option value={-1}>{localize(language, 'Utama (Auto)', 'Primary (Auto)')}</option>
                        {monitors.map((monitor) => (
                          <option key={monitor.index} value={monitor.index}>
                            {`${monitor.name} (${monitor.width}×${monitor.height})${monitor.isPrimary ? ' ★' : ''}`}
                          </option>
                        ))}
                      </select>
                    </label>
                  </section>

                  <section className="settings-section settings-position-section">
                    <label className="settings-inline-row">
                      <span className="settings-section-title">
                        <strong>{localize(language, 'Scroll volume & cahaya', 'Scroll volume & brightness')}</strong>
                        <small>{localize(language, 'Scroll di idle: volume · Shift+Scroll: cahaya', 'Scroll on idle: volume · Shift+Scroll: brightness')}</small>
                      </span>
                      <input
                        type="checkbox"
                        role="switch"
                        checked={windhawkSettings.appearance.scrollControlEnabled}
                        onChange={(event) => onWindhawkSettingsChange({
                          ...windhawkSettings,
                          appearance: { ...windhawkSettings.appearance, scrollControlEnabled: event.target.checked }
                        })}
                      />
                    </label>
                  </section>

                  <section className="settings-section settings-position-section">
                    <label className="settings-inline-row">
                      <span className="settings-section-title">
                        <strong>{localize(language, 'Sembunyi saat fullscreen', 'Auto-hide in fullscreen')}</strong>
                        <small>{localize(language, 'Otomatis sembunyi saat game/video penuh', 'Hide during fullscreen games & videos')}</small>
                      </span>
                      <input
                        type="checkbox"
                        role="switch"
                        checked={windhawkSettings.appearance.autoHideFullscreen}
                        onChange={(event) => onWindhawkSettingsChange({
                          ...windhawkSettings,
                          appearance: { ...windhawkSettings.appearance, autoHideFullscreen: event.target.checked }
                        })}
                      />
                    </label>
                  </section>

                  <section className="settings-section settings-position-section">
                    <label className="settings-language-field">
                      <span>{localize(language, 'Gaya & bentuk', 'Shape & style')}</span>
                      <select
                        value={windhawkSettings.appearance.shapeStyle}
                        onChange={(event) => {
                          const value = event.target.value as IslandShapeStyle;
                          const validShapes: IslandShapeStyle[] = ['default', 'w11', 'notch', 'capsule', 'sharp', 'cyber'];
                          if (!validShapes.includes(value)) return;
                          onWindhawkSettingsChange({
                            ...windhawkSettings,
                            appearance: { ...windhawkSettings.appearance, shapeStyle: value }
                          });
                        }}
                      >
                        <option value="default">Pill</option>
                        <option value="w11">Windows 11</option>
                        <option value="notch">macOS Notch</option>
                        <option value="capsule">{localize(language, 'Kapsul (bulat penuh)', 'Capsule (full pill)')}</option>
                        <option value="sharp">{localize(language, 'Minimal (tajam)', 'Minimal Sharp')}</option>
                        <option value="cyber">{localize(language, 'Cyber (sudut potong)', 'Cyber Chamfer')}</option>
                      </select>
                    </label>
                  </section>

                  <section className="settings-section settings-position-section">
                    <label className="settings-language-field">
                      <span>{localize(language, 'Format jam', 'Clock format')}</span>
                      <select
                        value={windhawkSettings.appearance.clockFormat}
                        onChange={(event) => onWindhawkSettingsChange({
                          ...windhawkSettings,
                          appearance: { ...windhawkSettings.appearance, clockFormat: event.target.value as ClockFormat }
                        })}
                      >
                        <option value="24h">24 {localize(language, 'jam', 'hour')}</option>
                        <option value="12h">12 {localize(language, 'jam (AM/PM)', 'hour (AM/PM)')}</option>
                      </select>
                    </label>
                  </section>

                  <section className="settings-section settings-position-section">
                    <label className="settings-inline-row">
                      <span className="settings-section-title">
                        <strong>{localize(language, 'Tampilkan detik', 'Show seconds')}</strong>
                      </span>
                      <input
                        type="checkbox"
                        role="switch"
                        checked={windhawkSettings.appearance.showSeconds}
                        onChange={(event) => onWindhawkSettingsChange({
                          ...windhawkSettings,
                          appearance: { ...windhawkSettings.appearance, showSeconds: event.target.checked }
                        })}
                      />
                    </label>
                  </section>

                  <section className="settings-section settings-position-section">
                    <label className="settings-language-field">
                      <span>{localize(language, 'Format tanggal', 'Date format')}</span>
                      <select
                        value={windhawkSettings.appearance.dateFormat}
                        onChange={(event) => onWindhawkSettingsChange({
                          ...windhawkSettings,
                          appearance: { ...windhawkSettings.appearance, dateFormat: event.target.value as DateFormatStyle }
                        })}
                      >
                        <option value="short">{localize(language, 'Ringkas (Sen, 23 Nov)', 'Short (Mon, 23 Nov)')}</option>
                        <option value="numeric">{localize(language, 'Angka (23/11)', 'Numeric (23/11)')}</option>
                        <option value="full">{localize(language, 'Lengkap (23 Nov 2026)', 'Full (23 Nov 2026)')}</option>
                      </select>
                    </label>
                  </section>

                  <section className="settings-section settings-position-section">
                    <label className="settings-language-field">
                      <span>{localize(language, 'Animasi', 'Animation')}</span>
                      <select
                        value={windhawkSettings.appearance.animationSpeed}
                        onChange={(event) => onWindhawkSettingsChange({
                          ...windhawkSettings,
                          appearance: { ...windhawkSettings.appearance, animationSpeed: event.target.value as AnimationSpeed }
                        })}
                      >
                        <option value="snappy">{localize(language, 'Cepat', 'Snappy')}</option>
                        <option value="normal">Normal</option>
                        <option value="smooth">{localize(language, 'Halus', 'Smooth')}</option>
                        <option value="off">{localize(language, 'Mati', 'Off')}</option>
                      </select>
                    </label>
                  </section>

                  <section className="settings-section settings-position-section">
                    <label className="settings-language-field">
                      <span>{localize(language, 'Durasi notif', 'Notice time')}</span>
                      <input
                        className="settings-range"
                        type="range"
                        min={2}
                        max={10}
                        step={1}
                        value={Math.min(10, Math.max(2, windhawkSettings.appearance.noticeDurationSec))}
                        onChange={(event) => onWindhawkSettingsChange({
                          ...windhawkSettings,
                          appearance: { ...windhawkSettings.appearance, noticeDurationSec: Number(event.target.value) }
                        })}
                      />
                      <small className="settings-range-value">
                        {Math.min(10, Math.max(2, windhawkSettings.appearance.noticeDurationSec))}{localize(language, 'dtk', 's')}
                      </small>
                    </label>
                  </section>
                </div>
              )}
            </section>

            <section className="settings-section settings-section--theme">
              <button
                className="settings-section-toggle"
                type="button"
                aria-expanded={expandedSettings.theme}
                aria-controls="settings-theme-content"
                onClick={() => setExpandedSettings((current) => ({ ...current, theme: !current.theme }))}
              >
                <span className="settings-section-icon"><Palette size={13} /></span>
                <span className="settings-section-title">
                  <strong>{localize(language, 'Tema & Ukuran', 'Theme & Size')}</strong>
                  <small>{localize(language, 'Warna, opasitas, font & dimensi', 'Colors, opacity, font & sizing')}</small>
                </span>
                <span className="settings-enabled-count">
                  {windhawkSettings.themes.themePreset}
                </span>
                <ChevronRight className="settings-section-chevron" size={14} />
              </button>
              {expandedSettings.theme && (
                <div className="settings-section-content" id="settings-theme-content">
                  <div className="settings-theme-grid" role="radiogroup" aria-label={localize(language, 'Preset tema', 'Theme presets')}>
                    {([
                      ['obsidian', 'Obsidian', '#08080a'],
                      ['graphite', 'Graphite', '#18181b'],
                      ['slate', 'Slate', '#1e293b'],
                      ['nord', 'Nord', '#2e3440'],
                      ['evergreen', 'Evergreen', '#0c2118'],
                      ['espresso', 'Espresso', '#21180f'],
                      ['plum', 'Plum', '#241b2f'],
                      ['porcelain', 'Porcelain', '#f4f2ee'],
                      ['custom', localize(language, 'Kustom', 'Custom'), windhawkSettings.themes.pillBgColor]
                    ] as const).map(([id, label, swatch]) => {
                      const active = windhawkSettings.themes.themePreset === id;
                      return (
                        <button
                          key={id}
                          type="button"
                          role="radio"
                          aria-checked={active}
                          className={`settings-theme-chip${active ? ' is-active' : ''}`}
                          onClick={() => {
                            const themePreset = WINDHAWK_THEMES.find((theme) => theme === id);
                            if (!themePreset) return;
                            onWindhawkSettingsChange({
                              ...windhawkSettings,
                              themes: { ...windhawkSettings.themes, themePreset }
                            });
                          }}
                        >
                          <i className="settings-theme-chip__swatch" style={{ backgroundColor: swatch }} aria-hidden="true" />
                          <span>{label}</span>
                        </button>
                      );
                    })}
                  </div>

                  {windhawkSettings.themes.themePreset === 'custom' && (
                    <div className="settings-color-row">
                      <label className="settings-color-field">
                        <span>{localize(language, 'Latar', 'Bg')}</span>
                        <input
                          type="color"
                          value={windhawkSettings.themes.pillBgColor}
                          onChange={(event) => onWindhawkSettingsChange({
                            ...windhawkSettings,
                            themes: { ...windhawkSettings.themes, pillBgColor: event.target.value }
                          })}
                        />
                      </label>
                      <label className="settings-color-field">
                        <span>Border</span>
                        <input
                          type="color"
                          value={windhawkSettings.themes.contourBorderHex}
                          onChange={(event) => onWindhawkSettingsChange({
                            ...windhawkSettings,
                            themes: { ...windhawkSettings.themes, contourBorderHex: event.target.value }
                          })}
                        />
                      </label>
                      <label className="settings-color-field">
                        <span>{localize(language, 'Teks', 'Text')}</span>
                        <input
                          type="color"
                          value={windhawkSettings.themes.textPrimaryColor}
                          onChange={(event) => onWindhawkSettingsChange({
                            ...windhawkSettings,
                            themes: { ...windhawkSettings.themes, textPrimaryColor: event.target.value }
                          })}
                        />
                      </label>
                    </div>
                  )}

                  <section className="settings-section settings-position-section">
                    <label className="settings-language-field">
                      <span>{localize(language, 'Opasitas', 'Opacity')}</span>
                      <input
                        className="settings-range"
                        type="range"
                        min={35}
                        max={100}
                        step={1}
                        value={Math.min(100, Math.max(35, windhawkSettings.themes.pillOpacity))}
                        onChange={(event) => onWindhawkSettingsChange({
                          ...windhawkSettings,
                          themes: { ...windhawkSettings.themes, pillOpacity: Number(event.target.value) }
                        })}
                      />
                      <small className="settings-range-value">{Math.min(100, Math.max(35, windhawkSettings.themes.pillOpacity))}%</small>
                    </label>
                  </section>

                  <section className="settings-section settings-position-section">
                    <label className="settings-language-field">
                      <span>{localize(language, 'Font teks', 'Text font')}</span>
                      <select
                        value={windhawkSettings.themes.fontFamily}
                        onChange={(event) => onWindhawkSettingsChange({
                          ...windhawkSettings,
                          themes: { ...windhawkSettings.themes, fontFamily: event.target.value }
                        })}
                      >
                        <option value="">{localize(language, 'Sistem (default)', 'System (default)')}</option>
                        <option value='"Segoe UI", sans-serif'>Segoe UI</option>
                        <option value='"Inter", "Segoe UI", sans-serif'>Inter</option>
                        <option value='"Trebuchet MS", "Segoe UI", sans-serif'>Rounded Sans</option>
                        <option value='"Cascadia Code", Consolas, monospace'>Monospace</option>
                        <option value='Georgia, Cambria, serif'>Serif</option>
                      </select>
                    </label>
                  </section>

                  <section className="settings-section settings-position-section">
                    <div className="settings-language-field">
                      <span>{localize(language, 'Warna teks', 'Text color')}</span>
                      <div className="settings-text-color-controls">
                        <input
                          type="color"
                          aria-label={localize(language, 'Pilih warna teks', 'Pick text color')}
                          value={windhawkSettings.themes.textColorOverride || '#f4f4f5'}
                          onChange={(event) => onWindhawkSettingsChange({
                            ...windhawkSettings,
                            themes: { ...windhawkSettings.themes, textColorOverride: event.target.value }
                          })}
                        />
                        {windhawkSettings.themes.textColorOverride && (
                          <button
                            type="button"
                            className="settings-activity-bulk"
                            onClick={() => onWindhawkSettingsChange({
                              ...windhawkSettings,
                              themes: { ...windhawkSettings.themes, textColorOverride: '' }
                            })}
                          >
                            Reset
                          </button>
                        )}
                      </div>
                    </div>
                  </section>

                  <section className="settings-section settings-position-section">
                    <div className="settings-language-field">
                      <span>{localize(language, 'Gradasi latar', 'Bg gradient')}</span>
                      <div className="settings-text-color-controls">
                        <input
                          className="settings-master-switch"
                          type="checkbox"
                          role="switch"
                          checked={windhawkSettings.themes.bgGradientEnabled}
                          onChange={(event) => onWindhawkSettingsChange({
                            ...windhawkSettings,
                            themes: { ...windhawkSettings.themes, bgGradientEnabled: event.target.checked }
                          })}
                        />
                        {windhawkSettings.themes.bgGradientEnabled && (
                          <input
                            type="color"
                            aria-label={localize(language, 'Warna gradasi kedua', 'Second gradient color')}
                            value={windhawkSettings.themes.bgGradientTo}
                            onChange={(event) => onWindhawkSettingsChange({
                              ...windhawkSettings,
                              themes: { ...windhawkSettings.themes, bgGradientTo: event.target.value }
                            })}
                          />
                        )}
                      </div>
                    </div>
                  </section>

                  <section className="settings-section settings-position-section">
                    <div className="settings-language-field">
                      <span>{localize(language, 'Border glow', 'Border glow')}</span>
                      <div className="settings-text-color-controls">
                        <input
                          className="settings-master-switch"
                          type="checkbox"
                          role="switch"
                          checked={windhawkSettings.themes.borderGlowEnabled}
                          onChange={(event) => onWindhawkSettingsChange({
                            ...windhawkSettings,
                            themes: { ...windhawkSettings.themes, borderGlowEnabled: event.target.checked }
                          })}
                        />
                        {(windhawkSettings.themes.borderGlowEnabled || windhawkSettings.themes.musicReactiveGlow) && (
                          <input
                            type="color"
                            aria-label={localize(language, 'Warna glow', 'Glow color')}
                            value={windhawkSettings.themes.borderGlowColor}
                            onChange={(event) => onWindhawkSettingsChange({
                              ...windhawkSettings,
                              themes: { ...windhawkSettings.themes, borderGlowColor: event.target.value }
                            })}
                          />
                        )}
                      </div>
                    </div>
                  </section>

                  <section className="settings-section settings-position-section">
                    <label className="settings-inline-row">
                      <span className="settings-section-title">
                        <strong>{localize(language, 'Glow ikuti musik', 'Music reactive glow')}</strong>
                      </span>
                      <input
                        type="checkbox"
                        role="switch"
                        checked={windhawkSettings.themes.musicReactiveGlow}
                        onChange={(event) => onWindhawkSettingsChange({
                          ...windhawkSettings,
                          themes: { ...windhawkSettings.themes, musicReactiveGlow: event.target.checked }
                        })}
                      />
                    </label>
                  </section>

                  <section className="settings-section settings-position-section">
                    <label className="settings-language-field">
                      <span>{localize(language, 'Skala', 'Scale')}</span>
                      <select
                        value={windhawkSettings.appearance.sizeScale}
                        onChange={(event) => {
                          const sizeScale = ISLAND_SCALES.find((scale) => scale === event.target.value);
                          if (!sizeScale) return;
                          onWindhawkSettingsChange({
                            ...windhawkSettings,
                            appearance: { ...windhawkSettings.appearance, sizeScale }
                          });
                        }}
                      >
                        {ISLAND_SCALES.map((scale) => <option key={scale} value={scale}>{scale}x</option>)}
                      </select>
                    </label>
                  </section>

                  <section className="settings-section settings-position-section">
                    <label className="settings-language-field">
                      <span>{localize(language, 'Teks', 'Text')}</span>
                      <input
                        className="settings-range"
                        type="range"
                        min={70}
                        max={160}
                        step={1}
                        value={windhawkSettings.themes.textScale}
                        onChange={(event) => onWindhawkSettingsChange({
                          ...windhawkSettings,
                          themes: { ...windhawkSettings.themes, textScale: Number(event.target.value) }
                        })}
                      />
                      <small className="settings-range-value">{windhawkSettings.themes.textScale}%</small>
                    </label>
                  </section>

                  <section className="settings-section settings-position-section">
                    <label className="settings-language-field">
                      <span>{localize(language, 'Lebar', 'Width')}</span>
                      <input
                        className="settings-range"
                        type="range"
                        min={300}
                        max={560}
                        step={8}
                        value={Math.min(560, Math.max(300, windhawkSettings.appearance.panelWidth))}
                        onChange={(event) => onWindhawkSettingsChange({
                          ...windhawkSettings,
                          appearance: { ...windhawkSettings.appearance, panelWidth: Number(event.target.value) }
                        })}
                      />
                      <small className="settings-range-value">{Math.min(560, Math.max(300, windhawkSettings.appearance.panelWidth))}px</small>
                    </label>
                  </section>

                  <section className="settings-section settings-position-section">
                    <label className="settings-language-field">
                      <span>{localize(language, 'Tinggi', 'Height')}</span>
                      <input
                        className="settings-range"
                        type="range"
                        min={240}
                        max={520}
                        step={8}
                        value={Math.min(520, Math.max(240, windhawkSettings.appearance.panelHeight))}
                        onChange={(event) => onWindhawkSettingsChange({
                          ...windhawkSettings,
                          appearance: { ...windhawkSettings.appearance, panelHeight: Number(event.target.value) }
                        })}
                      />
                      <small className="settings-range-value">{Math.min(520, Math.max(240, windhawkSettings.appearance.panelHeight))}px</small>
                    </label>
                  </section>
                </div>
              )}
            </section>

            <section className="settings-section settings-section--layout">
              <button
                className="settings-section-toggle"
                type="button"
                aria-expanded={expandedSettings.layout}
                aria-controls="settings-layout-content"
                onClick={() => setExpandedSettings((current) => ({ ...current, layout: !current.layout }))}
              >
                <span className="settings-section-icon"><LayoutTemplate size={13} /></span>
                <span className="settings-section-title">
                  <strong>{localize(language, 'Layout Builder', 'Layout Builder')}</strong>
                  <small>{localize(language, 'Susun ulang Idle, Launcher & Tabs', 'Customize Idle, Launcher & Tabs')}</small>
                </span>
                <span className="settings-enabled-count">
                  {layoutSettings.preset}
                </span>
                <ChevronRight className="settings-section-chevron" size={14} />
              </button>
              {expandedSettings.layout && (
                <div className="settings-section-content" id="settings-layout-content">
                  <LayoutEditor
                    language={language}
                    layout={layoutSettings}
                    onChange={onLayoutSettingsChange}
                  />
                </div>
              )}
            </section>

            <section className="settings-section settings-section--profiles">
              <button
                className="settings-section-toggle"
                type="button"
                aria-expanded={expandedSettings.profiles}
                aria-controls="settings-profiles-content"
                onClick={() => setExpandedSettings((current) => ({ ...current, profiles: !current.profiles }))}
              >
                <span className="settings-section-icon"><Save size={13} /></span>
                <span className="settings-section-title">
                  <strong>{localize(language, 'Profil & Backup', 'Profiles & Backup')}</strong>
                  <small>{localize(language, 'Simpan, ganti & ekspor JSON', 'Save, switch & export JSON')}</small>
                </span>
                <span className="settings-enabled-count">{savedProfiles.length}</span>
                <ChevronRight className="settings-section-chevron" size={14} />
              </button>
              {expandedSettings.profiles && (
                <div className="settings-section-content" id="settings-profiles-content">
                  <form
                    className="settings-profile-save"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const name = newProfileName.trim();
                      if (!name) return;
                      const nextProfile: SavedIslandProfile = {
                        id: `prof-${Date.now()}`,
                        name,
                        settings: windhawkSettings,
                        layout: layoutSettings
                      };
                      const next = [nextProfile, ...savedProfiles.filter((p) => p.name.toLowerCase() !== name.toLowerCase())].slice(0, 12);
                      setSavedProfiles(next);
                      saveProfiles(next);
                      setNewProfileName('');
                      onNotice('Profil', localize(language, `Profil "${name}" tersimpan`, `Profile "${name}" saved`));
                    }}
                  >
                    <input
                      type="text"
                      value={newProfileName}
                      placeholder={localize(language, 'Nama profil (Kerja, Gaming)…', 'Profile name (Work, Gaming)…')}
                      onChange={(event) => setNewProfileName(event.target.value)}
                    />
                    <button type="submit" className="settings-activity-bulk" disabled={!newProfileName.trim()}>
                      {localize(language, 'Simpan', 'Save')}
                    </button>
                  </form>

                  {savedProfiles.length > 0 && (
                    <div className="layout-editor__list" style={{ marginTop: 5 }}>
                      {savedProfiles.map((profile) => (
                        <div key={profile.id} className="layout-editor__row">
                          <button
                            type="button"
                            className="settings-profile-apply"
                            onClick={() => {
                              onWindhawkSettingsChange(profile.settings);
                              onLayoutSettingsChange(profile.layout);
                              onNotice('Profil', localize(language, `Profil "${profile.name}" diterapkan`, `Profile "${profile.name}" applied`));
                            }}
                          >
                            {profile.name}
                          </button>
                          <button
                            type="button"
                            className="layout-editor__btn"
                            title={localize(language, 'Hapus profil', 'Delete profile')}
                            onClick={() => {
                              const next = savedProfiles.filter((item) => item.id !== profile.id);
                              setSavedProfiles(next);
                              saveProfiles(next);
                            }}
                          >
                            <Trash2 size={11} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="settings-profile-io">
                    <button
                      type="button"
                      className="settings-activity-bulk"
                      onClick={() => {
                        onCopyClipboard(serializeConfigBundle(windhawkSettings, layoutSettings));
                        onNotice('Backup', localize(language, 'JSON profil disalin ke clipboard', 'Profile JSON copied to clipboard'));
                      }}
                    >
                      {localize(language, 'Ekspor JSON', 'Export JSON')}
                    </button>
                    <button
                      type="button"
                      className="settings-activity-bulk"
                      onClick={() => setShowImportJson((open) => !open)}
                    >
                      {localize(language, 'Impor JSON', 'Import JSON')}
                    </button>
                  </div>

                  {showImportJson && (
                    <div className="settings-profile-import">
                      <textarea
                        rows={3}
                        value={importJsonText}
                        placeholder='{"version":1,"settings":...}'
                        onChange={(event) => setImportJsonText(event.target.value)}
                      />
                      <button
                        type="button"
                        className="tool-primary"
                        disabled={!importJsonText.trim()}
                        onClick={() => {
                          const parsed = parseConfigBundle(importJsonText);
                          if (!parsed) {
                            onNotice('Backup', localize(language, 'Format JSON tidak valid', 'Invalid JSON format'));
                            return;
                          }
                          onWindhawkSettingsChange(parsed.settings);
                          onLayoutSettingsChange(parsed.layout);
                          setImportJsonText('');
                          setShowImportJson(false);
                          onNotice('Backup', localize(language, 'Profil JSON berhasil diimpor', 'Profile JSON imported'));
                        }}
                      >
                        {localize(language, 'Terapkan JSON', 'Apply JSON')}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </section>

            <section className="settings-section settings-section--pet">
              <button
                className="settings-section-toggle"
                type="button"
                aria-expanded={expandedSettings.pet}
                aria-controls="settings-pet-content"
                onClick={() => setExpandedSettings((current) => ({ ...current, pet: !current.pet }))}
              >
                <span className="settings-section-icon"><Smile size={13} /></span>
                <span className="settings-section-title">
                  <strong>{localize(language, 'Karakter Pet', 'Island Pet')}</strong>
                  <small>{localize(language, 'Pilih karakter & waktu idle', 'Choose character & idle timer')}</small>
                </span>
                <span className="settings-enabled-count">
                  {windhawkSettings.appearance.petStyle === 'none'
                    ? localize(language, 'Off', 'Off')
                    : windhawkSettings.appearance.petStyle === 'luffy'
                      ? 'Luffy'
                      : windhawkSettings.appearance.petStyle === 'custom'
                        ? 'Custom'
                        : windhawkSettings.appearance.petStyle === 'ghost'
                          ? localize(language, 'Hantu', 'Ghost')
                          : 'Bot'}
                </span>
                <ChevronRight className="settings-section-chevron" size={14} />
              </button>
              {expandedSettings.pet && (
                <div className="settings-section-content" id="settings-pet-content">
                  <div className="settings-activity-grid" role="radiogroup" aria-label={localize(language, 'Pilih karakter pet', 'Choose pet character')}>
                    {([
                      ['luffy', 'Luffy (One Piece)'],
                      ['custom', 'Custom (PNG/GIF)'],
                      ['ghost', localize(language, 'Hantu', 'Ghost')],
                      ['bot', 'Mini Bot'],
                      ['none', localize(language, 'Nonaktif', 'Off')]
                    ] as const).map(([id, label]) => {
                      const active = windhawkSettings.appearance.petStyle === id;
                      return (
                        <button
                          key={id}
                          type="button"
                          role="radio"
                          aria-checked={active}
                          className={`settings-activity-chip${active ? ' is-active' : ''}`}
                          onClick={() => onWindhawkSettingsChange({
                            ...windhawkSettings,
                            appearance: { ...windhawkSettings.appearance, petStyle: id }
                          })}
                        >
                          <i className="settings-activity-chip__dot" aria-hidden="true" />
                          <span>{label}</span>
                        </button>
                      );
                    })}
                  </div>

                  {windhawkSettings.appearance.petStyle === 'custom' && (
                    <div className="settings-pet-upload">
                      <label className="settings-pet-upload__btn">
                        <Upload size={12} />
                        <span>{localize(language, 'Pilih gambar PNG/GIF', 'Upload PNG/GIF')}</span>
                        <input
                          type="file"
                          accept="image/png,image/gif,image/webp,image/svg+xml,image/jpeg"
                          onChange={(event) => {
                            const file = event.target.files?.[0];
                            if (!file) return;
                            if (file.size > 600_000) {
                              onNotice('Pet', localize(language, 'Ukuran file maksimal 600KB', 'Max file size is 600KB'));
                              return;
                            }
                            const reader = new FileReader();
                            reader.onload = () => {
                              if (typeof reader.result === 'string') {
                                onWindhawkSettingsChange({
                                  ...windhawkSettings,
                                  appearance: {
                                    ...windhawkSettings.appearance,
                                    petStyle: 'custom',
                                    customPetImage: reader.result
                                  }
                                });
                              }
                            };
                            reader.readAsDataURL(file);
                          }}
                        />
                      </label>
                      {windhawkSettings.appearance.customPetImage && (
                        <img
                          className="settings-pet-upload__preview"
                          src={windhawkSettings.appearance.customPetImage}
                          alt="Custom pet preview"
                        />
                      )}
                    </div>
                  )}

                  {windhawkSettings.appearance.petStyle !== 'none' && (
                    <section className="settings-section settings-position-section" style={{ marginTop: 6 }}>
                      <label className="settings-language-field">
                        <span>{localize(language, 'Idle animasi', 'Idle trigger')}</span>
                        <input
                          className="settings-range"
                          type="range"
                          min={1}
                          max={60}
                          step={1}
                          value={Math.min(60, Math.max(1, windhawkSettings.appearance.petIdleMinutes))}
                          onChange={(event) => onWindhawkSettingsChange({
                            ...windhawkSettings,
                            appearance: { ...windhawkSettings.appearance, petIdleMinutes: Number(event.target.value) }
                          })}
                        />
                        <small className="settings-range-value">
                          {Math.min(60, Math.max(1, windhawkSettings.appearance.petIdleMinutes))} {localize(language, 'mnt', 'min')}
                        </small>
                      </label>
                    </section>
                  )}
                </div>
              )}
            </section>

            <p className="settings-group-label">{localize(language, 'NOTIFIKASI & AKTIVITAS', 'NOTIFICATIONS & ACTIVITY')}</p>
            <section className="settings-section settings-section--notifications">
              <div className="settings-notif-header">
                <button
                  className="settings-section-toggle"
                  type="button"
                  aria-expanded={expandedSettings.notifications}
                  aria-controls="settings-notifications-content"
                  onClick={() => setExpandedSettings((current) => ({ ...current, notifications: !current.notifications }))}
                >
                  <span className="settings-section-icon"><Bell size={13} /></span>
                  <span className="settings-section-title">
                    <strong>{localize(language, 'Notifikasi Aplikasi', 'App Notifications')}</strong>
                    <small>{localize(language, 'Atur notifikasi per aplikasi', 'Filter alerts per app')}</small>
                  </span>
                  <ChevronRight className="settings-section-chevron" size={14} />
                </button>
                <input
                  className="settings-master-switch"
                  type="checkbox"
                  role="switch"
                  aria-label={localize(language, 'Aktifkan notifikasi Windows', 'Enable Windows notifications')}
                  checked={windowsNotificationNotices}
                  onChange={(event) => onWindowsNotificationNoticesChange(event.target.checked)}
                />
              </div>
              {expandedSettings.notifications && (
                <div className="settings-section-content" id="settings-notifications-content">
                  <div className="settings-activity-bar">
                    <form
                      className="settings-notif-add"
                      onSubmit={(event) => {
                        event.preventDefault();
                        const name = newNotifApp.trim();
                        if (!name) return;
                        onNotificationAppFiltersChange({ ...notificationAppFilters, [name]: true });
                        setNewNotifApp('');
                      }}
                    >
                      <input
                        type="text"
                        value={newNotifApp}
                        placeholder={localize(language, 'Tambah nama app…', 'Add app name…')}
                        onChange={(event) => setNewNotifApp(event.target.value)}
                      />
                      <button type="submit" className="settings-activity-bulk" disabled={!newNotifApp.trim()}>+</button>
                    </form>
                    <button
                      type="button"
                      className="settings-activity-bulk"
                      onClick={() => {
                        const entries = Object.entries(notificationAppFilters);
                        const allOn = entries.every(([, enabled]) => enabled);
                        onNotificationAppFiltersChange(
                          Object.fromEntries(entries.map(([name]) => [name, !allOn]))
                        );
                      }}
                    >
                      {Object.values(notificationAppFilters).every(Boolean)
                        ? localize(language, 'Matikan semua', 'Disable all')
                        : localize(language, 'Aktifkan semua', 'Enable all')}
                    </button>
                  </div>
                  <div className="settings-activity-grid">
                    {Object.entries(notificationAppFilters).map(([appName, enabled]) => (
                      <button
                        key={appName}
                        type="button"
                        role="switch"
                        aria-checked={enabled}
                        disabled={!windowsNotificationNotices}
                        className={`settings-activity-chip${enabled && windowsNotificationNotices ? ' is-active' : ''}`}
                        onClick={() => onNotificationAppFiltersChange({
                          ...notificationAppFilters,
                          [appName]: !enabled
                        })}
                      >
                        <i className="settings-activity-chip__dot" aria-hidden="true" />
                        <span>{appName}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </section>

            <section className="settings-section settings-section--activity">
              <button
                className="settings-section-toggle"
                type="button"
                aria-expanded={expandedSettings.activity}
                aria-controls="settings-activity-content"
                onClick={() => setExpandedSettings((current) => ({ ...current, activity: !current.activity }))}
              >
                <span className="settings-section-icon"><Activity size={13} /></span>
                <span className="settings-section-title">
                  <strong>{localize(language, 'Aktivitas Windows', 'Windows Activity')}</strong>
                  <small>{localize(language, 'Filter indikator sistem', 'Filter system indicators')}</small>
                </span>
                <span className="settings-enabled-count">
                  {Object.values(activityModuleSettings).filter(Boolean).length}/{ACTIVITY_MODULES.length}
                </span>
                <ChevronRight className="settings-section-chevron" size={14} />
              </button>
              {expandedSettings.activity && (
                <div className="settings-section-content" id="settings-activity-content">
                  <div className="settings-activity-bar">
                    <button
                      type="button"
                      className="settings-activity-bulk"
                      onClick={() => {
                        const allEnabled = ACTIVITY_MODULES.every(({ id }) => activityModuleSettings[id]);
                        const next = Object.fromEntries(
                          ACTIVITY_MODULES.map(({ id }) => [id, !allEnabled])
                        ) as ActivityModuleSettings;
                        onActivityModuleSettingsChange(next);
                      }}
                    >
                      {ACTIVITY_MODULES.every(({ id }) => activityModuleSettings[id])
                        ? localize(language, 'Matikan semua', 'Disable all')
                        : localize(language, 'Aktifkan semua', 'Enable all')}
                    </button>
                  </div>
                  <div className="settings-activity-grid">
                    {ACTIVITY_MODULES.map(({ id, label }) => {
                      const enabled = activityModuleSettings[id];
                      return (
                        <button
                          key={id}
                          type="button"
                          role="switch"
                          aria-checked={enabled}
                          className={`settings-activity-chip${enabled ? ' is-active' : ''}`}
                          onClick={() => onActivityModuleSettingsChange({
                            ...activityModuleSettings,
                            [id]: !enabled
                          })}
                        >
                          <i className="settings-activity-chip__dot" aria-hidden="true" />
                          <span>{getActivityModuleLabel(id, label, language)}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </section>

            <p className="settings-group-label">{localize(language, 'INTEGRASI', 'INTEGRATIONS')}</p>
            <section className="settings-section settings-section--clickup">
              <button
                className="settings-section-toggle"
                type="button"
                aria-expanded={expandedSettings.clickUp}
                aria-controls="settings-clickup-content"
                onClick={() => setExpandedSettings((current) => ({ ...current, clickUp: !current.clickUp }))}
              >
                <span className="settings-section-icon"><KeyRound size={13} /></span>
                <span className="settings-section-title">
                  <strong>ClickUp</strong>
                  <small>{localize(language, 'API key & daftar task', 'API key & task lists')}</small>
                </span>
                <ChevronRight className="settings-section-chevron" size={14} />
              </button>
              {expandedSettings.clickUp && (
                <div className="settings-section-content" id="settings-clickup-content">
                  <form className="settings-clickup-form" onSubmit={(event) => { void saveClickUpSettings(event); }}>
                    <label className="settings-clickup-field">
                      <span>API Key</span>
                      <input
                        type="password"
                        autoComplete="new-password"
                        value={clickUpApiKeyDraft}
                        onChange={(event) => setClickUpApiKeyDraft(event.target.value)}
                        placeholder={clickUpConfig?.api_key_configured ? localize(language, 'Tersimpan (kosongkan jika tetap)', 'Saved (leave blank to keep)') : 'pk_…'}
                      />
                    </label>
                    <label className="settings-clickup-field">
                      <span>{localize(language, 'List ID (pisah koma)', 'List IDs (comma-separated)')}</span>
                      <input
                        value={clickUpListIdsDraft}
                        onChange={(event) => setClickUpListIdsDraft(event.target.value)}
                        placeholder="901613807168"
                        required
                      />
                    </label>
                    <small className="settings-clickup-help">{localize(language, 'Tersimpan di settings.json', 'Saved in settings.json')}</small>
                    {clickUpSettingsStatus && <p className="clickup-status" role="status">{localizeMessage(language, clickUpSettingsStatus)}</p>}
                    <button className="tool-primary" type="submit" disabled={clickUpSettingsBusy}>
                      {clickUpSettingsBusy ? localize(language, 'Menyimpan…', 'Saving…') : localize(language, 'Simpan', 'Save')}
                    </button>
                  </form>
                </div>
              )}
            </section>
          </div>
        )}
          </m.div>
        </AnimatePresence>
      </div>
    </section>
  );
}
