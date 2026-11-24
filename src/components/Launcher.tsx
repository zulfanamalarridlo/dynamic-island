import { invoke } from '@tauri-apps/api/core';
import { m, type Transition } from 'framer-motion';
import { Camera, ExternalLink, Gauge, LayoutGrid, LockKeyhole, Music2, Settings, Sparkles, X } from 'lucide-react';
import { localize, type AppLanguage } from '../lib/i18n';
import type { CustomShortcut, LauncherColumns, LauncherItemId, LayoutItemConfig } from '../lib/layoutSettings';
import type { MediaInfo } from '../types';

interface LauncherProps {
  language: AppLanguage;
  media: MediaInfo | null;
  artwork: string | null;
  items: LayoutItemConfig<LauncherItemId>[];
  customShortcuts: CustomShortcut[];
  columns: LauncherColumns;
  isSidePosition: boolean;
  travelX: number;
  travelY: number;
  transition: Transition;
  onOpenTools: () => void;
  onOpenMedia: () => void;
  onOpenSystemMonitor: () => void;
  onOpenAi: () => void;
  onOpenCapture: () => void;
  onOpenCustomShortcut: (target: string) => void;
  onLock: () => void;
  onClose: () => void;
}

export default function Launcher({
  language,
  media,
  artwork,
  items,
  customShortcuts,
  columns,
  isSidePosition,
  travelX,
  travelY,
  transition,
  onOpenTools,
  onOpenMedia,
  onOpenSystemMonitor,
  onOpenAi,
  onOpenCapture,
  onOpenCustomShortcut,
  onLock,
  onClose
}: LauncherProps) {
  const visibleItems = items.filter((item) => item.visible);
  const effectiveItems = visibleItems.length > 0 || customShortcuts.length > 0
    ? visibleItems
    : [{ id: 'tools' as LauncherItemId, visible: true }];
  const totalCount = effectiveItems.length + customShortcuts.length;
  const gridCols = isSidePosition ? 1 : Math.min(columns, Math.max(1, totalCount));

  return (
    <m.nav
      key="launcher"
      className={`island-launcher-wrap island-module${isSidePosition ? ' island-launcher-wrap--side' : ''}`}
      initial={{ opacity: 0, x: travelX, y: travelY, scale: 0.97 }}
      animate={{ opacity: 1, x: 0, y: 0, scale: 1 }}
      exit={{ opacity: 0, x: travelX, y: travelY, scale: 0.99 }}
      transition={transition}
      aria-label={localize(language, 'Menu Dynamic Island', 'Dynamic Island menu')}
    >
      <header className="launcher-header">
        <span className="launcher-header__title">{localize(language, 'Menu', 'Menu')}</span>
        <div className="island-action-pill">
          <button
            type="button"
            className="detail-action-button"
            aria-label={localize(language, 'Buka pengaturan', 'Open settings')}
            title={localize(language, 'Buka pengaturan', 'Open settings')}
            onClick={(event) => {
              event.stopPropagation();
              void invoke('open_settings_window').catch(() => {});
            }}
          >
            <Settings size={13} />
          </button>
          <button
            type="button"
            className="detail-action-button"
            aria-label={localize(language, 'Tutup menu', 'Close menu')}
            title={localize(language, 'Tutup menu', 'Close menu')}
            onClick={(event) => {
              event.stopPropagation();
              onClose();
            }}
          >
            <X size={13} />
          </button>
        </div>
      </header>
      <div
        className="island-launcher"
        style={!isSidePosition ? { gridTemplateColumns: `repeat(${gridCols}, minmax(0, 1fr))` } : undefined}
      >
      {effectiveItems.map(({ id }, index) => {
        const itemMotion = {
          initial: { opacity: 0, y: 6, scale: 0.94 },
          animate: { opacity: 1, y: 0, scale: 1 },
          transition: { delay: index * 0.025, duration: 0.22, ease: [0.22, 1, 0.36, 1] as const },
          whileHover: { y: -2, scale: 1.03 },
          whileTap: { scale: 0.94 }
        };
        if (id === 'tools') {
          return (
            <m.button key="tools" {...itemMotion} className="launcher-item" onClick={onOpenTools} aria-label={localize(language, 'Alat', 'Tools')}>
              <span className="launcher-item__icon"><LayoutGrid size={16} /></span>
              <span className="launcher-item__copy"><strong>{localize(language, 'Alat', 'Tools')}</strong></span>
            </m.button>
          );
        }
        if (id === 'music') {
          return (
            <m.button key="music" {...itemMotion} whileHover={media ? { y: -2, scale: 1.03 } : undefined} whileTap={media ? { scale: 0.94 } : undefined} className="launcher-item launcher-item--music" onClick={onOpenMedia} disabled={!media} aria-label={localize(language, 'Musik', 'Music')}>
              <span className={`launcher-item__icon${artwork ? ' launcher-item__icon--art' : ''}`}>
                {artwork ? <img src={artwork} alt="" /> : <Music2 size={16} />}
              </span>
              <span className="launcher-item__copy">
                <strong>{media?.title ? (media.title.length > 10 ? `${media.title.slice(0, 8)}...` : media.title) : '—'}</strong>
                {media?.artist && <small>{media.artist.length > 10 ? `${media.artist.slice(0, 8)}...` : media.artist}</small>}
              </span>
              {media?.is_playing && <i className="launcher-item__playing" aria-label={localize(language, 'Sedang diputar', 'Now playing')} />}
            </m.button>
          );
        }
        if (id === 'monitor') {
          return (
            <m.button key="monitor" {...itemMotion} className="launcher-item" onClick={onOpenSystemMonitor} aria-label={localize(language, 'Monitor sistem', 'System monitor')}>
              <span className="launcher-item__icon"><Gauge size={16} /></span>
              <span className="launcher-item__copy"><strong>Monitor</strong></span>
            </m.button>
          );
        }
        if (id === 'ai') {
          return (
            <m.button key="ai" {...itemMotion} className="launcher-item" onClick={onOpenAi} aria-label="AI Chat">
              <span className="launcher-item__icon"><Sparkles size={16} /></span>
              <span className="launcher-item__copy"><strong>AI</strong></span>
            </m.button>
          );
        }
        if (id === 'capture') {
          return (
            <m.button key="capture" {...itemMotion} className="launcher-item" onClick={onOpenCapture} aria-label="Capture & OCR">
              <span className="launcher-item__icon"><Camera size={16} /></span>
              <span className="launcher-item__copy"><strong>Capture</strong></span>
            </m.button>
          );
        }
        return (
          <m.button key="lock" {...itemMotion} className="launcher-item" onClick={onLock} aria-label={localize(language, 'Kunci Windows', 'Lock Windows')} title={localize(language, 'Kunci Windows', 'Lock Windows')}>
            <span className="launcher-item__icon"><LockKeyhole size={16} /></span>
            <span className="launcher-item__copy"><strong>{localize(language, 'Kunci', 'Lock')}</strong></span>
          </m.button>
        );
      })}
      {customShortcuts.map((shortcut, index) => (
        <m.button
          key={shortcut.id}
          initial={{ opacity: 0, y: 6, scale: 0.94 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ delay: (effectiveItems.length + index) * 0.025, duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          whileHover={{ y: -2, scale: 1.03 }}
          whileTap={{ scale: 0.94 }}
          className="launcher-item launcher-item--custom"
          onClick={() => onOpenCustomShortcut(shortcut.target)}
          aria-label={shortcut.label}
          title={shortcut.target}
        >
          <span className="launcher-item__icon"><ExternalLink size={15} /></span>
          <span className="launcher-item__copy"><strong>{shortcut.label}</strong></span>
        </m.button>
      ))}
      </div>
    </m.nav>
  );
}
