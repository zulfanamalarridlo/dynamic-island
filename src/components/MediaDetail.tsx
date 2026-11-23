import { lazy, Suspense } from 'react';
import { AnimatePresence, m } from 'framer-motion';
import { AlignLeft, Music2, Pause, Pin, Play, SkipBack, SkipForward, X } from 'lucide-react';
import { localize, type AppLanguage } from '../lib/i18n';
import type { MediaInfo, MediaProvider } from '../types';

const LyricsPanel = lazy(() => import('./LyricsPanel'));

interface MediaDetailProps {
  media: MediaInfo;
  provider: MediaProvider | null;
  artwork: string | null;
  language: AppLanguage;
  showLyrics: boolean;
  pinned: boolean;
  travelX: number;
  travelY: number;
  transition: { duration: number; ease: number[] };
  onToggleLyrics: () => void;
  onTogglePin: () => void;
  onReturnToLauncher: () => void;
  onMediaAction: (action: 'previous' | 'playPause' | 'next') => void;
}

export default function MediaDetail({
  media, provider, artwork, language, showLyrics, pinned, travelX, travelY, transition,
  onToggleLyrics, onTogglePin, onReturnToLauncher, onMediaAction
}: MediaDetailProps) {
  const progress = media.duration_seconds > 0
    ? Math.max(0, Math.min(100, media.position_seconds / media.duration_seconds * 100))
    : 0;

  return (
    <m.section
      key="media-detail"
      className={`media-detail${provider ? ` media-detail--${provider}` : ''}`}
      initial={{ opacity: 0, x: travelX, y: travelY, scale: 0.99 }}
      animate={{ opacity: 1, x: 0, y: 0, scale: 1 }}
      exit={{ opacity: 0, x: travelX, y: travelY, scale: 0.995 }}
      transition={transition}
      aria-label={localize(language, 'Kontrol media', 'Now Playing controls')}
    >
      <div className="media-detail__heading">
        <span className={`media-detail__art${artwork ? ' media-detail__art--loaded' : ''}${media.is_playing ? ' is-playing' : ''}`}>
          {artwork ? <img src={artwork} alt="" /> : <Music2 size={20} />}
          <span className={`media-detail__equalizer${media.is_playing ? ' is-playing' : ''}`} aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
        </span>
        <div className="media-detail__copy">
          <AnimatePresence mode="wait" initial={false}>
            <m.strong
              key={media.title}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -3 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
            >
              {media.title || localize(language, 'Lagu tidak diketahui', 'Unknown track')}
            </m.strong>
          </AnimatePresence>
          <small>{media.artist || localize(language, 'Artis tidak diketahui', 'Unknown artist')}</small>
          {provider && <span className="media-detail__provider">{provider === 'spotify' ? 'SPOTIFY' : 'YOUTUBE MUSIC'}</span>}
        </div>
        {provider && (
          <button
            type="button"
            className={`media-detail__lyrics-toggle${showLyrics ? ' is-active' : ''}`}
            aria-label={showLyrics ? localize(language, 'Sembunyikan lirik', 'Hide lyrics') : localize(language, 'Tampilkan lirik', 'Show lyrics')}
            title={showLyrics ? localize(language, 'Sembunyikan lirik', 'Hide lyrics') : localize(language, 'Tampilkan lirik', 'Show lyrics')}
            onClick={onToggleLyrics}
          >
            <AlignLeft size={15} />
          </button>
        )}
        <button
          type="button"
          className={`detail-action-button detail-action-button--pin${pinned ? ' is-active' : ''}`}
          aria-label={pinned ? localize(language, 'Lepas sematan musik', 'Unpin music') : localize(language, 'Sematkan musik', 'Pin music')}
          aria-pressed={pinned}
          title={pinned ? localize(language, 'Lepas sematan musik', 'Unpin music') : localize(language, 'Sematkan musik', 'Pin music')}
          onClick={onTogglePin}
        >
          <Pin size={14} />
        </button>
        <button
          type="button"
          className="detail-action-button"
          aria-label={localize(language, 'Tutup Now Playing', 'Close Now Playing')}
          title={localize(language, 'Tutup Now Playing', 'Close Now Playing')}
          onClick={(event) => { event.stopPropagation(); onReturnToLauncher(); }}
        >
          <X size={15} />
        </button>
      </div>
      <div className="media-detail__progress" role="img" aria-label={localize(language, 'Posisi lagu', 'Track progress')}>
        <span style={{ width: `${progress}%` }} />
      </div>
      {showLyrics && provider && (
        <Suspense fallback={null}>
          <LyricsPanel
            title={media.title}
            artist={media.artist}
            provider={provider}
            language={language}
          />
        </Suspense>
      )}
      <div className="media-detail__controls">
        <m.button
          whileHover={{ scale: 1.08 }}
          whileTap={{ scale: 0.9 }}
          aria-label={localize(language, 'Lagu sebelumnya', 'Previous track')}
          title={localize(language, 'Lagu sebelumnya', 'Previous track')}
          onClick={() => onMediaAction('previous')}
        >
          <SkipBack size={17} />
        </m.button>
        <m.button
          whileHover={{ scale: 1.08 }}
          whileTap={{ scale: 0.9 }}
          className="media-detail__play"
          aria-label={media.is_playing ? 'Pause' : 'Play'}
          title={media.is_playing ? 'Pause' : 'Play'}
          onClick={() => onMediaAction('playPause')}
        >
          {media.is_playing ? <Pause size={17} /> : <Play size={17} />}
        </m.button>
        <m.button
          whileHover={{ scale: 1.08 }}
          whileTap={{ scale: 0.9 }}
          aria-label={localize(language, 'Lagu berikutnya', 'Next track')}
          title={localize(language, 'Lagu berikutnya', 'Next track')}
          onClick={() => onMediaAction('next')}
        >
          <SkipForward size={17} />
        </m.button>
      </div>
    </m.section>
  );
}
