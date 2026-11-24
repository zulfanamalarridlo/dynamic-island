import { lazy, Suspense, useEffect, useState, type MouseEvent } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { AnimatePresence, m } from 'framer-motion';
import { Mic2, Music2, Pause, Pin, Play, SkipBack, SkipForward, X } from 'lucide-react';
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

function formatTrackTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

export default function MediaDetail({
  media, provider, artwork, language, showLyrics, pinned, travelX, travelY, transition,
  onToggleLyrics, onTogglePin, onReturnToLauncher, onMediaAction
}: MediaDetailProps) {
  const [livePosition, setLivePosition] = useState(media.position_seconds);

  useEffect(() => {
    setLivePosition(media.position_seconds);
  }, [media.position_seconds, media.title, media.artist]);

  useEffect(() => {
    if (!media.is_playing || media.duration_seconds <= 0) return;
    const timer = window.setInterval(() => {
      setLivePosition((current) => Math.min(media.duration_seconds, current + 0.25));
    }, 250);
    return () => window.clearInterval(timer);
  }, [media.is_playing, media.duration_seconds]);

  const progress = media.duration_seconds > 0
    ? Math.max(0, Math.min(100, (livePosition / media.duration_seconds) * 100))
    : 0;

  const handleSeekTo = (seconds: number) => {
    const clamped = Math.max(0, Math.min(media.duration_seconds || seconds, seconds));
    setLivePosition(clamped);
    void invoke('seek_media', { positionSeconds: clamped }).catch((error) => {
      console.warn('Gagal menggeser posisi lagu:', error);
    });
  };

  const handleProgressClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (media.duration_seconds <= 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    handleSeekTo(ratio * media.duration_seconds);
  };

  const hasTrackTitle = Boolean(media.title.trim());

  return (
    <m.section
      key="media-detail"
      className={`media-detail${provider ? ` media-detail--${provider}` : ''}${showLyrics ? ' media-detail--with-lyrics' : ''}`}
      initial={{ opacity: 0, x: travelX, y: travelY, scale: 0.99 }}
      animate={{ opacity: 1, x: 0, y: 0, scale: 1 }}
      exit={{ opacity: 0, x: travelX, y: travelY, scale: 0.995 }}
      transition={transition}
      aria-label={localize(language, 'Kontrol media', 'Now Playing controls')}
    >
      {artwork && (
        <span
          className="media-detail__backdrop"
          style={{ backgroundImage: `url(${artwork})` }}
          aria-hidden="true"
        />
      )}

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
          <div className="media-detail__meta-row">
            {provider && (
              <span className="media-detail__provider">
                {provider === 'spotify' ? 'SPOTIFY' : 'YT MUSIC'}
              </span>
            )}
            <span className={`media-detail__visualizer${media.is_playing ? ' is-playing' : ''}`} aria-hidden="true">
              <i /><i /><i /><i /><i />
            </span>
          </div>
        </div>
        {hasTrackTitle && (
          <button
            type="button"
            className={`media-detail__lyrics-toggle${showLyrics ? ' is-active' : ''}`}
            aria-label={showLyrics ? localize(language, 'Sembunyikan lirik', 'Hide lyrics') : localize(language, 'Tampilkan lirik', 'Show lyrics')}
            aria-pressed={showLyrics}
            title={showLyrics ? localize(language, 'Sembunyikan lirik', 'Hide lyrics') : localize(language, 'Tampilkan lirik', 'Show lyrics')}
            onClick={onToggleLyrics}
          >
            <Mic2 size={14} />
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

      <div className="media-detail__progress-wrap">
        <button
          type="button"
          className="media-detail__progress-hit"
          onClick={handleProgressClick}
          disabled={media.duration_seconds <= 0}
          aria-label={localize(language, 'Geser posisi lagu', 'Seek track position')}
        >
          <span className="media-detail__progress">
            <span className="media-detail__progress-fill" style={{ width: `${progress}%` }} />
          </span>
        </button>
        <div className="media-detail__times">
          <span>{formatTrackTime(livePosition)}</span>
          <span>{media.duration_seconds > 0 ? formatTrackTime(media.duration_seconds) : '--:--'}</span>
        </div>
      </div>

      {showLyrics && hasTrackTitle && (
        <Suspense fallback={null}>
          <LyricsPanel
            title={media.title}
            artist={media.artist}
            durationSeconds={media.duration_seconds}
            positionSeconds={livePosition}
            provider={provider}
            language={language}
            onSeek={handleSeekTo}
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
          <SkipBack size={16} />
        </m.button>
        <m.button
          whileHover={{ scale: 1.08 }}
          whileTap={{ scale: 0.9 }}
          className="media-detail__play"
          aria-label={media.is_playing ? 'Pause' : 'Play'}
          title={media.is_playing ? 'Pause' : 'Play'}
          onClick={() => onMediaAction('playPause')}
        >
          {media.is_playing ? <Pause size={16} /> : <Play size={16} />}
        </m.button>
        <m.button
          whileHover={{ scale: 1.08 }}
          whileTap={{ scale: 0.9 }}
          aria-label={localize(language, 'Lagu berikutnya', 'Next track')}
          title={localize(language, 'Lagu berikutnya', 'Next track')}
          onClick={() => onMediaAction('next')}
        >
          <SkipForward size={16} />
        </m.button>
      </div>
    </m.section>
  );
}
