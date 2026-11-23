import { motion } from 'framer-motion';
import {
  Activity, BatteryCharging, Bell, Clipboard, ClipboardPaste, Copy, Keyboard, Music2, Plug,
  PlugZap, Scissors, Sun, Volume2, VolumeX, Wifi, WifiOff, X
} from 'lucide-react';
import { localize, type AppLanguage } from '../i18n';
import { getMediaProvider } from '../mediaUtils';
import type { AutoNotice } from '../types';

interface AutoNoticeCardProps {
  notice: AutoNotice;
  language: AppLanguage;
  artwork: string | null;
  travelX: number;
  travelY: number;
  transition: { duration: number; ease: number[] };
  onDismiss: () => void;
}

function getNoticeVisual(notice: AutoNotice) {
  const content = `${notice.title} ${notice.body}`.toLowerCase();
  if (notice.kind === 'media') return 'media';
  if (content.includes('wi-fi') || content.includes('wifi')) return 'wifi';
  if (content.includes('brightness') || content.includes('cahaya') || content.includes('kecerahan')) return 'brightness';
  if (content.includes('volume') || content.includes('microphone') || content.includes('speaker')) return 'sound';
  if (content.includes('power connected') || content.includes('power disconnected') || content.includes('plug')) return 'power';
  if (content.includes('battery')) return 'battery';
  if (content.includes('clipboard') || content.includes('copied') || content.includes('pasted') || content.includes('cut')) return 'clipboard';
  if (notice.kind === 'notification') return 'notification';
  return 'activity';
}

function getNoticeLabel(notice: AutoNotice, language: AppLanguage) {
  const content = `${notice.title} ${notice.body}`.toLowerCase();
  if (notice.kind === 'media') return localize(language, 'Sedang diputar', 'Now Playing');
  if (notice.kind === 'notification') return localize(language, 'Notifikasi', 'Notification');
  if (content.includes('wi-fi') || content.includes('wifi')) return localize(language, 'Konektivitas', 'Connectivity');
  if (content.includes('battery') || content.includes('power')) return localize(language, 'Daya', 'Power');
  if (content.includes('volume') || content.includes('microphone') || content.includes('speaker')) return localize(language, 'Suara', 'Sound');
  if (content.includes('brightness') || content.includes('cahaya') || content.includes('kecerahan')) return localize(language, 'Kecerahan', 'Brightness');
  if (content.includes('clipboard') || content.includes('copied') || content.includes('pasted') || content.includes('cut')) return 'Clipboard';
  return localize(language, 'Keyboard & Aktivitas', 'Keyboard & Activity');
}

function localizeActivityText(value: string, language: AppLanguage) {
  const fixedTranslations: Record<string, [string, string]> = {
    'Windows Activity': ['Aktivitas Windows', 'Windows Activity'],
    Copied: ['Disalin', 'Copied'],
    Cut: ['Dipotong', 'Cut'],
    Pasted: ['Ditempel', 'Pasted'],
    'Clipboard updated': ['Clipboard diperbarui', 'Clipboard updated'],
    'Clipboard activity': ['Aktivitas clipboard', 'Clipboard activity']
  };
  const translated = fixedTranslations[value];
  if (translated) return translated[language === 'id' ? 0 : 1];
  const parts = value.split(' · ').map((part) => {
    const state = part.match(/^(Caps Lock|Num Lock|Scroll Lock) (On|Off)$/);
    if (state) return language === 'id' ? `${state[1]} ${state[2] === 'On' ? 'Aktif' : 'Nonaktif'}` : `${state[1]} ${state[2]}`;
    const mute = part.match(/^(Microphone|Speaker) (Muted|On)$/);
    if (mute) {
      const device = language === 'id' ? (mute[1] === 'Microphone' ? 'Mikrofon' : 'Speaker') : mute[1];
      const status = language === 'id'
        ? (mute[2] === 'Muted' ? 'Dibisukan' : 'Aktif')
        : (mute[2] === 'Muted' ? 'Muted' : 'On');
      return `${device} ${status}`;
    }
    const volume = part.match(/^Volume (\d+%)$/);
    if (volume) return `${localize(language, 'Volume', 'Volume')} ${volume[1]}`;
    return fixedTranslations[part]?.[language === 'id' ? 0 : 1] ?? part;
  });
  return parts.join(' · ');
}

function getNoticeIcon(notice: AutoNotice) {
  const content = `${notice.title} ${notice.body}`.toLowerCase();
  if (notice.kind === 'media') return <Music2 size={18} />;
  if (notice.kind === 'notification') return <Bell size={18} />;
  if (content.includes('wi-fi') || content.includes('wifi')) return content.includes('disconnected') ? <WifiOff size={18} /> : <Wifi size={18} />;
  if (content.includes('battery')) return <BatteryCharging size={18} />;
  if (content.includes('power')) return content.includes('disconnected') ? <Plug size={18} /> : <PlugZap size={18} />;
  if (content.includes('volume') || content.includes('microphone') || content.includes('speaker')) return content.includes('muted') ? <VolumeX size={18} /> : <Volume2 size={18} />;
  if (content.includes('pasted')) return <ClipboardPaste size={18} />;
  if (content.includes('copied')) return <Copy size={18} />;
  if (content.includes('cut')) return <Scissors size={18} />;
  if (content.includes('clipboard')) return <Clipboard size={18} />;
  if (content.includes('brightness') || content.includes('cahaya') || content.includes('kecerahan')) return <Sun size={18} />;
  if (notice.kind === 'activity') return <Keyboard size={18} />;
  return <Activity size={18} />;
}

export default function AutoNoticeCard({
  notice, language, artwork, travelX, travelY, transition, onDismiss
}: AutoNoticeCardProps) {
  const visual = getNoticeVisual(notice);
  const provider = notice.media ? getMediaProvider(notice.media.source_app) : null;
  const brightnessLevel = Number(`${notice.title} ${notice.body}`.match(/\d+(?:\.\d+)?/)?.[0] ?? 65);

  return (
    <motion.div
      key={`auto-notice-${notice.kind}-${notice.title}-${notice.body}`}
      className={`auto-notice auto-notice--${visual}${provider === 'youtube-music' ? ' auto-notice--youtube-music' : ''}`}
      initial={{ opacity: 0, x: travelX, y: travelY, scale: 0.985, filter: 'blur(2px)' }}
      animate={{ opacity: 1, x: 0, y: 0, scale: 1, filter: 'blur(0px)' }}
      exit={{ opacity: 0, x: travelX, y: travelY, scale: 0.99, filter: 'blur(1px)' }}
      transition={transition}
    >
      <motion.span
        className={`auto-notice__icon${artwork && notice.kind === 'media' ? ' auto-notice__icon--art' : ''}`}
        aria-hidden="true"
        animate={visual === 'power'
          ? { rotate: [0, -12, 8, 0], scale: [1, 1.08, 1] }
          : visual === 'clipboard'
            ? { y: [0, -3, 0], rotate: [0, -5, 0] }
            : visual === 'wifi'
              ? { scale: [1, 1.12, 1] }
              : visual === 'brightness'
                ? { rotate: [0, 18, 0], scale: [1, 1.12, 1] }
                : visual === 'sound'
                  ? { scale: [1, 1.1, 1] }
                  : { y: [0, -2, 0] }}
        transition={{ duration: 0.8, ease: 'easeInOut' }}
      >
        {artwork && notice.kind === 'media' ? <img src={artwork} alt="" /> : getNoticeIcon(notice)}
      </motion.span>
      <div className="auto-notice__content">
        <span className="auto-notice__label">{getNoticeLabel(notice, language)}</span>
        <strong>{notice.kind === 'activity' || notice.kind === 'system' ? localizeActivityText(notice.title, language) : notice.title}</strong>
        {notice.kind === 'media' && notice.media?.artist
          ? <p>{notice.media.artist}</p>
          : notice.body && <p>{notice.kind === 'activity' || notice.kind === 'system' ? localizeActivityText(notice.body, language) : notice.body}</p>}
        {notice.volumeLevel !== undefined && (
          <div className="notice-meter" role="img" aria-label={`${localize(language, 'Volume', 'Volume')} ${Math.round(notice.volumeLevel)}%`}>
            <motion.span
              initial={{ width: `${Math.max(0, Math.min(notice.previousVolumeLevel ?? 0, 100))}%` }}
              animate={{ width: `${Math.max(0, Math.min(notice.volumeLevel, 100))}%` }}
              transition={{ duration: 0.45, ease: 'easeOut' }}
            />
          </div>
        )}
        {visual === 'brightness' && /\d/.test(`${notice.title} ${notice.body}`) && (
          <div className="notice-meter notice-meter--brightness" aria-hidden="true">
            <motion.span
              initial={{ width: '20%' }}
              animate={{ width: `${Math.max(10, Math.min(brightnessLevel, 100))}%` }}
              transition={{ duration: 0.55, ease: 'easeOut' }}
            />
          </div>
        )}
      </div>
      <button
        className="auto-notice__dismiss"
        aria-label={localize(language, 'Tutup notifikasi', 'Dismiss notification')}
        title={localize(language, 'Tutup', 'Dismiss')}
        onClick={(event) => { event.stopPropagation(); onDismiss(); }}
      >
        <X size={15} />
      </button>
    </motion.div>
  );
}
