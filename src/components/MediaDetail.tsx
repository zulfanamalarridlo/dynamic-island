import { lazy, Suspense, useEffect, useMemo, useState, type MouseEvent } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { AnimatePresence, m, type Transition } from 'framer-motion';
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
  transition: Transition;
  onToggleLyrics: () => void;
  onTogglePin: () => void;
  onReturnToLauncher: () => void;
  onMediaAction: (action: 'previous' | 'playPause' | 'next') => void;
}

const WAVEFORM_BARS = 32;

function formatTrackTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

function buildTrackWaveform(seedText: string): number[] {
  let hash = 2166136261;
  for (let i = 0; i < seedText.length; i += 1) {
    hash ^= seedText.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const bars: number[] = [];
  for (let i = 0; i < WAVEFORM_BARS; i += 1) {
    hash = Math.imul(hash ^ (i * 2654435761), 1597334677);
    const pseudo = ((hash >>> 0) % 100) / 100;
    const envelope = Math.sin((i / (WAVEFORM_BARS - 1)) * Math.PI);
    const height = Math.round(26 + (pseudo * 0.65 + envelope * 0.35) * 74);
    bars.push(Math.max(24, Math.min(100, height)));
  }
  return bars;
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

  const waveformBars = useMemo(
    () => buildTrackWaveform(`${media.title}|${media.artist}`),
    [media.title, media.artist]
  );

  const handleSeekTo = (seconds: number) => {
    const clamped = Math.max(0, Math.min(media.duration_seconds || seconds, seconds));
    setLivePosition(clamped);
    void invoke('seek_media', { positionSeconds: clamped }).catch((error) => {
      console.warn('Gagal menggeser posisi lagu:', error);
    });
  };

  const handleWaveformClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (media.duration_seconds <= 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    handleSeekTo(ratio * media.duration_seconds);
  };

  const hasTrackTitle = Boolean(media.title.trim());
  const activeBarIndex = Math.min(
    WAVEFORM_BARS - 1,
    Math.floor((progress / 100) * WAVEFORM_BARS)
  );

  return (
    <m.section
      key="media-detail"
      className={`media-detail media-detail--wave${provider ? ` media-detail--${provider}` : ''}${showLyrics ? ' media-detail--with-lyrics' : ''}`}
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
        <span key={media.title || 'art'} className={`media-detail__art${artwork ? ' media-detail__art--loaded' : ''}${media.is_playing ? ' is-playing' : ''}`}>
          {artwork ? <img src={artwork} alt="" /> : <Music2 size={18} />}
          <span className="media-detail__art-sheen" aria-hidden="true" />
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
          <div className="media-detail__meta-row">
            <small>{media.artist || localize(language, 'Artis tidak diketahui', 'Unknown artist')}</small>
            {provider && (
              <span className="media-detail__provider">
                {provider === 'spotify' ? 'SPOTIFY' : 'YT MUSIC'}
              </span>
            )}
          </div>
        </div>

        <div className="media-detail__actions">
          {hasTrackTitle && (
            <button
              type="button"
              className={`media-detail__lyrics-toggle${showLyrics ? ' is-active' : ''}`}
              aria-label={showLyrics ? localize(language, 'Sembunyikan lirik', 'Hide lyrics') : localize(language, 'Tampilkan lirik', 'Show lyrics')}
              aria-pressed={showLyrics}
              title={showLyrics ? localize(language, 'Sembunyikan lirik', 'Hide lyrics') : localize(language, 'Tampilkan lirik', 'Show lyrics')}
              onClick={onToggleLyrics}
            >
              <Mic2 size={13} />
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
            <Pin size={13} />
          </button>
          <button
            type="button"
            className="detail-action-button"
            aria-label={localize(language, 'Tutup Now Playing', 'Close Now Playing')}
            title={localize(language, 'Tutup Now Playing', 'Close Now Playing')}
            onClick={(event) => { event.stopPropagation(); onReturnToLauncher(); }}
          >
            <X size={13} />
          </button>
        </div>
      </div>

      <div className="media-waveform-row">
        <span className="media-waveform__time">{formatTrackTime(livePosition)}</span>
        <button
          type="button"
          className={`media-waveform${media.is_playing ? ' is-playing' : ''}`}
          onClick={handleWaveformClick}
          disabled={media.duration_seconds <= 0}
          aria-label={localize(language, 'Geser posisi lagu', 'Seek track position')}
        >
          {waveformBars.map((barHeight, index) => {
            const barPercent = ((index + 0.5) / WAVEFORM_BARS) * 100;
            const isPlayed = barPercent <= progress;
            const isHead = index === activeBarIndex && media.duration_seconds > 0;
            return (
              <span
                key={index}
                className={`media-waveform__bar${isPlayed ? ' is-played' : ''}${isHead ? ' is-head' : ''}`}
                style={{
                  height: `${barHeight}%`,
                  animationDelay: `${(index % 7) * 0.09}s`
                }}
              />
            );
          })}
        </button>
        <span className="media-waveform__time">
          {media.duration_seconds > 0 ? formatTrackTime(media.duration_seconds) : '--:--'}
        </span>
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
          <SkipBack size={15} />
        </m.button>
        <m.button
          whileHover={{ scale: 1.08 }}
          whileTap={{ scale: 0.9 }}
          className="media-detail__play"
          aria-label={media.is_playing ? 'Pause' : 'Play'}
          title={media.is_playing ? 'Pause' : 'Play'}
          onClick={() => onMediaAction('playPause')}
        >
          {media.is_playing ? <Pause size={15} /> : <Play size={15} />}
        </m.button>
        <m.button
          whileHover={{ scale: 1.08 }}
          whileTap={{ scale: 0.9 }}
          aria-label={localize(language, 'Lagu berikutnya', 'Next track')}
          title={localize(language, 'Lagu berikutnya', 'Next track')}
          onClick={() => onMediaAction('next')}
        >
          <SkipForward size={15} />
        </m.button>
      </div>
    </m.section>
  );
}
