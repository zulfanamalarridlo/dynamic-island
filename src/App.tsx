import { lazy, Suspense, useState, useEffect, useRef, useCallback, type CSSProperties } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { currentMonitor, getCurrentWindow } from '@tauri-apps/api/window';
import { AnimatePresence, domAnimation, LazyMotion, m } from 'framer-motion';
import { Battery, BatteryCharging, Cpu, HardDrive, Music2, Wifi } from 'lucide-react';
import ToolsPanel, { type ClipboardItem } from './ToolsPanel';
import { localize, readAppLanguage, type AppLanguage } from './i18n';
import { readAppSetting, saveAppSetting } from './settings';
import { readWindhawkSettings, saveWindhawkSettings } from './windhawkSettings';
import { getMediaProvider } from './mediaUtils';
import AutoNoticeCard from './components/AutoNoticeCard';
import Launcher from './components/Launcher';
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
    memoryTotalBytes: null
  });

  const [islandMode, setIslandMode] = useState<IslandMode>('idle');
  const [islandPosition, setIslandPosition] = useState<IslandPosition>(readIslandPosition);
  const [windhawkSettings, setWindhawkSettings] = useState(readWindhawkSettings);
  const [openSettingsRequest, setOpenSettingsRequest] = useState(0);
  const [viewport, setViewport] = useState(() => ({
    width: window.screen.width,
    height: window.screen.height
  }));
  const [time, setTime] = useState(new Date());
  const [autoNotice, setAutoNotice] = useState<AutoNotice | null>(null);
  const [clipboardItems, setClipboardItems] = useState<ClipboardItem[]>(() => readLocalItems<ClipboardItem>('di-clipboard-history'));
  const [shelfPaths, setShelfPaths] = useState<string[]>(() => readLocalItems<string>('di-file-shelf'));
  const [showLyrics, setShowLyrics] = useState(false);
  const [mediaArtwork, setMediaArtwork] = useState<string | null>(null);
  const [mediaPinned, setMediaPinned] = useState(() => readLocalBoolean('di-pin-media', false));
  const [monitorPinned, setMonitorPinned] = useState(() => (
    readLocalBoolean('di-pin-monitor', readLocalBoolean('di-pin-battery', false))
  ));
  const [activityModuleSettings, setActivityModuleSettings] = useState(readActivityModuleSettings);
  const [windowsNotificationNotices, setWindowsNotificationNotices] = useState(
    () => readLocalBoolean('di-windows-notification-notices', true)
  );
  const islandModeRef = useRef<IslandMode>('idle');
  const islandRef = useRef<HTMLDivElement | null>(null);
  const scheduleBoundsReportRef = useRef<() => void>(() => {});
  const activityModuleSettingsRef = useRef(activityModuleSettings);
  const windowsNotificationNoticesRef = useRef(windowsNotificationNotices);
  const autoNoticeRef = useRef<AutoNotice | null>(null);
  const previousSystemDataRef = useRef<SysData | null>(null);
  const autoNoticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeDelayTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoNoticeQueue = useRef<AutoNotice[]>([]);

  activityModuleSettingsRef.current = activityModuleSettings;
  windowsNotificationNoticesRef.current = windowsNotificationNotices;

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
  useEffect(() => saveAppSetting('di-pin-media', mediaPinned), [mediaPinned]);
  useEffect(() => saveAppSetting('di-pin-monitor', monitorPinned), [monitorPinned]);

  useEffect(() => {
    scheduleBoundsReportRef.current();
  }, [windhawkSettings.appearance.sizeScale, windhawkSettings.themes.textScale]);

  useEffect(() => {
    const timer = window.setInterval(() => setTime(new Date()), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let active = true;
    void currentMonitor()
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
  }, []);

  useEffect(() => {
    let active = true;
    let updating = false;
    let pending = false;
    let lastBounds = '';
    let frame: number | null = null;
    const reportBounds = async () => {
      const island = islandRef.current;
      if (!active || !island) return;
      if (updating) {
        pending = true;
        return;
      }

      const bounds = island.getBoundingClientRect();
      const nativeX = Math.floor(bounds.x);
      const nativeY = Math.floor(bounds.y);
      const nativeWidth = Math.ceil(bounds.right) - nativeX;
      const nativeHeight = Math.ceil(bounds.bottom) - nativeY;
      const style = window.getComputedStyle(island);
      const parseRadius = (value: string) => {
        const radius = Number.parseFloat(value);
        return Number.isFinite(radius) ? radius : 0;
      };
      const zoom = parseRadius(style.zoom) || 1;
      const radiusTopLeft = parseRadius(style.borderTopLeftRadius) * zoom;
      const radiusTopRight = parseRadius(style.borderTopRightRadius) * zoom;
      const radiusBottomRight = parseRadius(style.borderBottomRightRadius) * zoom;
      const radiusBottomLeft = parseRadius(style.borderBottomLeftRadius) * zoom;
      const boundsKey = `${nativeX},${nativeY},${nativeWidth},${nativeHeight},${radiusTopLeft},${radiusTopRight},${radiusBottomRight},${radiusBottomLeft}`;
      if (boundsKey === lastBounds) return;

      updating = true;
      try {
        await invoke('set_island_window_region', {
          x: nativeX,
          y: nativeY,
          width: nativeWidth,
          height: nativeHeight,
          radiusTopLeft,
          radiusTopRight,
          radiusBottomRight,
          radiusBottomLeft
        });
        lastBounds = boundsKey;
      } catch (error) {
        console.error('Gagal menempatkan jendela Dynamic Island:', error);
      } finally {
        updating = false;
        if (active) {
          if (pending) {
            pending = false;
            scheduleBoundsReport();
          }
        }
      }
    };

    const scheduleBoundsReport = () => {
      if (!active || frame !== null) return;
      frame = window.requestAnimationFrame(() => {
        frame = null;
        void reportBounds();
      });
    };
    scheduleBoundsReportRef.current = scheduleBoundsReport;
    const island = islandRef.current;
    const resizeObserver = island && typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(scheduleBoundsReport)
      : null;
    if (island) resizeObserver?.observe(island);
    window.addEventListener('resize', scheduleBoundsReport);
    scheduleBoundsReport();
    return () => {
      active = false;
      resizeObserver?.disconnect();
      window.removeEventListener('resize', scheduleBoundsReport);
      if (frame !== null) window.cancelAnimationFrame(frame);
      scheduleBoundsReportRef.current = () => {};
    };
  }, [islandPosition]);

  useEffect(() => {
    scheduleBoundsReportRef.current();
    const timer = window.setTimeout(() => scheduleBoundsReportRef.current(), 350);
    return () => window.clearTimeout(timer);
  }, [islandMode, islandPosition]);

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

  useEffect(() => {
    let active = true;
    let unlistenSystemNotification: (() => void) | undefined;
    void listen<AutoNotice>('system-notification', (event) => {
      const notice = event.payload;
      if (notice.kind === 'notification') {
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
    setShowLyrics(false);
    islandModeRef.current = 'launcher';
    setIslandMode('launcher');
  };

  const handleToolNotice = useCallback((title: string, body: string) => {
    showAutoNotice({ kind: 'system', title, body });
  }, []);

  const openMediaDetail = () => {
    if (!sysData.media || (islandModeRef.current !== 'launcher' && islandModeRef.current !== 'idle')) return;
    if (autoNoticeTimer.current) clearTimeout(autoNoticeTimer.current);
    autoNoticeTimer.current = null;
    autoNoticeRef.current = null;
    setAutoNotice(null);
    setShowLyrics(false);
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
    }, 3600);
  };

  const showAutoNotice = (notice: AutoNotice) => {
    if (islandModeRef.current !== 'idle' && islandModeRef.current !== 'autoNotice' && islandModeRef.current !== 'tools') return;

    const queuedNotices = autoNoticeQueue.current;
    const lastNotice = queuedNotices[queuedNotices.length - 1] ?? autoNoticeRef.current;
    if (lastNotice?.kind === notice.kind && lastNotice.title === notice.title && lastNotice.body === notice.body) return;
    if (islandModeRef.current === 'autoNotice') {
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
    setShowLyrics(false);
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

  const openSnippingTool = () => runCaptureAction('open_snipping_tool', 'Gagal membuka Snipping Tool');
  const takeScreenshot = () => runCaptureAction('take_screenshot', 'Gagal mengambil screenshot');
  const toggleScreenRecording = () => runCaptureAction('toggle_screen_recording', 'Gagal mengontrol perekaman layar');

  const formattedTime = time.toLocaleTimeString(language === 'id' ? 'id-ID' : 'en-US', { hour: '2-digit', minute: '2-digit' });
  const formattedDate = time.toLocaleDateString(language === 'id' ? 'id-ID' : 'en-US', {
    weekday: 'short',
    day: 'numeric',
    month: 'short'
  });
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
  const topPanelWidth = Math.max(0, Math.min(400, viewport.width - 24));
  const sideWidth = Math.max(0, Math.min(290, Math.max(220, viewport.width * 0.25), viewport.width - 24));
  const sideHeight = Math.max(0, Math.min(460, viewport.height - 24));
  const sideLauncherHeight = Math.min(360, sideHeight);
  const hasPinnedIdleContent = mediaPinned || monitorPinned;
  const idleWidth = isSidePosition
    ? Math.min(sideWidth, hasPinnedIdleContent ? 260 : 76)
    : Math.min(topPanelWidth, hasPinnedIdleContent
      ? mediaPinned && monitorPinned ? 400 : mediaPinned ? 280 : 360
      : 240);
  const idleHeight = isSidePosition
    ? monitorPinned ? mediaPinned ? Math.min(390, sideHeight) : Math.min(330, sideHeight) : mediaPinned ? 148 : 150
    : monitorPinned ? 84 : mediaPinned ? 58 : 52;

  const islandVariants = {
    idle: {
      height: idleHeight,
      width: idleWidth,
      borderTopLeftRadius: islandPosition === 1 || islandPosition === 0 ? 0 : 12,
      borderTopRightRadius: islandPosition === 2 || islandPosition === 0 ? 0 : 12,
      borderBottomLeftRadius: islandPosition === 1 ? 0 : 12,
      borderBottomRightRadius: islandPosition === 2 ? 0 : 12,
    },
    launcher: {
      width: isSidePosition ? sideWidth : topPanelWidth,
      height: isSidePosition ? sideLauncherHeight : 76,
      borderRadius: 16,
    },
    autoNotice: {
      width: isSidePosition ? sideWidth : Math.min(360, topPanelWidth),
      height: isSidePosition
        ? (autoNotice?.volumeLevel !== undefined ? Math.min(220, sideHeight) : Math.min(170, sideHeight))
        : (autoNotice?.volumeLevel !== undefined ? 86 : 72),
      borderRadius: 14,
    },
    mediaDetail: {
      width: isSidePosition ? sideWidth : Math.min(370, topPanelWidth),
      height: isSidePosition
        ? Math.min(showLyrics ? 390 : 300, sideHeight)
        : (showLyrics ? 222 : 150),
      borderRadius: 18,
    },
    systemMonitor: {
      width: isSidePosition ? sideWidth : Math.min(360, topPanelWidth),
      height: isSidePosition ? Math.min(360, sideHeight) : 276,
      borderRadius: 18,
    },
    tools: {
      width: isSidePosition ? sideWidth : topPanelWidth,
      height: isSidePosition ? sideHeight : Math.min(360, viewport.height - 24),
      borderRadius: 18,
    }
  };

  const springTransition = { type: 'spring', stiffness: 155, damping: 30, mass: 0.9 };
  const panelTransition = { duration: 0.32, ease: [0.22, 1, 0.36, 1] };
  const sideTravel = islandPosition === 1 ? -7 : islandPosition === 2 ? 7 : 0;
  const verticalTravel = islandPosition === 0 ? -6 : 0;
  const pillOpacity = Number.isFinite(windhawkSettings.themes.pillOpacity)
    ? Math.min(100, Math.max(35, windhawkSettings.themes.pillOpacity))
    : 100;
  const islandStyle: IslandStyle = {
    zoom: Number(windhawkSettings.appearance.sizeScale) * windhawkSettings.themes.textScale / 100,
    fontFamily: windhawkSettings.themes.fontFamily || undefined,
    '--island-pill-opacity': String(pillOpacity / 100),
    ...(windhawkSettings.themes.themePreset === 'custom' ? {
      '--island-custom-theme-bg': windhawkSettings.themes.pillBgColor,
      '--island-custom-theme-border': windhawkSettings.themes.contourBorderHex,
      '--island-custom-theme-text': windhawkSettings.themes.textPrimaryColor
    } : {})
  };

  return (
    <LazyMotion features={domAnimation}>
    <div className={`w-screen h-screen flex ${
      islandPosition === 0 ? 'justify-center items-start' :
      islandPosition === 1 ? 'justify-start items-center' :
      'justify-end items-center'
    } box-border select-none pointer-events-none`}>
      <m.div
        ref={islandRef}
        className={`island-shell${pillOpacity < 96 ? ' backdrop-blur-xl' : ''} border overflow-hidden cursor-pointer flex items-center justify-center relative pointer-events-auto island-position-${islandPosition === 0 ? 'top-center' : islandPosition === 1 ? 'left-center' : 'right-center'} island-shape-${windhawkSettings.appearance.shapeStyle} island-theme-${windhawkSettings.themes.themePreset}`}
        style={islandStyle}
        variants={islandVariants}
        initial="idle"
        animate={islandMode}
        transition={springTransition}
        onAnimationComplete={() => scheduleBoundsReportRef.current()}
        onPointerEnter={() => {
          if (closeDelayTimer.current) clearTimeout(closeDelayTimer.current);
          closeDelayTimer.current = null;
        }}
        onPointerLeave={() => {
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
              className={`island-idle${isSidePosition ? ' island-idle--side' : ' island-idle--top'}${hasPinnedIdleContent ? ' island-idle--pinned' : ''}`}
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.99 }}
              transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
            >
              <button
                className="idle-clock"
                aria-label={localize(language, 'Buka menu', 'Open menu')}
                title={localize(language, 'Buka menu', 'Open menu')}
                onClick={openLauncher}
              >
                <span className={`idle-clock__time${isSidePosition ? ' idle-clock__time--vertical' : ''}`}>
                  {isSidePosition
                    ? (
                      <>
                        <span>{String(time.getHours()).padStart(2, '0')}</span>
                        <span>{String(time.getMinutes()).padStart(2, '0')}</span>
                      </>
                    )
                    : formattedTime.replace('.', ':')}
                </span>
                <span className="idle-clock__date">{formattedDate}</span>
              </button>
              {mediaPinned && (
                <button
                  type="button"
                  className="idle-pin-card idle-pin-card--media"
                  disabled={!sysData.media}
                  aria-label={localize(language, 'Buka media yang disematkan', 'Open pinned media')}
                  onClick={openMediaDetail}
                >
                  <span className={`idle-pin-card__icon${mediaArtwork ? ' idle-pin-card__icon--art' : ''}`}>
                    {mediaArtwork ? <img src={mediaArtwork} alt="" /> : <Music2 size={16} />}
                  </span>
                  <span className="idle-pin-card__copy">
                    <strong>{sysData.media?.title || localize(language, 'Tidak ada media', 'No media')}</strong>
                    <small>{sysData.media?.artist || localize(language, 'Sematkan musik aktif', 'Play media to show it here')}</small>
                  </span>
                  {sysData.media?.is_playing && <span className="idle-pin-card__playing" aria-label={localize(language, 'Sedang diputar', 'Now playing')} />}
                </button>
              )}
              {monitorPinned ? (
                <button
                  type="button"
                  className="idle-monitor-card"
                  aria-label={localize(language, 'Buka semua metrik monitor sistem', 'Open all system monitor metrics')}
                  onClick={openSystemMonitor}
                >
                  <span className="idle-monitor-card__metric" title={localize(language, 'Penggunaan CPU', 'CPU usage')}>
                    <Cpu size={13} />
                    <strong>{sysData.cpuUsage === null ? '—' : `${Math.round(sysData.cpuUsage)}%`}</strong>
                  </span>
                  <span className="idle-monitor-card__metric" title={localize(language, 'Penggunaan memori', 'Memory usage')}>
                    <HardDrive size={13} />
                    <strong>{sysData.memoryUsedBytes !== null && sysData.memoryTotalBytes
                      ? `${Math.round(sysData.memoryUsedBytes / sysData.memoryTotalBytes * 100)}%`
                      : '—'}</strong>
                  </span>
                  <span className="idle-monitor-card__metric" title={localize(language, 'Baterai', 'Battery')}>
                    {sysData.batteryState === 'Charging' ? <BatteryCharging size={13} /> : <Battery size={13} />}
                    <strong>{batteryAvailable ? `${Math.round(batteryLevel)}%` : '—'}</strong>
                  </span>
                  <span
                    className={`idle-monitor-card__metric${sysData.isWifiConnected ? ' is-connected' : ''}`}
                    title={sysData.activeWifiName || localize(language, 'Jaringan Wi-Fi', 'Wi-Fi network')}
                  >
                    <Wifi size={13} />
                    <strong>{sysData.isWifiConnected
                      ? localize(language, 'Wi-Fi', 'Wi-Fi')
                      : localize(language, 'Offline', 'Offline')}</strong>
                  </span>
                </button>
              ) : (
                <button
                  type="button"
                  className="idle-battery"
                  aria-label={localize(language, 'Buka monitor sistem', 'Open system monitor')}
                  onClick={openSystemMonitor}
                  style={{ color: batteryColor }}
                >
                  <span className="idle-battery__icon">
                    {sysData.batteryState === 'Charging' ? <BatteryCharging size={15} /> : <Battery size={15} />}
                  </span>
                  <span className="idle-battery__percent">{batteryAvailable ? `${Math.round(batteryLevel)}%` : '—'}</span>
                </button>
              )}
            </m.div>
          )}

          {islandMode === 'launcher' && (
            <Launcher
              language={language}
              media={sysData.media}
              artwork={mediaArtwork}
              travelX={sideTravel}
              travelY={verticalTravel}
              transition={panelTransition}
              onOpenTools={openTools}
              onOpenMedia={openMediaDetail}
              onOpenSystemMonitor={openSystemMonitor}
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
          style={{ display: islandMode === 'tools' ? 'block' : 'none' }}
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
            onActivityModuleSettingsChange={setActivityModuleSettings}
            onWindowsNotificationNoticesChange={setWindowsNotificationNotices}
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
            onRecord={() => { void toggleScreenRecording(); }}
            islandPosition={islandPosition}
            onIslandPositionChange={setIslandPosition}
            windhawkSettings={windhawkSettings}
            onWindhawkSettingsChange={setWindhawkSettings}
            openSettingsRequest={openSettingsRequest}
          />
        </m.div>
      </m.div>
    </div>
    </LazyMotion>
  );
}