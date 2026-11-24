import { lazy, Suspense, useState, useEffect, useRef, useCallback, type CSSProperties } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { openPath, openUrl } from '@tauri-apps/plugin-opener';
import { availableMonitors, currentMonitor, getCurrentWindow } from '@tauri-apps/api/window';
import { AnimatePresence, domMax, LazyMotion, m, type Transition } from 'framer-motion';
import { AlarmClock, Battery, BatteryCharging, Bluetooth, Camera, Cpu, Download, HardDrive, LayoutGrid, Mic, Music2, Wifi } from 'lucide-react';
import ToolsPanel, { type ClipboardItem, type FocusLiveState } from './components/ToolsPanel';
import { localize, readAppLanguage, type AppLanguage } from './lib/i18n';
import { readAppSetting, saveAppSetting } from './lib/storage';
import { readWindhawkSettings, saveWindhawkSettings, type ClickThroughMode } from './lib/appearanceSettings';
import { readLayoutSettings, saveLayoutSettings, type ToolTabId } from './lib/layoutSettings';
import { fetchLyricsCached, getActiveLyricIndex, parseLrc, type SyncedLine } from './lib/lyrics';
import { getMediaProvider } from './lib/media';
import AutoNoticeCard from './components/AutoNoticeCard';
import IslandPet from './components/IslandPet';
import Launcher from './components/Launcher';
import SlideDigits from './components/SlideDigits';
import { ACTIVITY_MODULE_DEFAULTS, type ActivityModule, type ActivityModuleSettings, type AutoNotice, type BatteryInfo, type SysData } from './types';
import './App.css';

const MediaDetail = lazy(() => import('./components/MediaDetail'));
const SystemMonitorDetail = lazy(() => import('./components/SystemMonitorDetail'));

interface ClipboardHistoryItem {
  text: string;
  timestamp: number;
}

type IslandMode = 'idle' | 'launcher' | 'autoNotice' | 'mediaDetail' | 'systemMonitor' | 'tools';
type IslandPosition = 0 | 1 | 2; // 0 = top center, 1 = left center, 2 = right center
type IslandStyle = CSSProperties & {
  '--island-pill-opacity': string;
  '--island-text-override'?: string;
  '--island-bg-gradient-to'?: string;
  '--island-glow-color'?: string;
  '--island-custom-theme-bg'?: string;
  '--island-custom-theme-border'?: string;
  '--island-custom-theme-text'?: string;
};

function readLocalItems<T>(key: string): T[] {
  const stored = readAppSetting<unknown>(key, []);
  return Array.isArray(stored) ? stored as T[] : [];
}

function readLocalBoolean(key: string, fallback: boolean): boolean {
  const stored = readAppSetting<unknown>(key, fallback);
  return typeof stored === 'boolean' ? stored : fallback;
}

function readActivityModuleSettings(): ActivityModuleSettings {
  const legacyEnabled = readLocalBoolean('di-windows-activity-notices', true);
  const stored = readAppSetting<unknown>('di-windows-activity-modules', null);
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
    return Object.fromEntries(
      Object.keys(ACTIVITY_MODULE_DEFAULTS).map((key) => [key, legacyEnabled])
    ) as ActivityModuleSettings;
  }
  return Object.fromEntries(
    Object.entries(ACTIVITY_MODULE_DEFAULTS).map(([key, defaultValue]) => {
      const value = (stored as Record<string, unknown>)[key];
      return [key, typeof value === 'boolean' ? value : defaultValue];
    })
  ) as ActivityModuleSettings;
}

const DEFAULT_NOTIFICATION_APP_FILTERS: Record<string, boolean> = {
  WhatsApp: true,
  Telegram: true,
  Discord: true,
  Chrome: true,
  Edge: true,
  Slack: true,
  'Microsoft Teams': true,
  Outlook: true,
  Spotify: true
};

function readNotificationAppFilters(): Record<string, boolean> {
  const stored = readAppSetting<unknown>('di-notification-app-filters', null);
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
    return { ...DEFAULT_NOTIFICATION_APP_FILTERS };
  }
  const merged: Record<string, boolean> = { ...DEFAULT_NOTIFICATION_APP_FILTERS };
  for (const [key, value] of Object.entries(stored as Record<string, unknown>)) {
    if (key.trim() && typeof value === 'boolean') {
      merged[key.trim()] = value;
    }
  }
  return merged;
}

function formatCompactSpeed(bytesPerSec: number): string {
  if (bytesPerSec >= 1024 * 1024) return `${(bytesPerSec / (1024 * 1024)).toFixed(1)}M`;
  if (bytesPerSec >= 1024) return `${Math.round(bytesPerSec / 1024)}K`;
  return `${Math.round(bytesPerSec)}B`;
}

function readIslandPosition(): IslandPosition {
  const value = readAppSetting<unknown>('di-island-position', 0);
  return value === 1 || value === 2 ? value : 0;
}

export default function DynamicIsland() {
  const [language, setLanguage] = useState<AppLanguage>(readAppLanguage);
  const [sysData, setSysData] = useState<SysData>({
    battery: null,
    batteryState: 'Unknown',
    batteryError: null,
    volume: 50,
    isWifiConnected: false,
    activeWifiName: "",
    capsLock: false,
    numLock: false,
    scrollLock: false,
    microphoneMuted: false,
    outputMuted: false,
    media: null,
    cpuUsage: null,
    memoryUsedBytes: null,
    memoryTotalBytes: null,
    cameraActive: false,
    cameraApp: null,
    micInUse: false,
    micApp: null,
    pcIdleSeconds: 0,
    activeDownload: null,
    bluetoothDevice: null,
    netRxBytesPerSec: null,
    netTxBytesPerSec: null
  });

  const [islandMode, setIslandMode] = useState<IslandMode>('idle');
  const [islandPosition, setIslandPosition] = useState<IslandPosition>(readIslandPosition);
  const [windhawkSettings, setWindhawkSettings] = useState(readWindhawkSettings);
  const [layoutSettings, setLayoutSettings] = useState(readLayoutSettings);
  const [openSettingsRequest, setOpenSettingsRequest] = useState(0);
  const [openTabRequest, setOpenTabRequest] = useState<{ tab: ToolTabId; seq: number } | null>(null);
  const [focusLive, setFocusLive] = useState<FocusLiveState>({
    running: false,
    remainingSeconds: 25 * 60,
    totalSeconds: 25 * 60,
    isBreak: false
  });
  const [viewport, setViewport] = useState(() => ({
    width: window.screen.width,
    height: window.screen.height
  }));
  const [time, setTime] = useState(new Date());
  const [autoNotice, setAutoNotice] = useState<AutoNotice | null>(null);
  const [clipboardItems, setClipboardItems] = useState<ClipboardItem[]>(() => readLocalItems<ClipboardItem>('di-clipboard-history'));
  const [shelfPaths, setShelfPaths] = useState<string[]>(() => readLocalItems<string>('di-file-shelf'));
  const [showLyrics, setShowLyrics] = useState(() => readLocalBoolean('di-show-lyrics', false));
  const [mediaArtwork, setMediaArtwork] = useState<string | null>(null);
  const [mediaPinned, setMediaPinned] = useState(() => readLocalBoolean('di-pin-media', false));
  const [monitorPinned, setMonitorPinned] = useState(() => (
    readLocalBoolean('di-pin-monitor', readLocalBoolean('di-pin-battery', false))
  ));
  const [activityModuleSettings, setActivityModuleSettings] = useState(readActivityModuleSettings);
  const [windowsNotificationNotices, setWindowsNotificationNotices] = useState(
    () => readLocalBoolean('di-windows-notification-notices', true)
  );
  const [notificationAppFilters, setNotificationAppFilters] = useState<Record<string, boolean>>(
    readNotificationAppFilters
  );
  const islandModeRef = useRef<IslandMode>('idle');
  const activityModuleSettingsRef = useRef(activityModuleSettings);
  const windowsNotificationNoticesRef = useRef(windowsNotificationNotices);
  const notificationAppFiltersRef = useRef(notificationAppFilters);
  const noticeDurationMsRef = useRef(4000);
  const [clickThroughActive, setClickThroughActive] = useState(false);
  const [idleHovered, setIdleHovered] = useState(false);
  const [nextPrayerLabel, setNextPrayerLabel] = useState<string | null>(null);
  const [tickerIndex, setTickerIndex] = useState(0);
  const [idleSyncedLyrics, setIdleSyncedLyrics] = useState<SyncedLine[]>([]);
  const [idleMediaPosition, setIdleMediaPosition] = useState(0);
  const lastWheelAtRef = useRef(0);
  const brightnessCacheRef = useRef<number | null>(null);
  const autoNoticeRef = useRef<AutoNotice | null>(null);
  const previousSystemDataRef = useRef<SysData | null>(null);
  const autoNoticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeDelayTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoNoticeQueue = useRef<AutoNotice[]>([]);

  activityModuleSettingsRef.current = activityModuleSettings;
  windowsNotificationNoticesRef.current = windowsNotificationNotices;
  notificationAppFiltersRef.current = notificationAppFilters;
  noticeDurationMsRef.current = Math.min(10, Math.max(2, windhawkSettings.appearance.noticeDurationSec || 4)) * 1000;

  useEffect(() => {
    let active = true;
    const media = sysData.media;
    if (!media || !getMediaProvider(media.source_app)) {
      setMediaArtwork(null);
      return () => { active = false; };
    }

    setMediaArtwork(null);
    void invoke<string | null>('get_current_media_artwork')
      .then((artwork) => {
        if (active) setMediaArtwork(artwork);
      })
      .catch((error: unknown) => {
        if (active) console.warn('Artwork media tidak tersedia:', error);
      });
    return () => { active = false; };
  }, [sysData.media?.title, sysData.media?.artist, sysData.media?.source_app]);

  useEffect(() => {
    const media = sysData.media;
    if (!media || !media.title.trim()) {
      setIdleSyncedLyrics([]);
      return;
    }
    let active = true;
    void fetchLyricsCached(media.title, media.artist, media.duration_seconds).then((payload) => {
      if (!active) return;
      setIdleSyncedLyrics(payload?.syncedLyrics ? parseLrc(payload.syncedLyrics) : []);
    });
    return () => {
      active = false;
    };
  }, [sysData.media?.title, sysData.media?.artist, sysData.media?.duration_seconds]);

  useEffect(() => {
    setIdleMediaPosition(sysData.media?.position_seconds ?? 0);
  }, [sysData.media?.position_seconds, sysData.media?.title, sysData.media?.artist]);

  useEffect(() => {
    if (!sysData.media?.is_playing || idleSyncedLyrics.length === 0) return;
    const duration = sysData.media.duration_seconds;
    const timer = window.setInterval(() => {
      setIdleMediaPosition((pos) => (duration > 0 ? Math.min(duration, pos + 0.4) : pos + 0.4));
    }, 400);
    return () => window.clearInterval(timer);
  }, [sysData.media?.is_playing, sysData.media?.duration_seconds, idleSyncedLyrics.length]);

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | null = null;
    void listen('tray-open-settings', () => {
      if (autoNoticeTimer.current) clearTimeout(autoNoticeTimer.current);
      autoNoticeTimer.current = null;
      if (closeDelayTimer.current) clearTimeout(closeDelayTimer.current);
      closeDelayTimer.current = null;
      islandModeRef.current = 'tools';
      setIslandMode('tools');
      setOpenSettingsRequest((request) => request + 1);
    }).then((stopListening) => {
      if (active) unlisten = stopListening;
      else stopListening();
    }).catch((error: unknown) => {
      console.error('Gagal memasang listener pengaturan system tray:', error);
    });
    return () => {
      active = false;
      unlisten?.();
    };
  }, []);

  useEffect(() => saveAppSetting('di-language', language), [language]);
  useEffect(() => saveWindhawkSettings(windhawkSettings), [windhawkSettings]);
  useEffect(() => saveLayoutSettings(layoutSettings), [layoutSettings]);
  useEffect(() => saveAppSetting('di-pin-media', mediaPinned), [mediaPinned]);
  useEffect(() => saveAppSetting('di-pin-monitor', monitorPinned), [monitorPinned]);
  useEffect(() => saveAppSetting('di-show-lyrics', showLyrics), [showLyrics]);

  useEffect(() => {
    const intervalMs = windhawkSettings.appearance.showSeconds ? 1_000 : 15_000;
    const timer = window.setInterval(() => setTime(new Date()), intervalMs);
    return () => window.clearInterval(timer);
  }, [windhawkSettings.appearance.showSeconds]);

  useEffect(() => {
    if (windhawkSettings.appearance.idleStyle !== 'ticker') return;
    const timer = window.setInterval(() => {
      setTickerIndex((current) => (current + 1) % 3);
    }, 6_000);
    return () => window.clearInterval(timer);
  }, [windhawkSettings.appearance.idleStyle]);

  const selectedMonitorIndex = windhawkSettings.appearance.monitorIndex >= 0
    ? windhawkSettings.appearance.monitorIndex
    : null;

  useEffect(() => {
    let active = true;
    const resolveMonitor = async () => {
      if (selectedMonitorIndex !== null) {
        const monitors = await availableMonitors();
        if (monitors[selectedMonitorIndex]) {
          return monitors[selectedMonitorIndex];
        }
      }
      return currentMonitor();
    };
    void resolveMonitor()
      .then((monitor) => {
        if (!active || !monitor) return;
        const size = monitor.size.toLogical(monitor.scaleFactor);
        setViewport({ width: size.width, height: size.height });
      })
      .catch((error: unknown) => {
        console.error('Gagal membaca ukuran monitor Dynamic Island:', error);
      });
    return () => {
      active = false;
    };
  }, [selectedMonitorIndex]);

  useEffect(() => saveAppSetting('di-island-position', islandPosition), [islandPosition]);

  useEffect(() => {
    let active = true;
    void invoke<BatteryInfo>('get_battery_info')
      .then((battery) => {
        if (!active) return;
        setSysData((current) => ({
          ...current,
          battery: battery.percentage,
          batteryState: battery.state,
          batteryError: null
        }));
      })
      .catch((error: unknown) => {
        if (!active) return;
        setSysData((current) => ({
          ...current,
          battery: null,
          batteryState: 'Unknown',
          batteryError: error instanceof Error ? error.message : String(error)
        }));
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const unlistenSystem = listen<SysData>('system-update', (event) => {
      const current = event.payload;
      const previous = previousSystemDataRef.current;
      const moduleSettings = activityModuleSettingsRef.current;
      if (previous) {
        const mediaChanged = previous.media?.title !== current.media?.title
          || previous.media?.artist !== current.media?.artist
          || previous.media?.source_app !== current.media?.source_app
          || previous.media?.is_playing !== current.media?.is_playing;

        if (mediaChanged && current.media?.is_playing) {
          showAutoNotice({
            kind: 'media',
            title: current.media.title || 'Now Playing',
            body: '',
            media: current.media
          });
        } else {
          if (mediaChanged && autoNoticeRef.current?.kind === 'media') {
            clearAutoNotice();
          }

          const activityChanges: string[] = [];
          if (moduleSettings.capsLock && previous.capsLock !== current.capsLock) activityChanges.push(`Caps Lock ${current.capsLock ? 'On' : 'Off'}`);
          if (moduleSettings.numLock && previous.numLock !== current.numLock) activityChanges.push(`Num Lock ${current.numLock ? 'On' : 'Off'}`);
          if (moduleSettings.scrollLock && previous.scrollLock !== current.scrollLock) activityChanges.push(`Scroll Lock ${current.scrollLock ? 'On' : 'Off'}`);
          if (moduleSettings.microphone && previous.microphoneMuted !== current.microphoneMuted) activityChanges.push(`Microphone ${current.microphoneMuted ? 'Muted' : 'On'}`);
          if (moduleSettings.speaker && previous.outputMuted !== current.outputMuted) activityChanges.push(`Speaker ${current.outputMuted ? 'Muted' : 'On'}`);
          const volumeChanged = Math.abs(previous.volume - current.volume) >= 1;
          if (moduleSettings.volume && volumeChanged) activityChanges.push(`Volume ${Math.round(current.volume)}%`);

          if (activityChanges.length) {
            showAutoNotice({
              kind: 'activity',
              title: 'Windows Activity',
              body: activityChanges.join(' · '),
              volumeLevel: moduleSettings.volume && volumeChanged ? current.volume : undefined,
              previousVolumeLevel: moduleSettings.volume && volumeChanged ? previous.volume : undefined
            });
          }
        }
      } else if (current.media?.is_playing) {
        showAutoNotice({
          kind: 'media',
          title: current.media.title || 'Now Playing',
          body: '',
          media: current.media
        });
      }

      if (!current.media && islandModeRef.current === 'mediaDetail') {
        islandModeRef.current = 'idle';
        setIslandMode('idle');
        setShowLyrics(false);
      }
      previousSystemDataRef.current = current;
      setSysData(current);
    });
    return () => { unlistenSystem.then((f) => f()); };
  }, []);

  useEffect(() => {
    const unlistenClipboard = listen<string>('clipboard-activity', (event) => {
      if (!activityModuleSettingsRef.current.clipboard) return;
      const labels: Record<string, string> = {
        copied: 'Copied', cut: 'Cut', pasted: 'Pasted', 'clipboard-updated': 'Clipboard updated'
      };
      const activity = labels[event.payload] ?? 'Clipboard activity';
      showAutoNotice({ kind: 'activity', title: 'Windows Activity', body: activity });
    });
    return () => { unlistenClipboard.then((f) => f()); };
  }, []);

  useEffect(() => {
    const unlistenHistory = listen<ClipboardHistoryItem>('clipboard-history-item', (event) => {
      setClipboardItems((items) => [
        { text: event.payload.text, timestamp: Number(event.payload.timestamp) },
        ...items.filter((item) => item.text !== event.payload.text)
      ].slice(0, 50));
    });
    return () => { unlistenHistory.then((f) => f()); };
  }, []);

  useEffect(() => {
    let unlistenDrop: (() => void) | undefined;
    void getCurrentWindow().onDragDropEvent((event) => {
      const payload = event.payload;
      if (payload.type !== 'drop') return;
      setShelfPaths((items) => [...new Set([...payload.paths, ...items])].slice(0, 30));
      if (islandModeRef.current === 'idle') openLauncher();
    }).then((unlisten) => { unlistenDrop = unlisten; });
    return () => { unlistenDrop?.(); };
  }, []);

  useEffect(() => saveAppSetting('di-clipboard-history', clipboardItems), [clipboardItems]);
  useEffect(() => saveAppSetting('di-file-shelf', shelfPaths), [shelfPaths]);
  useEffect(() => saveAppSetting('di-windows-activity-modules', activityModuleSettings), [activityModuleSettings]);
  useEffect(() => saveAppSetting('di-windows-notification-notices', windowsNotificationNotices), [windowsNotificationNotices]);
  useEffect(() => saveAppSetting('di-notification-app-filters', notificationAppFilters), [notificationAppFilters]);

  useEffect(() => {
    let active = true;
    let unlistenSystemNotification: (() => void) | undefined;
    void listen<AutoNotice>('system-notification', (event) => {
      const notice = event.payload;
      if (notice.kind === 'notification') {
        const appName = notice.appName?.trim();
        if (appName) {
          const filters = notificationAppFiltersRef.current;
          const matchedEntry = Object.entries(filters).find(
            ([key]) => key.toLowerCase() === appName.toLowerCase() || appName.toLowerCase().includes(key.toLowerCase())
          );
          if (!matchedEntry) {
            setNotificationAppFilters((current) => (
              appName in current ? current : { ...current, [appName]: true }
            ));
          }
          if (windowsNotificationNoticesRef.current && matchedEntry?.[1] !== false) {
            showAutoNotice(notice);
          }
          return;
        }
        if (windowsNotificationNoticesRef.current) showAutoNotice(notice);
        return;
      }

      const content = `${notice.title} ${notice.body}`.toLowerCase();
      const module: ActivityModule | null = content.includes('wi-fi') || content.includes('wifi')
        ? 'wifi'
        : content.includes('brightness')
          ? 'brightness'
          : content.includes('power connected') || content.includes('power disconnected')
            ? 'power'
            : content.includes('battery')
              ? 'battery'
              : null;
      if (module && activityModuleSettingsRef.current[module]) showAutoNotice(notice);
    })
      .then((unlisten) => {
        if (active) unlistenSystemNotification = unlisten;
        else unlisten();
      });
    return () => {
      active = false;
      unlistenSystemNotification?.();
    };
  }, []);

  useEffect(() => {
    if (!windowsNotificationNotices) return;
    void invoke<string>('request_windows_notification_access').catch((error) => {
      console.warn('Windows notification access is unavailable:', error);
    });
  }, [windowsNotificationNotices]);

  useEffect(() => () => {
    if (autoNoticeTimer.current) clearTimeout(autoNoticeTimer.current);
    if (closeDelayTimer.current) clearTimeout(closeDelayTimer.current);
  }, []);

  const handleMediaAction = async (action: 'previous' | 'playPause' | 'next') => {
    if (action === 'playPause') {
      setSysData((current) => (
        current.media
          ? { ...current, media: { ...current.media, is_playing: !current.media.is_playing } }
          : current
      ));
    }
    try {
      await invoke('control_media', { action });
    } catch (error) {
      console.error('Gagal mengontrol media:', error);
    }
  };

  const openTools = () => {
    if (islandModeRef.current !== 'launcher') return;
    if (autoNoticeTimer.current) clearTimeout(autoNoticeTimer.current);
    autoNoticeTimer.current = null;
    if (closeDelayTimer.current) clearTimeout(closeDelayTimer.current);
    closeDelayTimer.current = null;
    islandModeRef.current = 'tools';
    setIslandMode('tools');
  };

  const openLauncher = () => {
    if (islandModeRef.current !== 'idle') return;
    if (autoNoticeTimer.current) clearTimeout(autoNoticeTimer.current);
    autoNoticeTimer.current = null;
    islandModeRef.current = 'launcher';
    setIslandMode('launcher');
  };

  const returnToLauncher = () => {
    if (islandModeRef.current === 'idle' || islandModeRef.current === 'autoNotice') return;
    islandModeRef.current = 'launcher';
    setIslandMode('launcher');
  };

  const handleToolNotice = useCallback((title: string, body: string) => {
    showAutoNotice({ kind: 'system', title, body }, { allowOverTools: true });
  }, []);

  const openMediaDetail = () => {
    if (!sysData.media || (islandModeRef.current !== 'launcher' && islandModeRef.current !== 'idle')) return;
    if (autoNoticeTimer.current) clearTimeout(autoNoticeTimer.current);
    autoNoticeTimer.current = null;
    autoNoticeRef.current = null;
    setAutoNotice(null);
    islandModeRef.current = 'mediaDetail';
    setIslandMode('mediaDetail');
  };

  const openSystemMonitor = () => {
    if (islandModeRef.current !== 'launcher' && islandModeRef.current !== 'idle') return;
    islandModeRef.current = 'systemMonitor';
    setIslandMode('systemMonitor');
  };

  const clearAutoNotice = () => {
    if (autoNoticeTimer.current) clearTimeout(autoNoticeTimer.current);
    autoNoticeTimer.current = null;
    autoNoticeQueue.current = [];
    autoNoticeRef.current = null;
    setAutoNotice(null);
    if (islandModeRef.current === 'autoNotice') {
      islandModeRef.current = 'idle';
      setIslandMode('idle');
    }
  };

  const showNextAutoNotice = (notice: AutoNotice) => {
    autoNoticeRef.current = notice;
    setAutoNotice(notice);
    islandModeRef.current = 'autoNotice';
    setIslandMode('autoNotice');

    autoNoticeTimer.current = setTimeout(() => {
      autoNoticeTimer.current = null;
      const nextNotice = autoNoticeQueue.current.shift();
      if (nextNotice) {
        showNextAutoNotice(nextNotice);
      } else {
        clearAutoNotice();
      }
    }, noticeDurationMsRef.current);
  };

  const showAutoNotice = (
    notice: AutoNotice,
    options?: { allowOverTools?: boolean; replaceActive?: boolean }
  ) => {
    const mode = islandModeRef.current;
    if (mode !== 'idle' && mode !== 'autoNotice' && !(options?.allowOverTools && mode === 'tools')) return;

    const queuedNotices = autoNoticeQueue.current;
    const lastNotice = queuedNotices[queuedNotices.length - 1] ?? autoNoticeRef.current;
    if (
      !options?.replaceActive
      && lastNotice?.kind === notice.kind
      && lastNotice.title === notice.title
      && lastNotice.body === notice.body
    ) return;

    if (mode === 'autoNotice') {
      if (options?.replaceActive && autoNoticeRef.current?.kind === notice.kind) {
        if (autoNoticeTimer.current) clearTimeout(autoNoticeTimer.current);
        autoNoticeTimer.current = null;
        showNextAutoNotice(notice);
        return;
      }
      autoNoticeQueue.current.push(notice);
      return;
    }

    if (autoNoticeTimer.current) clearTimeout(autoNoticeTimer.current);
    autoNoticeTimer.current = null;
    showNextAutoNotice(notice);
  };

  const closeIsland = async () => {
    if (closeDelayTimer.current) clearTimeout(closeDelayTimer.current);
    closeDelayTimer.current = null;
    if (autoNoticeTimer.current) clearTimeout(autoNoticeTimer.current);
    autoNoticeTimer.current = null;
    autoNoticeQueue.current = [];
    autoNoticeRef.current = null;
    islandModeRef.current = 'idle';
    setAutoNotice(null);
    setIslandMode('idle');
  };

  const lockWindows = async () => {
    await closeIsland();
    try {
      await invoke('lock_windows');
    } catch (error) {
      console.error('Gagal mengunci Windows:', error);
      showAutoNotice({
        kind: 'system',
        title: 'Gagal mengunci Windows',
        body: error instanceof Error ? error.message : String(error)
      });
    }
  };

  const runCaptureAction = async (command: string, errorTitle: string) => {
    await closeIsland();
    try {
      await invoke(command);
    } catch (error) {
      console.error(`${errorTitle}:`, error);
      showAutoNotice({
        kind: 'system',
        title: errorTitle,
        body: error instanceof Error ? error.message : String(error)
      });
    }
  };

  const openToolsTab = (targetTab: ToolTabId) => {
    if (autoNoticeTimer.current) clearTimeout(autoNoticeTimer.current);
    autoNoticeTimer.current = null;
    if (closeDelayTimer.current) clearTimeout(closeDelayTimer.current);
    closeDelayTimer.current = null;
    islandModeRef.current = 'tools';
    setIslandMode('tools');
    setOpenTabRequest((current) => ({ tab: targetTab, seq: (current?.seq ?? 0) + 1 }));
  };

  const openCustomShortcut = async (target: string) => {
    const cleaned = target.trim();
    if (!cleaned) return;
    await closeIsland();
    try {
      if (/^https?:\/\//i.test(cleaned)) {
        await openUrl(cleaned);
      } else {
        await openPath(cleaned);
      }
    } catch (error) {
      showAutoNotice({
        kind: 'system',
        title: localize(language, 'Gagal membuka pintasan', 'Failed to open shortcut'),
        body: error instanceof Error ? error.message : String(error)
      });
    }
  };

  const openSnippingTool = () => runCaptureAction('open_snipping_tool', 'Gagal membuka Snipping Tool');
  const takeScreenshot = () => runCaptureAction('take_screenshot', 'Gagal mengambil screenshot');

  const locale = language === 'id' ? 'id-ID' : 'en-US';
  const formattedTime = time.toLocaleTimeString(locale, {
    hour: '2-digit',
    minute: '2-digit',
    ...(windhawkSettings.appearance.showSeconds ? { second: '2-digit' } : {}),
    hour12: windhawkSettings.appearance.clockFormat === '12h'
  });
  const formattedDate = windhawkSettings.appearance.dateFormat === 'numeric'
    ? time.toLocaleDateString(locale, { day: '2-digit', month: '2-digit' })
    : windhawkSettings.appearance.dateFormat === 'full'
      ? time.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })
      : time.toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' });
  const batteryAvailable = sysData.battery !== null;
  const batteryLevel = Math.max(0, Math.min(sysData.battery ?? 0, 100));
  const batteryColor = !batteryAvailable
    ? '#8993a0'
    : sysData.batteryState === 'Charging'
    ? '#65c9a5'
    : batteryLevel <= 15
      ? '#f87171'
      : batteryLevel <= 30
        ? '#fbbf24'
        : '#a3d977';
  const mediaProvider = sysData.media ? getMediaProvider(sysData.media.source_app) : null;
  const noticeArtwork = autoNotice?.media
    && autoNotice.media.title === sysData.media?.title
    && autoNotice.media.source_app === sysData.media?.source_app
    ? mediaArtwork
    : null;
  const isSidePosition = islandPosition !== 0;
  const customPanelWidth = Number.isFinite(windhawkSettings.appearance.panelWidth)
    ? Math.min(560, Math.max(300, windhawkSettings.appearance.panelWidth))
    : 368;
  const customPanelHeight = Number.isFinite(windhawkSettings.appearance.panelHeight)
    ? Math.min(520, Math.max(240, windhawkSettings.appearance.panelHeight))
    : 332;
  const topPanelWidth = Math.max(0, Math.min(customPanelWidth, viewport.width - 24));
  const sideWidth = Math.max(0, Math.min(Math.round(customPanelWidth * 0.7), Math.max(210, viewport.width * 0.22), viewport.width - 24));
  const sideHeight = Math.max(0, Math.min(Math.round(customPanelHeight * 1.22), viewport.height - 24));
  const hasPinnedIdleContent = mediaPinned || monitorPinned;
  const isIdleVisible = (id: 'pet' | 'privacy' | 'live' | 'clock' | 'date' | 'battery') =>
    layoutSettings.idleWidgets.some((widget) => widget.id === id && widget.visible);
  const showClock = isIdleVisible('clock');
  const showDate = isIdleVisible('date');
  const showBattery = isIdleVisible('battery');
  const showPetWidget = isIdleVisible('pet') && windhawkSettings.appearance.petStyle !== 'none';
  const hasPrivacyAlert = isIdleVisible('privacy') && Boolean(sysData.cameraActive || sysData.micInUse);
  const privacyExtraWidth = hasPrivacyAlert ? (sysData.cameraActive && sysData.micInUse ? 34 : 20) : 0;
  const liveExtraWidth = (isIdleVisible('live')
    ? (sysData.activeDownload ? 56 : 0) + (sysData.bluetoothDevice ? 46 : 0)
    : 0) + (focusLive.running ? 68 : 0);
  const focusProgress = focusLive.totalSeconds > 0
    ? Math.max(0, Math.min(100, ((focusLive.totalSeconds - focusLive.remainingSeconds) / focusLive.totalSeconds) * 100))
    : 0;
  const focusFormatted = `${String(Math.floor(focusLive.remainingSeconds / 60)).padStart(2, '0')}:${String(focusLive.remainingSeconds % 60).padStart(2, '0')}`;
  const visibleLauncherCount = Math.max(
    1,
    layoutSettings.launcherItems.filter((item) => item.visible).length + layoutSettings.customShortcuts.length
  );
  const launcherRows = Math.ceil(visibleLauncherCount / Math.min(layoutSettings.launcherColumns, visibleLauncherCount));
  const topLauncherHeight = launcherRows * 48 + 14;
  const dynamicSideLauncherHeight = Math.min(sideHeight, Math.max(110, visibleLauncherCount * 48 + 18));
  const baseIdleWidth = (showClock ? (windhawkSettings.appearance.showSeconds ? 92 : 72) : 0)
    + (showDate ? (windhawkSettings.appearance.dateFormat === 'full' ? 84 : 64) : 0)
    + (showBattery ? 58 : 0)
    + (showPetWidget ? 30 : 0)
    + (!showClock && !showDate ? 34 : 0)
    + 18;
  const activeIdleLyricIndex = sysData.media?.is_playing
    ? getActiveLyricIndex(idleSyncedLyrics, idleMediaPosition)
    : -1;
  const activeIdleLyric = activeIdleLyricIndex >= 0 ? idleSyncedLyrics[activeIdleLyricIndex]?.text ?? '' : '';
  const idleLyricDisplayText = activeIdleLyric || sysData.media?.title || localize(language, 'Sedang diputar', 'Now playing');
  const shouldMarqueeIdleLyric = idleLyricDisplayText.length > 24;
  const showIdleLyricPill = !mediaPinned && showLyrics && Boolean(sysData.media?.is_playing);
  const showTopIdleLyric = !isSidePosition && showIdleLyricPill;
  const showSideIdleLyric = isSidePosition && showIdleLyricPill;
  const idleMediaProgress = sysData.media && sysData.media.duration_seconds > 0
    ? Math.max(0, Math.min(100, (idleMediaPosition / sysData.media.duration_seconds) * 100))
    : 0;
  const idleStyle = windhawkSettings.appearance.idleStyle;
  const isStealthCollapsed = islandMode === 'idle' && idleStyle === 'stealth' && !idleHovered;
  const isDualIdle = islandMode === 'idle' && idleStyle === 'dual';
  const isHudIdle = idleStyle === 'hud';
  const isVinylIdle = idleStyle === 'vinyl';
  const showPrayerPill = idleStyle === 'prayer' && !isStealthCollapsed;
  const showTickerPill = idleStyle === 'ticker' && !isStealthCollapsed && !mediaPinned && !showIdleLyricPill;

  const greetingText = (() => {
    const h = time.getHours();
    if (h < 11) return localize(language, 'Selamat pagi', 'Good morning');
    if (h < 15) return localize(language, 'Selamat siang', 'Good afternoon');
    if (h < 18) return localize(language, 'Selamat sore', 'Good evening');
    return localize(language, 'Selamat malam', 'Good night');
  })();
  const tickerItems = [
    greetingText,
    nextPrayerLabel
      ? `🕌 ${nextPrayerLabel}`
      : focusLive.running
        ? `⏱ ${focusFormatted}`
        : `${localize(language, 'Baterai', 'Battery')} ${batteryAvailable ? `${Math.round(batteryLevel)}%` : '—'}`,
    sysData.isWifiConnected
      ? `Wi-Fi · ${sysData.activeWifiName || 'Online'}`
      : localize(language, 'Mode offline', 'Offline mode')
  ];
  const activeTickerText = tickerItems[tickerIndex % tickerItems.length];

  const topIdleMaxWidth = Math.min(viewport.width - 24, Math.max(topPanelWidth, 560));
  const extraModeTopWidth = (showPrayerPill ? 114 : 0) + (showTickerPill ? 132 : 0) + (isDualIdle ? 18 : 0);

  const idleWidth = isStealthCollapsed
    ? (isSidePosition ? 40 : 104)
    : isHudIdle
      ? (isSidePosition ? Math.min(sideWidth, 82) : Math.min(topIdleMaxWidth, 344))
      : isSidePosition
        ? Math.min(sideWidth, hasPinnedIdleContent ? 88 : showSideIdleLyric ? 84 : (showPrayerPill || showTickerPill) ? 74 : 48)
        : hasPinnedIdleContent
          ? Math.min(topIdleMaxWidth, (mediaPinned && monitorPinned ? 544 : mediaPinned ? 476 : 348) + (showPrayerPill ? 104 : 0) + (isDualIdle ? 18 : 0))
          : showTopIdleLyric
            ? Math.min(topIdleMaxWidth, 468 + (showPrayerPill ? 104 : 0) + (isDualIdle ? 18 : 0))
            : Math.min(topIdleMaxWidth, Math.max(96, baseIdleWidth) + privacyExtraWidth + liveExtraWidth + extraModeTopWidth);
  const sideFocusExtraHeight = isSidePosition && focusLive.running ? 34 : 0;
  const sideModeExtraHeight = isSidePosition && (showPrayerPill || showTickerPill) ? 34 : 0;
  const idleHeight = isStealthCollapsed
    ? (isSidePosition ? 68 : 28)
    : isHudIdle
      ? (isSidePosition ? Math.min(sideHeight, 178) : 38)
      : isSidePosition
        ? Math.min(
          sideHeight,
          (monitorPinned ? (mediaPinned ? 348 : 236) : mediaPinned ? 236 : showSideIdleLyric ? 248 : 118)
            + sideFocusExtraHeight
            + sideModeExtraHeight
        )
        : monitorPinned ? 48 : (mediaPinned || showTopIdleLyric) ? 48 : 38;

  const edgeOffset = Number.isFinite(windhawkSettings.appearance.edgeOffset)
    ? Math.min(48, Math.max(0, windhawkSettings.appearance.edgeOffset))
    : 0;
  const isFloatingFromEdge = edgeOffset > 0;
  const islandVariants = {
    idle: {
      height: idleHeight,
      width: idleWidth,
      borderTopLeftRadius: !isFloatingFromEdge && (islandPosition === 1 || islandPosition === 0) ? 0 : 12,
      borderTopRightRadius: !isFloatingFromEdge && (islandPosition === 2 || islandPosition === 0) ? 0 : 12,
      borderBottomLeftRadius: !isFloatingFromEdge && islandPosition === 1 ? 0 : 12,
      borderBottomRightRadius: !isFloatingFromEdge && islandPosition === 2 ? 0 : 12,
    },
    launcher: {
      width: isSidePosition ? Math.min(136, sideWidth) : Math.min(348, topPanelWidth),
      height: isSidePosition ? dynamicSideLauncherHeight : topLauncherHeight,
      borderRadius: 14,
    },
    autoNotice: {
      width: isSidePosition ? Math.min(232, sideWidth) : Math.min(316, topPanelWidth),
      height: isSidePosition
        ? (autoNotice?.volumeLevel !== undefined ? Math.min(126, sideHeight) : Math.min(104, sideHeight))
        : (autoNotice?.volumeLevel !== undefined ? 64 : 54),
      borderRadius: 14,
    },
    mediaDetail: {
      width: isSidePosition ? Math.min(234, sideWidth) : Math.min(332, topPanelWidth),
      height: isSidePosition
        ? Math.min(showLyrics ? 236 : 150, sideHeight)
        : (showLyrics ? 210 : 128),
      borderRadius: 16,
    },
    systemMonitor: {
      width: isSidePosition ? Math.min(238, sideWidth) : Math.min(332, topPanelWidth),
      height: isSidePosition ? Math.min(296, sideHeight) : 232,
      borderRadius: 16,
    },
    tools: {
      width: isSidePosition ? sideWidth : topPanelWidth,
      height: isSidePosition ? sideHeight : Math.min(customPanelHeight, viewport.height - 24),
      borderRadius: 16,
    }
  };

  const animSpeed = windhawkSettings.appearance.animationSpeed;
  const panelTransition: Transition = animSpeed === 'off'
    ? { duration: 0.01 }
    : animSpeed === 'snappy'
      ? { type: 'spring', stiffness: 460, damping: 34, mass: 0.75 }
      : animSpeed === 'smooth'
        ? { type: 'spring', stiffness: 220, damping: 26, mass: 0.9 }
        : { type: 'spring', stiffness: 340, damping: 30, mass: 0.8 };
  const sideTravel = islandPosition === 1 ? -7 : islandPosition === 2 ? 7 : 0;
  const verticalTravel = islandPosition === 0 ? -6 : 0;
  const pillOpacity = Number.isFinite(windhawkSettings.themes.pillOpacity)
    ? Math.min(100, Math.max(35, windhawkSettings.themes.pillOpacity))
    : 100;
  const effectiveScale = Number(windhawkSettings.appearance.sizeScale) * windhawkSettings.themes.textScale / 100;
  const activeVariant = islandVariants[islandMode];
  const targetWindowWidth = Math.max(1, Math.ceil(activeVariant.width * effectiveScale));
  const targetWindowHeight = Math.max(1, Math.ceil(activeVariant.height * effectiveScale));

  useEffect(() => {
    void invoke('set_auto_hide_fullscreen', {
      enabled: windhawkSettings.appearance.autoHideFullscreen
    }).catch((error: unknown) => {
      console.error('Gagal mengatur auto-hide fullscreen:', error);
    });
  }, [windhawkSettings.appearance.autoHideFullscreen]);

  useEffect(() => {
    void invoke('set_click_through_mode', {
      mode: windhawkSettings.appearance.clickThroughMode
    }).catch((error: unknown) => {
      console.error('Gagal mengatur mode tembus klik:', error);
    });
  }, [windhawkSettings.appearance.clickThroughMode]);

  useEffect(() => {
    void invoke('set_island_idle_state', {
      isIdle: islandMode === 'idle'
    }).catch((error: unknown) => {
      console.error('Gagal menyinkronkan status idle island:', error);
    });
  }, [islandMode]);

  useEffect(() => {
    let active = true;
    let unlistenState: (() => void) | null = null;
    let unlistenMode: (() => void) | null = null;
    void listen<boolean>('click-through-state', (event) => {
      if (active) setClickThroughActive(Boolean(event.payload));
    }).then((stop) => {
      if (active) unlistenState = stop;
      else stop();
    }).catch(() => {});
    void listen<string>('click-through-mode-changed', (event) => {
      if (!active) return;
      const next = event.payload as ClickThroughMode;
      if (next !== 'off' && next !== 'always' && next !== 'hold-alt-pass' && next !== 'hold-alt-interact') return;
      setWindhawkSettings((current) => ({
        ...current,
        appearance: { ...current.appearance, clickThroughMode: next }
      }));
    }).then((stop) => {
      if (active) unlistenMode = stop;
      else stop();
    }).catch(() => {});
    return () => {
      active = false;
      unlistenState?.();
      unlistenMode?.();
    };
  }, []);

  useEffect(() => {
    void invoke('set_island_window_bounds', {
      width: targetWindowWidth,
      height: targetWindowHeight,
      position: islandPosition,
      edgeOffset,
      monitorIndex: selectedMonitorIndex
    }).catch((error: unknown) => {
      console.error('Gagal memposisikan jendela Dynamic Island:', error);
    });
  }, [targetWindowWidth, targetWindowHeight, islandPosition, edgeOffset, selectedMonitorIndex]);

  const handleIdleWheel = (event: React.WheelEvent) => {
    if (islandModeRef.current !== 'idle' && islandModeRef.current !== 'autoNotice') return;
    if (!windhawkSettings.appearance.scrollControlEnabled) return;
    if (event.deltaY === 0) return;
    const now = Date.now();
    if (now - lastWheelAtRef.current < 85) return;
    lastWheelAtRef.current = now;
    const step = event.deltaY < 0 ? 4 : -4;

    if (event.shiftKey) {
      const applyBrightness = (base: number) => {
        const next = Math.max(5, Math.min(100, Math.round(base + step)));
        brightnessCacheRef.current = next;
        void invoke('set_display_brightness', { level: next }).catch((error) => {
          console.warn('Gagal mengatur kecerahan via scroll:', error);
        });
        showAutoNotice(
          {
            kind: 'activity',
            title: localize(language, 'Kecerahan', 'Brightness'),
            body: `${next}%`
          },
          { replaceActive: true }
        );
      };
      if (brightnessCacheRef.current !== null) {
        applyBrightness(brightnessCacheRef.current);
      } else {
        void invoke<number>('get_display_brightness')
          .then((current) => applyBrightness(current))
          .catch(() => applyBrightness(65));
      }
      return;
    }

    const previousVolume = Number.isFinite(sysData.volume) ? sysData.volume : 50;
    const nextVolume = Math.max(0, Math.min(100, Math.round(previousVolume + step)));
    setSysData((current) => ({ ...current, volume: nextVolume }));
    if (previousSystemDataRef.current) {
      previousSystemDataRef.current = {
        ...previousSystemDataRef.current,
        volume: nextVolume
      };
    }
    void invoke('set_system_volume', { volume: nextVolume }).catch((error) => {
      console.warn('Gagal mengatur volume via scroll:', error);
    });
    showAutoNotice(
      {
        kind: 'activity',
        title: 'Windows Activity',
        body: `Volume ${nextVolume}%`,
        volumeLevel: nextVolume,
        previousVolumeLevel: previousVolume
      },
      { replaceActive: true }
    );
  };

  const hasTextColorOverride = Boolean(windhawkSettings.themes.textColorOverride.trim());
  const hasGradientBg = windhawkSettings.themes.bgGradientEnabled;
  const hasBorderGlow = windhawkSettings.themes.borderGlowEnabled;
  const hasMusicGlow = windhawkSettings.themes.musicReactiveGlow && Boolean(sysData.media?.is_playing);
  const islandStyle: IslandStyle = {
    width: activeVariant.width,
    height: activeVariant.height,
    zoom: effectiveScale,
    fontFamily: windhawkSettings.themes.fontFamily || undefined,
    '--island-pill-opacity': String(pillOpacity / 100),
    '--island-bg-gradient-to': windhawkSettings.themes.bgGradientTo,
    '--island-glow-color': windhawkSettings.themes.borderGlowColor,
    ...(hasTextColorOverride ? {
      '--island-text-override': windhawkSettings.themes.textColorOverride
    } : {}),
    ...(windhawkSettings.themes.themePreset === 'custom' ? {
      '--island-custom-theme-bg': windhawkSettings.themes.pillBgColor,
      '--island-custom-theme-border': windhawkSettings.themes.contourBorderHex,
      '--island-custom-theme-text': windhawkSettings.themes.textPrimaryColor
    } : {})
  };

  return (
    <LazyMotion features={domMax}>
    <div className="w-screen h-screen flex items-start justify-start overflow-hidden box-border select-none">
      <div
        className={`island-shell${hasTextColorOverride ? ' island-shell--custom-text' : ''}${hasGradientBg ? ' island-shell--gradient' : ''}${hasBorderGlow ? ' island-shell--glow' : ''}${hasMusicGlow ? ' island-shell--music-glow' : ''}${focusLive.running ? ` island-shell--focus-aura${focusLive.isBreak ? ' is-break' : ''}` : ''}${clickThroughActive ? ' island-shell--click-through' : ''}${isDualIdle ? ' island-shell--dual-idle' : ''}${isStealthCollapsed ? ' island-shell--stealth' : ''}${animSpeed === 'off' ? ' island-anim-off' : ''} border overflow-hidden cursor-pointer flex items-center justify-center relative pointer-events-auto island-position-${islandPosition === 0 ? 'top-center' : islandPosition === 1 ? 'left-center' : 'right-center'} island-shape-${windhawkSettings.appearance.shapeStyle} island-theme-${windhawkSettings.themes.themePreset}`}
        style={{
          ...islandStyle,
          ...('borderRadius' in activeVariant
            ? { borderRadius: activeVariant.borderRadius }
            : {
                borderTopLeftRadius: activeVariant.borderTopLeftRadius,
                borderTopRightRadius: activeVariant.borderTopRightRadius,
                borderBottomLeftRadius: activeVariant.borderBottomLeftRadius,
                borderBottomRightRadius: activeVariant.borderBottomRightRadius
              })
        }}
        onWheel={handleIdleWheel}
        onPointerEnter={() => {
          setIdleHovered(true);
          if (closeDelayTimer.current) clearTimeout(closeDelayTimer.current);
          closeDelayTimer.current = null;
        }}
        onPointerLeave={() => {
          setIdleHovered(false);
          if (islandModeRef.current === 'idle' || islandModeRef.current === 'tools' || islandModeRef.current === 'systemMonitor') return;
          if (closeDelayTimer.current) clearTimeout(closeDelayTimer.current);
          closeDelayTimer.current = window.setTimeout(() => {
            closeDelayTimer.current = null;
            if (islandModeRef.current !== 'idle') void closeIsland();
          }, 2000);
        }}
      >
        <AnimatePresence mode="wait" initial={false}>

          {islandMode === 'autoNotice' && autoNotice && (
            <AutoNoticeCard
              notice={autoNotice}
              language={language}
              artwork={noticeArtwork}
              travelX={sideTravel}
              travelY={verticalTravel}
              transition={panelTransition}
              onDismiss={() => { void closeIsland(); }}
            />
          )}
          
          {/* ============================== */}
          {/* MODE 1: IDLE */}
          {/* ============================== */}
          {islandMode === 'idle' && (
            <m.div
              key="idle"
              className={`island-idle${isSidePosition ? ' island-idle--side' : ' island-idle--top'}${hasPinnedIdleContent ? ' island-idle--pinned' : ''}${isVinylIdle ? ' island-idle--vinyl' : ''}${isDualIdle ? ' island-idle--dual' : ''}${isHudIdle ? ' island-idle--hud' : ''}`}
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.99 }}
              transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
            >
              {isStealthCollapsed ? (
                <button
                  type="button"
                  className={`idle-stealth${isSidePosition ? ' idle-stealth--side' : ''}`}
                  onClick={openLauncher}
                  aria-label={localize(language, 'Buka menu', 'Open menu')}
                >
                  <span className="idle-stealth__clock">
                    {isSidePosition
                      ? (
                        <>
                          <span>{String(time.getHours()).padStart(2, '0')}</span>
                          <span>{String(time.getMinutes()).padStart(2, '0')}</span>
                        </>
                      )
                      : formattedTime.replace('.', ':')}
                  </span>
                  <span className="idle-stealth__dots" aria-hidden="true">
                    {sysData.media?.is_playing && <i className="is-music" />}
                    {focusLive.running && <i className="is-focus" />}
                    {hasPrivacyAlert && <i className="is-privacy" />}
                    {!sysData.media?.is_playing && !focusLive.running && !hasPrivacyAlert && (
                      <i className="is-idle" style={{ background: batteryColor }} />
                    )}
                  </span>
                </button>
              ) : isHudIdle ? (
                <div className={`idle-hud${isSidePosition ? ' idle-hud--side' : ''}`}>
                  <button type="button" className="idle-hud__clock" onClick={openLauncher}>
                    {isSidePosition ? `${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}` : formattedTime.replace('.', ':')}
                  </button>
                  <button type="button" className="idle-hud__metrics" onClick={openSystemMonitor}>
                    <span className="idle-hud__stat">
                      <em>CPU</em>
                      <strong>{sysData.cpuUsage === null ? '—' : `${Math.round(sysData.cpuUsage)}%`}</strong>
                      <span className="idle-hud__bar"><i style={{ width: `${Math.min(100, Math.max(0, sysData.cpuUsage ?? 0))}%`, background: '#60a5fa' }} /></span>
                    </span>
                    <span className="idle-hud__stat">
                      <em>RAM</em>
                      <strong>{sysData.memoryUsedBytes !== null && sysData.memoryTotalBytes ? `${Math.round((sysData.memoryUsedBytes / sysData.memoryTotalBytes) * 100)}%` : '—'}</strong>
                      <span className="idle-hud__bar"><i style={{ width: `${sysData.memoryUsedBytes !== null && sysData.memoryTotalBytes ? Math.min(100, Math.round((sysData.memoryUsedBytes / sysData.memoryTotalBytes) * 100)) : 0}%`, background: '#c084fc' }} /></span>
                    </span>
                    <span className="idle-hud__stat">
                      <em>BAT</em>
                      <strong style={{ color: batteryColor }}>{batteryAvailable ? `${Math.round(batteryLevel)}%` : '—'}</strong>
                    </span>
                  </button>
                </div>
              ) : (
              <>
              {(() => {
                let clockRendered = false;
                const renderClockButton = (key: string) => {
                  if (clockRendered) return null;
                  clockRendered = true;
                  return (
                    <button
                      key={key}
                      className="idle-clock"
                      aria-label={localize(language, 'Buka menu', 'Open menu')}
                      title={localize(language, 'Buka menu', 'Open menu')}
                      onClick={openLauncher}
                    >
                      {showClock && (
                        <span className={`idle-clock__time${isSidePosition ? ' idle-clock__time--vertical' : ''}`}>
                          {isSidePosition
                            ? (
                              <>
                                <SlideDigits value={String(time.getHours()).padStart(2, '0')} />
                                <SlideDigits value={String(time.getMinutes()).padStart(2, '0')} />
                              </>
                            )
                            : <SlideDigits value={formattedTime.replace('.', ':')} />}
                        </span>
                      )}
                      {showDate && <span className="idle-clock__date">{formattedDate}</span>}
                    </button>
                  );
                };

                const nodes = layoutSettings.idleWidgets.map((widget) => {
                  if (!widget.visible) return null;
                  if (widget.id === 'pet') {
                    return (
                      <IslandPet
                        key="pet"
                        style={windhawkSettings.appearance.petStyle}
                        customImage={windhawkSettings.appearance.customPetImage}
                        isPlaying={Boolean(sysData.media?.is_playing)}
                        isCharging={sysData.batteryState === 'Charging'}
                        pcIdleSeconds={sysData.pcIdleSeconds ?? 0}
                        idleThresholdMinutes={windhawkSettings.appearance.petIdleMinutes}
                      />
                    );
                  }
                  if (widget.id === 'privacy' && hasPrivacyAlert) {
                    return (
                      <span key="privacy" className="idle-privacy" aria-label={localize(language, 'Indikator privasi kamera dan mikrofon', 'Camera and microphone privacy indicator')}>
                        {sysData.cameraActive && (
                          <span
                            className="idle-privacy__badge idle-privacy__badge--camera"
                            title={localize(language, `Kamera aktif: ${sysData.cameraApp ?? 'Aplikasi'}`, `Camera in use: ${sysData.cameraApp ?? 'App'}`)}
                          >
                            <Camera size={11} />
                          </span>
                        )}
                        {sysData.micInUse && (
                          <span
                            className="idle-privacy__badge idle-privacy__badge--mic"
                            title={localize(language, `Mikrofon aktif: ${sysData.micApp ?? 'Aplikasi'}`, `Mic in use: ${sysData.micApp ?? 'App'}`)}
                          >
                            <Mic size={11} />
                          </span>
                        )}
                      </span>
                    );
                  }
                  if (widget.id === 'live' && (sysData.activeDownload || sysData.bluetoothDevice)) {
                    return (
                      <span key="live" className="idle-live-group">
                        {sysData.activeDownload && (
                          <span
                            className="idle-live-pill idle-live-pill--download"
                            title={`${localize(language, 'Mengunduh', 'Downloading')}: ${sysData.activeDownload.fileName}`}
                          >
                            <Download size={10} />
                            <span>{(sysData.activeDownload.sizeBytes / (1024 * 1024)).toFixed(1)}M</span>
                          </span>
                        )}
                        {sysData.bluetoothDevice && (
                          <span
                            className="idle-live-pill idle-live-pill--bt"
                            title={`${sysData.bluetoothDevice.name} (${sysData.bluetoothDevice.battery}%)`}
                          >
                            <Bluetooth size={10} />
                            <span>{sysData.bluetoothDevice.battery}%</span>
                          </span>
                        )}
                      </span>
                    );
                  }
                  if (widget.id === 'clock' || widget.id === 'date') {
                    return renderClockButton(widget.id);
                  }
                  if (widget.id === 'battery' && !monitorPinned) {
                    return (
                      <button
                        key="battery"
                        type="button"
                        className={`idle-battery${sysData.batteryState === 'Charging' ? ' is-charging' : ''}${batteryAvailable && batteryLevel <= 20 && sysData.batteryState !== 'Charging' ? ' is-low' : ''}`}
                        aria-label={localize(language, 'Buka monitor sistem', 'Open system monitor')}
                        onClick={openSystemMonitor}
                        style={{ '--battery-color': batteryColor, '--battery-level': `${batteryLevel / 100}` } as CSSProperties}
                        title={sysData.batteryError ?? `${localize(language, 'Baterai', 'Battery')} ${batteryAvailable ? `${Math.round(batteryLevel)}%` : 'N/A'}`}
                      >
                        <span className="idle-battery__icon" aria-hidden="true">
                          {sysData.batteryState === 'Charging' ? (
                            <BatteryCharging size={16} />
                          ) : (
                            <>
                              <Battery size={16} />
                              <span />
                            </>
                          )}
                        </span>
                        <span className="idle-battery__percent">{batteryAvailable ? `${Math.round(batteryLevel)}%` : '—'}</span>
                      </button>
                    );
                  }
                  return null;
                });

                return (
                  <>
                    {!showClock && !showDate && (
                      <button
                        type="button"
                        className="idle-clock"
                        aria-label={localize(language, 'Buka menu', 'Open menu')}
                        title={localize(language, 'Buka menu', 'Open menu')}
                        onClick={openLauncher}
                      >
                        <LayoutGrid size={14} />
                      </button>
                    )}
                    {nodes}
                    {showPrayerPill && (
                      <button
                        type="button"
                        className="idle-prayer-pill"
                        onClick={() => openToolsTab('prayer')}
                        title={localize(language, 'Buka jadwal salat', 'Open prayer schedule')}
                      >
                        <span className="idle-prayer-pill__dot" aria-hidden="true" />
                        <span>{nextPrayerLabel || localize(language, 'Jadwal salat', 'Prayer time')}</span>
                      </button>
                    )}
                    {showTickerPill && (
                      <button
                        type="button"
                        className="idle-ticker-pill"
                        onClick={openLauncher}
                        title={activeTickerText}
                      >
                        <span key={activeTickerText} className="idle-ticker-pill__text">{activeTickerText}</span>
                      </button>
                    )}
                    {showIdleLyricPill && (
                      <button
                        type="button"
                        className={`idle-lyric-pill${isSidePosition ? ' idle-lyric-pill--side' : ''}${shouldMarqueeIdleLyric ? ' is-marquee' : ''}`}
                        onClick={openMediaDetail}
                        title={`${sysData.media?.title ?? ''}${activeIdleLyric ? ` — ${activeIdleLyric}` : ''}`}
                      >
                        <span className={`idle-lyric-pill__art${mediaArtwork ? ' has-art' : ''}`} aria-hidden="true">
                          {mediaArtwork ? <img src={mediaArtwork} alt="" /> : <Music2 size={10} />}
                        </span>
                        <span className="idle-lyric-pill__body">
                          {!isSidePosition && (
                            <span className="idle-lyric-pill__title">
                              {sysData.media?.title || localize(language, 'Sedang diputar', 'Now playing')}
                            </span>
                          )}
                          <span className="idle-lyric-pill__viewport">
                            <span key={idleLyricDisplayText} className="idle-lyric-pill__text">
                              {activeIdleLyric ? `♪ ${activeIdleLyric}` : idleLyricDisplayText}
                            </span>
                          </span>
                        </span>
                        <span className={`idle-waveform idle-waveform--corner${sysData.media?.is_playing ? ' is-playing' : ''}`} aria-hidden="true">
                          {(isSidePosition
                            ? [40, 76, 54, 96, 68, 100, 50, 84, 60, 42]
                            : [34, 62, 46, 86, 58, 96, 44, 78, 92, 52, 100, 68, 84, 48, 90, 64, 76, 42, 88, 56, 70, 38]
                          ).map((barH, idx, arr) => {
                            const pct = ((idx + 0.5) / arr.length) * 100;
                            const isPlayed = idleMediaProgress > 0 ? pct <= idleMediaProgress : true;
                            return (
                              <i
                                key={idx}
                                className={isPlayed ? 'is-played' : undefined}
                                style={{ height: `${barH}%`, animationDelay: `${(idx % 6) * 0.08}s` }}
                              />
                            );
                          })}
                        </span>
                      </button>
                    )}
                    {focusLive.running && (
                      <button
                        type="button"
                        className={`idle-focus-pill${focusLive.isBreak ? ' is-break' : ''}`}
                        onClick={() => openToolsTab('focus')}
                        title={focusLive.isBreak
                          ? localize(language, 'Istirahat sedang berjalan — klik untuk buka Focus', 'Break running — click to open Focus')
                          : localize(language, 'Focus sedang berjalan — klik untuk buka Focus', 'Focus running — click to open Focus')}
                      >
                        <span className="idle-focus-pill__row">
                          <AlarmClock size={10} />
                          <strong><SlideDigits value={focusFormatted} /></strong>
                        </span>
                        <span className="idle-focus-pill__bar" aria-hidden="true">
                          <span style={{ width: `${focusProgress}%` }} />
                        </span>
                      </button>
                    )}
                  </>
                );
              })()}
              {mediaPinned && (
                <button
                  type="button"
                  className={`idle-pin-card idle-pin-card--media${sysData.media?.is_playing ? ' is-playing' : ''}`}
                  disabled={!sysData.media}
                  aria-label={localize(language, 'Buka media yang disematkan', 'Open pinned media')}
                  onClick={openMediaDetail}
                >
                  <span className={`idle-pin-card__icon${mediaArtwork ? ' idle-pin-card__icon--art' : ''}`}>
                    {mediaArtwork ? <img src={mediaArtwork} alt="" /> : <Music2 size={14} />}
                  </span>
                  <span className="idle-pin-card__copy">
                    <strong>{sysData.media?.title || localize(language, 'Tidak ada media', 'No media')}</strong>
                    <span className={`idle-pin-card__subwrap${showLyrics && activeIdleLyric ? ' has-lyric' : ''}${showLyrics && activeIdleLyric.length > 24 ? ' is-marquee' : ''}`}>
                      <small key={(showLyrics && activeIdleLyric) || sysData.media?.artist || 'artist'} className={showLyrics && activeIdleLyric ? 'idle-pin-card__lyric' : undefined}>
                        {showLyrics && activeIdleLyric ? `♪ ${activeIdleLyric}` : (sysData.media?.artist || localize(language, 'Putar musik', 'Play media'))}
                      </small>
                    </span>
                  </span>
                  {sysData.media && (
                    <span className={`idle-waveform idle-waveform--corner${sysData.media.is_playing ? ' is-playing' : ''}`} aria-hidden="true">
                      {(isSidePosition
                        ? [38, 74, 52, 94, 66, 100, 48, 86, 58, 40]
                        : [34, 62, 46, 86, 58, 96, 44, 78, 92, 52, 100, 68, 84, 48, 90, 64, 76, 42, 88, 56, 70, 38]
                      ).map((barH, idx, arr) => {
                        const pct = ((idx + 0.5) / arr.length) * 100;
                        const isPlayed = idleMediaProgress > 0 ? pct <= idleMediaProgress : sysData.media?.is_playing;
                        return (
                          <i
                            key={idx}
                            className={isPlayed ? 'is-played' : undefined}
                            style={{ height: `${barH}%`, animationDelay: `${(idx % 6) * 0.08}s` }}
                          />
                        );
                      })}
                    </span>
                  )}
                </button>
              )}
              {monitorPinned && (
                <button
                  type="button"
                  className="idle-monitor-card"
                  aria-label={localize(language, 'Buka semua metrik monitor sistem', 'Open all system monitor metrics')}
                  onClick={openSystemMonitor}
                >
                  <span className="idle-monitor-card__metric idle-monitor-card__metric--cpu" title={localize(language, 'Penggunaan CPU', 'CPU usage')}>
                    <Cpu size={11} />
                    <strong>{sysData.cpuUsage === null ? '—' : `${Math.round(sysData.cpuUsage)}%`}</strong>
                  </span>
                  <span className="idle-monitor-card__metric idle-monitor-card__metric--ram" title={localize(language, 'Penggunaan memori', 'Memory usage')}>
                    <HardDrive size={11} />
                    <strong>{sysData.memoryUsedBytes !== null && sysData.memoryTotalBytes
                      ? `${Math.round(sysData.memoryUsedBytes / sysData.memoryTotalBytes * 100)}%`
                      : '—'}</strong>
                  </span>
                  <span
                    className="idle-monitor-card__metric idle-monitor-card__metric--bat"
                    style={{ color: batteryColor }}
                    title={localize(language, 'Baterai', 'Battery')}
                  >
                    {sysData.batteryState === 'Charging' ? <BatteryCharging size={11} /> : <Battery size={11} />}
                    <strong>{batteryAvailable ? `${Math.round(batteryLevel)}%` : '—'}</strong>
                  </span>
                  <span
                    className={`idle-monitor-card__metric idle-monitor-card__metric--wifi${sysData.isWifiConnected ? ' is-connected' : ''}`}
                    title={`${sysData.activeWifiName || 'Wi-Fi'} · ↓ ${formatCompactSpeed(sysData.netRxBytesPerSec ?? 0)}/s ↑ ${formatCompactSpeed(sysData.netTxBytesPerSec ?? 0)}/s`}
                  >
                    <Wifi size={11} />
                    <strong>
                      {sysData.isWifiConnected
                        ? `↓${formatCompactSpeed(sysData.netRxBytesPerSec ?? 0)} ↑${formatCompactSpeed(sysData.netTxBytesPerSec ?? 0)}`
                        : 'Off'}
                    </strong>
                  </span>
                </button>
              )}
              </>
              )}
            </m.div>
          )}

          {islandMode === 'launcher' && (
            <Launcher
              language={language}
              media={sysData.media}
              artwork={mediaArtwork}
              items={layoutSettings.launcherItems}
              customShortcuts={layoutSettings.customShortcuts}
              columns={layoutSettings.launcherColumns}
              isSidePosition={isSidePosition}
              travelX={sideTravel}
              travelY={verticalTravel}
              transition={panelTransition}
              onOpenTools={openTools}
              onOpenMedia={openMediaDetail}
              onOpenSystemMonitor={openSystemMonitor}
              onOpenAi={() => openToolsTab('ai')}
              onOpenCapture={() => openToolsTab('capture')}
              onOpenCustomShortcut={(target) => { void openCustomShortcut(target); }}
              onLock={() => { void lockWindows(); }}
            />
          )}

          {islandMode === 'mediaDetail' && sysData.media && (
            <Suspense fallback={null}>
              <MediaDetail
                media={sysData.media}
                provider={mediaProvider}
                artwork={mediaArtwork}
                language={language}
                showLyrics={showLyrics}
                pinned={mediaPinned}
                travelX={sideTravel}
                travelY={verticalTravel}
                transition={panelTransition}
                onToggleLyrics={() => setShowLyrics((visible) => !visible)}
                onTogglePin={() => setMediaPinned((pinned) => !pinned)}
                onReturnToLauncher={returnToLauncher}
                onMediaAction={(action) => { void handleMediaAction(action); }}
              />
            </Suspense>
          )}

          {islandMode === 'systemMonitor' && (
            <Suspense fallback={null}>
              <SystemMonitorDetail
                language={language}
                cpuUsage={sysData.cpuUsage}
                memoryUsedBytes={sysData.memoryUsedBytes}
                memoryTotalBytes={sysData.memoryTotalBytes}
                batteryAvailable={batteryAvailable}
                batteryLevel={batteryLevel}
                batteryColor={batteryColor}
                batteryCharging={sysData.batteryState === 'Charging'}
                pinned={monitorPinned}
                onTogglePin={() => setMonitorPinned((pinned) => !pinned)}
                isWifiConnected={sysData.isWifiConnected}
                activeWifiName={sysData.activeWifiName}
                netRxBytesPerSec={sysData.netRxBytesPerSec ?? null}
                netTxBytesPerSec={sysData.netTxBytesPerSec ?? null}
                travelX={sideTravel}
                travelY={verticalTravel}
                transition={panelTransition}
                onClose={returnToLauncher}
              />
            </Suspense>
          )}

        </AnimatePresence>

        <m.div
          className="tools-panel-wrap"
          style={{ display: islandMode === 'tools' ? 'flex' : 'none' }}
          initial={false}
          animate={islandMode === 'tools'
            ? { opacity: 1, x: 0, y: 0, scale: 1 }
            : { opacity: 0, x: sideTravel, y: verticalTravel, scale: 0.995 }}
          transition={panelTransition}
        >
          <ToolsPanel
            language={language}
            onLanguageChange={setLanguage}
            clipboardItems={clipboardItems}
            shelfPaths={shelfPaths}
            activityModuleSettings={activityModuleSettings}
            windowsNotificationNotices={windowsNotificationNotices}
            notificationAppFilters={notificationAppFilters}
            onActivityModuleSettingsChange={setActivityModuleSettings}
            onWindowsNotificationNoticesChange={setWindowsNotificationNotices}
            onNotificationAppFiltersChange={setNotificationAppFilters}
            onClose={() => { void closeIsland(); }}
            onReturnToMenu={returnToLauncher}
            onClearClipboard={() => setClipboardItems([])}
            onRemoveShelfItem={(path) => setShelfPaths((items) => items.filter((item) => item !== path))}
            onCopyClipboard={(text) => {
              void invoke('write_clipboard_text', { text }).catch((error) => console.error('Gagal menyalin teks:', error));
            }}
            onNotice={handleToolNotice}
            onCapture={() => { void openSnippingTool(); }}
            onScreenshot={() => { void takeScreenshot(); }}
            islandPosition={islandPosition}
            onIslandPositionChange={setIslandPosition}
            windhawkSettings={windhawkSettings}
            onWindhawkSettingsChange={setWindhawkSettings}
            layoutSettings={layoutSettings}
            onLayoutSettingsChange={setLayoutSettings}
            openSettingsRequest={openSettingsRequest}
            openTabRequest={openTabRequest}
            onFocusStateChange={setFocusLive}
            onNextPrayerChange={setNextPrayerLabel}
          />
        </m.div>
      </div>
    </div>
    </LazyMotion>
  );
}