import { m } from 'framer-motion';
import { Camera, ExternalLink, Gauge, LayoutGrid, LockKeyhole, Music2, Sparkles } from 'lucide-react';
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
  transition: { duration: number; ease: number[] };
  onOpenTools: () => void;
  onOpenMedia: () => void;
  onOpenSystemMonitor: () => void;
  onOpenAi: () => void;
  onOpenCapture: () => void;
  onOpenCustomShortcut: (target: string) => void;
  onLock: () => void;
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
  onLock
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
      className="island-launcher"
      style={!isSidePosition ? { gridTemplateColumns: `repeat(${gridCols}, minmax(0, 1fr))` } : undefined}
      initial={{ opacity: 0, x: travelX, y: travelY, scale: 0.97 }}
      animate={{ opacity: 1, x: 0, y: 0, scale: 1 }}
      exit={{ opacity: 0, x: travelX, y: travelY, scale: 0.99 }}
      transition={transition}
      aria-label={localize(language, 'Menu Dynamic Island', 'Dynamic Island menu')}
    >
      {effectiveItems.map(({ id }) => {
        if (id === 'tools') {
          return (
            <button key="tools" className="launcher-item" onClick={onOpenTools} aria-label={localize(language, 'Alat', 'Tools')}>
              <span className="launcher-item__icon"><LayoutGrid size={16} /></span>
              <span className="launcher-item__copy"><strong>{localize(language, 'Alat', 'Tools')}</strong></span>
            </button>
          );
        }
        if (id === 'music') {
          return (
            <button key="music" className="launcher-item launcher-item--music" onClick={onOpenMedia} disabled={!media} aria-label={localize(language, 'Musik', 'Music')}>
              <span className={`launcher-item__icon${artwork ? ' launcher-item__icon--art' : ''}`}>
                {artwork ? <img src={artwork} alt="" /> : <Music2 size={16} />}
              </span>
              <span className="launcher-item__copy">
                <strong>{media?.title ? (media.title.length > 10 ? `${media.title.slice(0, 8)}...` : media.title) : '—'}</strong>
                {media?.artist && <small>{media.artist.length > 10 ? `${media.artist.slice(0, 8)}...` : media.artist}</small>}
              </span>
              {media?.is_playing && <i className="launcher-item__playing" aria-label={localize(language, 'Sedang diputar', 'Now playing')} />}
            </button>
          );
        }
        if (id === 'monitor') {
          return (
            <button key="monitor" className="launcher-item" onClick={onOpenSystemMonitor} aria-label={localize(language, 'Monitor sistem', 'System monitor')}>
              <span className="launcher-item__icon"><Gauge size={16} /></span>
              <span className="launcher-item__copy"><strong>Monitor</strong></span>
            </button>
          );
        }
        if (id === 'ai') {
          return (
            <button key="ai" className="launcher-item" onClick={onOpenAi} aria-label="AI Chat">
              <span className="launcher-item__icon"><Sparkles size={16} /></span>
              <span className="launcher-item__copy"><strong>AI</strong></span>
            </button>
          );
        }
        if (id === 'capture') {
          return (
            <button key="capture" className="launcher-item" onClick={onOpenCapture} aria-label="Capture & OCR">
              <span className="launcher-item__icon"><Camera size={16} /></span>
              <span className="launcher-item__copy"><strong>Capture</strong></span>
            </button>
          );
        }
        return (
          <button key="lock" className="launcher-item" onClick={onLock} aria-label={localize(language, 'Kunci Windows', 'Lock Windows')} title={localize(language, 'Kunci Windows', 'Lock Windows')}>
            <span className="launcher-item__icon"><LockKeyhole size={16} /></span>
            <span className="launcher-item__copy"><strong>{localize(language, 'Kunci', 'Lock')}</strong></span>
          </button>
        );
      })}
      {customShortcuts.map((shortcut) => (
        <button
          key={shortcut.id}
          className="launcher-item launcher-item--custom"
          onClick={() => onOpenCustomShortcut(shortcut.target)}
          aria-label={shortcut.label}
          title={shortcut.target}
        >
          <span className="launcher-item__icon"><ExternalLink size={15} /></span>
          <span className="launcher-item__copy"><strong>{shortcut.label}</strong></span>
        </button>
      ))}
    </m.nav>
  );
}
