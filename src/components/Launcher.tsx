import { motion } from 'framer-motion';
import { Battery, BatteryCharging, LayoutGrid, LockKeyhole, Music2 } from 'lucide-react';
import { localize, type AppLanguage } from '../i18n';
import type { MediaInfo } from '../types';

interface LauncherProps {
  language: AppLanguage;
  media: MediaInfo | null;
  artwork: string | null;
  batteryAvailable: boolean;
  batteryLevel: number;
  batteryColor: string;
  batteryCharging: boolean;
  travelX: number;
  travelY: number;
  transition: { duration: number; ease: number[] };
  onOpenTools: () => void;
  onOpenMedia: () => void;
  onOpenBattery: () => void;
  onLock: () => void;
}

export default function Launcher({
  language, media, artwork, batteryAvailable, batteryLevel, batteryColor, batteryCharging,
  travelX, travelY, transition, onOpenTools, onOpenMedia, onOpenBattery, onLock
}: LauncherProps) {
  return (
    <motion.nav
      key="launcher"
      className="island-launcher"
      initial={{ opacity: 0, x: travelX, y: travelY, scale: 0.97, filter: 'blur(2px)' }}
      animate={{ opacity: 1, x: 0, y: 0, scale: 1, filter: 'blur(0px)' }}
      exit={{ opacity: 0, x: travelX, y: travelY, scale: 0.99, filter: 'blur(1px)' }}
      transition={transition}
      aria-label={localize(language, 'Menu Dynamic Island', 'Dynamic Island menu')}
    >
      <button className="launcher-item" onClick={onOpenTools} aria-label={localize(language, 'Alat', 'Tools')}>
        <span className="launcher-item__icon"><LayoutGrid size={17} /></span>
        <span className="launcher-item__copy"><strong>{localize(language, 'Alat', 'Tools')}</strong></span>
      </button>
      <button className="launcher-item launcher-item--music" onClick={onOpenMedia} disabled={!media} aria-label={localize(language, 'Musik', 'Music')}>
        <span className={`launcher-item__icon${artwork ? ' launcher-item__icon--art' : ''}`}>
          {artwork ? <img src={artwork} alt="" /> : <Music2 size={17} />}
        </span>
        <span className="launcher-item__copy">
          <strong>{media?.title ? (media.title.length > 10 ? `${media.title.slice(0, 8)}...` : media.title) : '—'}</strong>
          {media?.artist && <small>{media.artist.length > 10 ? `${media.artist.slice(0, 8)}...` : media.artist}</small>}
        </span>
        {media?.is_playing && <i className="launcher-item__playing" aria-label={localize(language, 'Sedang diputar', 'Now playing')} />}
      </button>
      <button className="launcher-item launcher-item--battery" onClick={onOpenBattery} aria-label={localize(language, 'Baterai', 'Battery')}>
        <span className="launcher-item__icon launcher-item__icon--battery" style={{ color: batteryColor }}>
          {batteryCharging ? <BatteryCharging size={17} /> : <Battery size={17} />}
        </span>
        <span className="launcher-item__copy"><strong>{batteryAvailable ? `${Math.round(batteryLevel)}%` : '—'}</strong></span>
      </button>
      <button className="launcher-item" onClick={onLock} aria-label={localize(language, 'Kunci Windows', 'Lock Windows')} title={localize(language, 'Kunci Windows', 'Lock Windows')}>
        <span className="launcher-item__icon"><LockKeyhole size={17} /></span>
        <span className="launcher-item__copy"><strong>{localize(language, 'Kunci', 'Lock')}</strong></span>
      </button>
    </motion.nav>
  );
}
