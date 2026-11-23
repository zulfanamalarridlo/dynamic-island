import { AnimatePresence, motion } from 'framer-motion';
import { AlignLeft, Music2, Pause, Play, SkipBack, SkipForward, X } from 'lucide-react';
import LyricsPanel from '../LyricsPanel';
import { localize, type AppLanguage } from '../i18n';
import type { MediaInfo, MediaProvider } from '../types';

interface MediaDetailProps {
  media: MediaInfo;
  provider: MediaProvider | null;
  artwork: string | null;
  language: AppLanguage;
  showLyrics: boolean;
  travelX: number;
  travelY: number;
  transition: { duration: number; ease: number[] };
  onToggleLyrics: () => void;
  onReturnToLauncher: () => void;
  onMediaAction: (action: 'previous' | 'playPause' | 'next') => void;
}

export default function MediaDetail({
  media, provider, artwork, language, showLyrics, travelX, travelY, transition,
  onToggleLyrics, onReturnToLauncher, onMediaAction
}: MediaDetailProps) {
  const progress = media.duration_seconds > 0
    ? Math.max(0, Math.min(100, media.position_seconds / media.duration_seconds * 100))
    : 0;

  return (
    <motion.section
      key="media-detail"
      className={`media-detail${provider ? ` media-detail--${provider}` : ''}`}
      initial={{ opacity: 0, x: travelX, y: travelY, scale: 0.99, filter: 'blur(2px)' }}
      animate={{ opacity: 1, x: 0, y: 0, scale: 1, filter: 'blur(0px)' }}
      exit={{ opacity: 0, x: travelX, y: travelY, scale: 0.995, filter: 'blur(1px)' }}
      transition={transition}
      aria-label={localize(language, 'Kontrol media', 'Now Playing controls')}
    >
      <div className="media-detail__heading">
        <motion.span
          className={`media-detail__art${artwork ? ' media-detail__art--loaded' : ''}`}
          animate={media.is_playing ? { scale: [1, 1.035, 1], rotate: [0, -2, 2, 0] } : { scale: 1, rotate: 0 }}
          transition={{ duration: 3, ease: 'easeInOut', repeat: media.is_playing ? Infinity : 0 }}
        >
          {artwork ? <img src={artwork} alt="" /> : <Music2 size={20} />}
          <span className="media-detail__equalizer" aria-hidden="true">
            {[0, 1, 2].map((bar) => (
              <motion.i
                key={bar}
                animate={media.is_playing ? { height: ['4px', '12px', '6px', '10px', '4px'] } : { height: '4px' }}
                transition={{ duration: 0.9 + bar * 0.17, ease: 'easeInOut', repeat: media.is_playing ? Infinity : 0, delay: bar * 0.12 }}
              />
            ))}
          </span>
        </motion.span>
        <div className="media-detail__copy">
          <AnimatePresence mode="wait" initial={false}>
            <motion.strong
              key={media.title}
              initial={{ opacity: 0, y: 5, filter: 'blur(2px)' }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              exit={{ opacity: 0, y: -4, filter: 'blur(2px)' }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
            >
              {media.title || localize(language, 'Lagu tidak diketahui', 'Unknown track')}
            </motion.strong>
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
          className="auto-notice__dismiss"
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
        <LyricsPanel
          title={media.title}
          artist={media.artist}
          provider={provider}
          language={language}
        />
      )}
      <div className="media-detail__controls">
        <button aria-label={localize(language, 'Lagu sebelumnya', 'Previous track')} title={localize(language, 'Lagu sebelumnya', 'Previous track')} onClick={() => onMediaAction('previous')}>
          <SkipBack size={17} />
        </button>
        <button className="media-detail__play" aria-label={media.is_playing ? 'Pause' : 'Play'} title={media.is_playing ? 'Pause' : 'Play'} onClick={() => onMediaAction('playPause')}>
          {media.is_playing ? <Pause size={17} /> : <Play size={17} />}
        </button>
        <button aria-label={localize(language, 'Lagu berikutnya', 'Next track')} title={localize(language, 'Lagu berikutnya', 'Next track')} onClick={() => onMediaAction('next')}>
          <SkipForward size={17} />
        </button>
      </div>
    </motion.section>
  );
}
