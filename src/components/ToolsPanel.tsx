import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { openPath, openUrl } from '@tauri-apps/plugin-opener';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { AnimatePresence, m } from 'framer-motion';
import {
  AlarmClock, ArrowLeft, CalendarDays, Camera, ChevronLeft, ChevronRight, Clipboard, Copy, ExternalLink, File, ListTodo,
  LocateFixed, Pause, Pin, Play, Plus, RotateCcw, ScanText, Scissors, Search, Settings, Sparkles, StickyNote, X
} from 'lucide-react';
import AiChatTab from './AiChatTab';
import SlideDigits from './SlideDigits';
import { localize, type AppLanguage } from '../lib/i18n';
import { readAppSetting, saveAppSetting } from '../lib/storage';
import type { IslandLayoutSettings, ToolTabId } from '../lib/layoutSettings';

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

type IslandPosition = 0 | 1 | 2; // 0 = top center, 1 = left center, 2 = right center

interface ToolsPanelProps {
  language: AppLanguage;
  clipboardItems: ClipboardItem[];
  shelfPaths: string[];
  onClose: () => void;
  onReturnToMenu: () => void;
  onClearClipboard: () => void;
  onRemoveShelfItem: (path: string) => void;
  onCopyClipboard: (text: string) => void;
  onNotice: (title: string, body: string) => void;
  onCapture: () => void;
  onScreenshot: () => void;
  islandPosition: IslandPosition;
  layoutSettings: IslandLayoutSettings;
  openTabRequest: { tab: ToolTabId; seq: number } | null;
  onFocusStateChange?: (state: FocusLiveState) => void;
  onNextPrayerChange?: (label: string | null) => void;
}

type ToolTab = ToolTabId;

const TABS: { id: ToolTab; label: string }[] = [
  { id: 'focus', label: 'Focus' },
  { id: 'tasks', label: 'To-do' },
  { id: 'notes', label: 'Notes' },
  { id: 'ai', label: 'AI' },
  { id: 'clipboard', label: 'Clipboard' },
  { id: 'shelf', label: 'Shelf' },
  { id: 'prayer', label: 'Prayer' },
  { id: 'capture', label: 'Capture' }
];

function localizeMessage(language: AppLanguage, message: string) {
  if (language === 'id' || !message) return message;
  const translations: Record<string, string> = {
    'Atur API key ClickUp di settings.json': 'Set the ClickUp API key in settings.json',
    'Atur List ID ClickUp di settings.json': 'Set the ClickUp List IDs in settings.json',
    'Menyimpan konfigurasiâ€¦': 'Saving configurationâ€¦',
    'Pengaturan tersimpan. Perubahan ClickUp langsung digunakan.': 'Settings saved. ClickUp changes are applied immediately.',
    'Lokasi tidak didukung perangkat': 'Location is not supported on this device',
    'Lokasi belum diambil': 'Location has not been acquired',
    'Mencari lokasiâ€¦': 'Finding your locationâ€¦',
    'Lokasi saat ini': 'Current location',
    'Izin lokasi ditolak': 'Location permission denied',
    'Lokasi tidak merespons': 'Location request timed out',
    'Lokasi tidak tersedia': 'Location unavailable',
    'Memuat jadwalâ€¦': 'Loading scheduleâ€¦',
    'Jadwal salat tidak tersedia': 'Prayer schedule is unavailable',
    'Gagal memuat jadwal salat': 'Failed to load prayer schedule',
    'Pilih List ID yang tersedia dan periksa konfigurasi ClickUp di settings.json': 'Select an available List ID and check the ClickUp configuration in settings.json',
    'Memuat task dari ClickUpâ€¦': 'Loading tasks from ClickUpâ€¦',
    'Konfigurasi ClickUp tidak tersedia. Periksa API key dan List ID di settings.json': 'ClickUp configuration is unavailable. Check the API key and List IDs in settings.json',
    'Isi nama task terlebih dahulu': 'Enter a task name first',
    'Pilih tanggal yang valid dan pastikan tanggal akhir tidak sebelum tanggal awal': 'Choose valid dates and make sure the end date is not before the start date',
    'Rentang tanggal maksimal 366 hari': 'The maximum date range is 366 days',
    'Tidak ada task yang dibuat karena tanggal yang dipilih hanya mencakup akhir pekan': 'No tasks were created because the selected dates only include weekends'
  };
  if (translations[message]) return translations[message];
  const loaded = message.match(/^(\d+) task dimuat$/);
  if (loaded) return `${loaded[1]} ${loaded[1] === '1' ? 'task' : 'tasks'} loaded`;
  const creating = message.match(/^Membuat (\d+) task hari kerja dan time entry di ClickUpâ€¦$/);
  if (creating) return `Creating ${creating[1]} weekday tasks and time entries in ClickUpâ€¦`;
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
  language, clipboardItems, shelfPaths, onClose, onReturnToMenu, onClearClipboard,
  onRemoveShelfItem, onCopyClipboard, onNotice, onCapture, onScreenshot,
  islandPosition, layoutSettings, openTabRequest, onFocusStateChange, onNextPrayerChange
}: ToolsPanelProps) {
  const [tab, setTab] = useState<ToolTab>('focus');
  const [capturePaths, setCapturePaths] = useState<string[]>([]);
  const [ocrRunning, setOcrRunning] = useState(false);
  const [ocrText, setOcrText] = useState<string | null>(null);
  const [clipboardSearch, setClipboardSearch] = useState('');
  const [pinnedClips, setPinnedClips] = useState<string[]>(() => readStored<string[]>('di-pinned-clipboard', []));
  const [quickNotes, setQuickNotes] = useState<string>(() => readStored<string>('di-quick-notes', ''));

  const resolvedNavLayout = layoutSettings.toolsNavLayout === 'auto'
    ? (islandPosition === 0 ? 'top' : islandPosition === 1 ? 'left' : 'right')
    : layoutSettings.toolsNavLayout;
  const isVerticalLayout = resolvedNavLayout === 'left' || resolvedNavLayout === 'right';
  const [remaining, setRemaining] = useState(() => readStored('di-focus-remaining', 25 * 60));
  const [focusMinutes, setFocusMinutes] = useState(() => readStored('di-focus-minutes', 25));
  const [breakMinutes, setBreakMinutes] = useState(() => readStored('di-break-minutes', 5));
  const [running, setRunning] = useState(false);
  const [isBreak, setIsBreak] = useState(false);
  const [sessions, setSessions] = useState(() => readStored('di-focus-sessions', 0));
  const [clickUpConfig, setClickUpConfig] = useState<ClickUpConfig | null>(null);
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
  const [location, setLocation] = useState<PrayerLocation | null>(() => readStored<PrayerLocation | null>('di-prayer-location', null));
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

  const requestLocation = () => {
    if (!navigator.geolocation) {
      setLocationStatus('Lokasi tidak didukung perangkat');
      setLocation(null);
      return;
    }

    setLocation(null);
    setPrayerTimes([]);
    setPrayerStatus('');
    setLocationStatus('Mencari lokasiâ€¦');
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const nextLoc = { latitude: coords.latitude, longitude: coords.longitude };
        setLocation(nextLoc);
        saveAppSetting('di-prayer-location', nextLoc);
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
      setPrayerStatus('Memuat jadwalâ€¦');
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
    if (!nextPrayer) {
      onNextPrayerChange?.(null);
      return;
    }
    const [name, timeStr] = nextPrayer;
    const [hh, mm] = timeStr.split(':').map(Number);
    const nowDate = new Date(now);
    const target = new Date(nowDate);
    target.setHours(hh || 0, mm || 0, 0, 0);
    if (target.getTime() <= nowDate.getTime()) {
      target.setDate(target.getDate() + 1);
    }
    const diffMins = Math.max(1, Math.round((target.getTime() - nowDate.getTime()) / 60_000));
    const hours = Math.floor(diffMins / 60);
    const mins = diffMins % 60;
    const countdown = hours > 0
      ? `${hours}${localize(language, 'j', 'h')} ${mins}m`
      : `${mins}m`;
    onNextPrayerChange?.(`${name} Â· ${countdown}`);
  }, [nextPrayer, now, language, onNextPrayerChange]);

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
    setClickUpStatus('Memuat task dari ClickUpâ€¦');
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
    setClickUpStatus(`Membuat ${dueDates.length} task hari kerja dan time entry di ClickUpâ€¦`);
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
    .filter((entry) => entry.visible)
    .map((entry) => TABS.find((t) => t.id === entry.id))
    .filter((item): item is { id: ToolTab; label: string } => Boolean(item));

  useEffect(() => {
    if (!visibleTabs.some((item) => item.id === tab)) {
      setTab(visibleTabs[0]?.id ?? 'focus');
    }
  }, [visibleTabs, tab]);

  const togglePinClip = (text: string) => {
    setPinnedClips((current) => {
      const next = current.includes(text)
        ? current.filter((item) => item !== text)
        : [text, ...current].slice(0, 12);
      saveAppSetting('di-pinned-clipboard', next);
      return next;
    });
  };

  const tabsIcon: Record<ToolTab, ReactNode> = {
    focus: <AlarmClock size={15} />, tasks: <ListTodo size={15} />, notes: <StickyNote size={15} />, ai: <Sparkles size={15} />, clipboard: <Clipboard size={15} />,
    shelf: <File size={15} />, prayer: <span>☾</span>, capture: <Camera size={15} />
  };

  return (
    <section
      className={`tools-panel island-module${isVerticalLayout ? ' tools-panel--side' : ''}${resolvedNavLayout === 'right' ? ' tools-panel--nav-right' : ''}${layoutSettings.toolsTabLabels ? ' tools-panel--with-labels' : ''}`}
      aria-label={localize(language, 'Alat Dynamic Island', 'Dynamic Island tools')}
    >
      <header className="tools-header">
        <button className="tools-back" aria-label={localize(language, 'Kembali ke menu', 'Back to menu')} onClick={onReturnToMenu}><ArrowLeft size={14} /></button>
        <div className="island-action-pill">
          <button
            type="button"
            className="detail-action-button"
            aria-label={localize(language, 'Buka jendela pengaturan', 'Open settings window')}
            title={localize(language, 'Buka jendela pengaturan terpisah', 'Open separate settings window')}
            onClick={() => { void invoke('open_settings_window').catch(() => {}); }}
          >
            <Settings size={13} />
          </button>
          <button
            type="button"
            className="detail-action-button"
            aria-label={localize(language, 'Tutup menu', 'Close menu')}
            title={localize(language, 'Tutup', 'Close')}
            onClick={onClose}
          >
            <X size={13} />
          </button>
        </div>
      </header>
      <nav className="tools-tabs" aria-label={localize(language, 'Alat', 'Tools')}>
        {visibleTabs.map((item) => (
          <button
            key={item.id}
            aria-label={item.id === 'focus' ? localize(language, 'Fokus', 'Focus') : item.id === 'tasks' ? 'To-do' : item.id === 'notes' ? localize(language, 'Catatan', 'Notes') : item.id === 'ai' ? 'AI Chat' : item.id === 'clipboard' ? 'Clipboard' : item.id === 'shelf' ? 'Shelf' : item.id === 'prayer' ? localize(language, 'Salat', 'Prayer') : localize(language, 'Tangkapan layar', 'Capture')}
            aria-current={tab === item.id ? 'page' : undefined}
            className={tab === item.id ? 'tools-tab is-active' : 'tools-tab'}
            onClick={() => setTab(item.id)}
          >
            {tab === item.id && (
              <m.span
                layoutId="tools-tab-active-pill"
                className="tools-tab__active-pill"
                transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                aria-hidden="true"
              />
            )}
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
            <span className="focus-status">{isBreak ? localize(language, 'Istirahat', 'Break') : localize(language, 'Fokus', 'Focus')}{sessions > 0 ? ` Â· ${sessions} ${localize(language, 'selesai', 'completed')}` : ''}</span>
            <strong className="focus-countdown"><SlideDigits value={formatTime(remaining)} /></strong>
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
              <p className="tool-empty">{clickUpStatus ? localizeMessage(language, clickUpStatus) : localize(language, 'Memeriksa konfigurasi ClickUpâ€¦', 'Checking ClickUp configurationâ€¦')}</p>
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
                    {clickUpBusy ? localize(language, 'Memuatâ€¦', 'Loadingâ€¦') : localize(language, 'Muat task', 'Load tasks')}
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
                      {clickUpBusy ? localize(language, 'Memprosesâ€¦', 'Processingâ€¦') : localize(language, 'Buat task', 'Create task')}
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
                            <td>{task.due_date ? new Date(Number(task.due_date)).toLocaleDateString(language === 'id' ? 'id-ID' : 'en-US') : 'â€”'}</td>
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
        {tab === 'notes' && (
          <div className="tool-card notes-card">
            <div className="tool-card-heading">
              <span className="tool-count">
                {quickNotes.trim() ? `${quickNotes.trim().split(/\s+/).length} ${localize(language, 'kata', 'words')} Â· ${quickNotes.length}` : localize(language, 'Catatan cepat', 'Quick scratchpad')}
              </span>
              <div className="notes-actions">
                <button
                  type="button"
                  className="tool-text-button"
                  disabled={!quickNotes.trim()}
                  onClick={() => {
                    onCopyClipboard(quickNotes);
                    onNotice(localize(language, 'Catatan disalin', 'Notes copied'), localize(language, 'Teks catatan disalin ke clipboard.', 'Scratchpad copied to clipboard.'));
                  }}
                >
                  {localize(language, 'Salin', 'Copy')}
                </button>
                <button
                  type="button"
                  className="tool-text-button"
                  disabled={!quickNotes}
                  onClick={() => {
                    setQuickNotes('');
                    saveAppSetting('di-quick-notes', '');
                  }}
                >
                  {localize(language, 'Hapus', 'Clear')}
                </button>
              </div>
            </div>
            <textarea
              className="notes-textarea"
              value={quickNotes}
              placeholder={localize(language, 'Tulis catatan kilat di siniâ€¦ (tersimpan otomatis)', 'Write quick notes hereâ€¦ (auto-saved)')}
              onChange={(event) => {
                const value = event.target.value;
                setQuickNotes(value);
                saveAppSetting('di-quick-notes', value);
              }}
            />
          </div>
        )}
        {tab === 'clipboard' && (() => {
          const query = clipboardSearch.trim().toLowerCase();
          const pinnedRows = pinnedClips.map((text) => ({ text, timestamp: 0, pinned: true }));
          const historyRows = clipboardItems
            .filter((item) => !pinnedClips.includes(item.text))
            .map((item) => ({ ...item, pinned: false }));
          const combined = [...pinnedRows, ...historyRows].filter((item) => (
            !query || item.text.toLowerCase().includes(query)
          ));
          return (
            <div className="tool-card">
              <div className="tool-card-heading">
                <span className="tool-count">
                  {combined.length} {localize(language, 'item', 'items')}
                  {pinnedClips.length > 0 ? ` Â· ${pinnedClips.length} pin` : ''}
                </span>
                <button className="tool-text-button" onClick={onClearClipboard}>{localize(language, 'Hapus riwayat', 'Clear history')}</button>
              </div>
              <div className="clipboard-search">
                <Search size={12} />
                <input
                  type="text"
                  value={clipboardSearch}
                  placeholder={localize(language, 'Cari clipboardâ€¦', 'Search clipboardâ€¦')}
                  onChange={(event) => setClipboardSearch(event.target.value)}
                />
                {clipboardSearch && (
                  <button type="button" onClick={() => setClipboardSearch('')} aria-label="Clear search">
                    <X size={11} />
                  </button>
                )}
              </div>
              <div className="history-list">
                {combined.length === 0 && (
                  <p className="tool-empty">
                    {query
                      ? localize(language, 'Tidak ada item yang cocok.', 'No matching items.')
                      : localize(language, 'Belum ada teks yang disalin.', 'No copied text yet.')}
                  </p>
                )}
                {combined.map((item, index) => {
                  const trimmed = item.text.trim();
                  const isUrl = /^https?:\/\/\S+$/i.test(trimmed);
                  const isHexColor = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(trimmed);
                  return (
                    <div className={`history-row-wrap${item.pinned ? ' is-pinned' : ''}`} key={`${item.pinned ? 'pin' : item.timestamp}-${index}`}>
                      <button
                        type="button"
                        className="history-row"
                        title={localize(language, 'Klik untuk menyalin', 'Click to copy')}
                        onClick={() => onCopyClipboard(item.text)}
                      >
                        {isHexColor && (
                          <i className="history-color-swatch" style={{ backgroundColor: trimmed }} aria-hidden="true" />
                        )}
                        <span>{item.text}</span>
                        {item.timestamp > 0 && (
                          <small>{new Date(item.timestamp).toLocaleTimeString(language === 'id' ? 'id-ID' : 'en-US', { hour: '2-digit', minute: '2-digit' })}</small>
                        )}
                      </button>
                      <div className="history-row-actions">
                        {isUrl && (
                          <button
                            type="button"
                            className="history-action-btn"
                            title={localize(language, 'Buka tautan', 'Open link')}
                            aria-label={localize(language, 'Buka tautan', 'Open link')}
                            onClick={() => { void openUrl(trimmed).catch(() => {}); }}
                          >
                            <ExternalLink size={11} />
                          </button>
                        )}
                        <button
                          type="button"
                          className={`history-action-btn${item.pinned ? ' is-active' : ''}`}
                          title={item.pinned ? localize(language, 'Lepas pin', 'Unpin') : localize(language, 'Sematkan', 'Pin')}
                          aria-label={item.pinned ? localize(language, 'Lepas pin', 'Unpin') : localize(language, 'Sematkan', 'Pin')}
                          onClick={() => togglePinClip(item.text)}
                        >
                          <Pin size={11} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}
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
              {nextPrayer && <span className="prayer-next">{nextPrayer[0]} Â· {nextPrayer[1]}</span>}
              {(locationStatus !== 'Lokasi saat ini' || (prayerStatus && prayerStatus !== 'Memuat jadwalâ€¦')) && (
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
                <span>{ocrRunning ? 'â€¦' : 'OCR'}</span>
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
          </m.div>
        </AnimatePresence>
      </div>
    </section>
  );
}
