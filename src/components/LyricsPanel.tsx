import { useEffect, useMemo, useRef, useState } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { ExternalLink, Music2, RefreshCw } from 'lucide-react';
import { localize, type AppLanguage } from '../lib/i18n';
import {
  clearLyricsCacheEntry,
  fetchLyricsCached,
  getActiveLyricIndex,
  getCachedLyrics,
  parseLrc,
  type LyricsPayload
} from '../lib/lyrics';
import type { MediaProvider } from '../types';

interface LyricsPanelProps {
  title: string;
  artist: string;
  durationSeconds: number;
  positionSeconds: number;
  provider: MediaProvider | null;
  language: AppLanguage;
  onSeek: (seconds: number) => void;
}

export default function LyricsPanel({
  title,
  artist,
  durationSeconds,
  positionSeconds,
  provider,
  language,
  onSeek
}: LyricsPanelProps) {
  const [payload, setPayload] = useState<LyricsPayload | null>(() => getCachedLyrics(title, artist) ?? null);
  const [loading, setLoading] = useState(() => getCachedLyrics(title, artist) === undefined);
  const [retrySeq, setRetrySeq] = useState(0);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const activeLineRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setPayload(null);
      setLoading(false);
      return;
    }
    const cached = getCachedLyrics(trimmedTitle, artist);
    if (retrySeq === 0 && cached !== undefined) {
      setPayload(cached);
      setLoading(false);
      return;
    }

    let active = true;
    setLoading(true);
    void fetchLyricsCached(trimmedTitle, artist, durationSeconds).then((result) => {
      if (!active) return;
      setPayload(result);
      setLoading(false);
    });

    return () => {
      active = false;
    };
  }, [title, artist, durationSeconds, retrySeq]);

  const syncedLines = useMemo(
    () => (payload?.syncedLyrics ? parseLrc(payload.syncedLyrics) : []),
    [payload?.syncedLyrics]
  );

  const plainLines = useMemo(
    () => (payload?.plainLyrics
      ? payload.plainLyrics.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
      : []),
    [payload?.plainLyrics]
  );

  const activeIndex = useMemo(
    () => getActiveLyricIndex(syncedLines, positionSeconds),
    [syncedLines, positionSeconds]
  );

  // Smooth auto-scroll centered on the active line inside the 3-line viewport
  useEffect(() => {
    const container = scrollContainerRef.current;
    const activeEl = activeLineRef.current;
    if (!container || !activeEl) return;
    const targetTop = Math.max(
      0,
      activeEl.offsetTop - (container.clientHeight - activeEl.clientHeight) / 2
    );
    container.scrollTo({ top: targetTop, behavior: 'smooth' });
  }, [activeIndex, syncedLines.length]);

  // Smooth proportional auto-scroll for plain (unsynced) lyrics
  useEffect(() => {
    if (syncedLines.length > 0 || plainLines.length === 0 || durationSeconds <= 0) return;
    const container = scrollContainerRef.current;
    if (!container) return;
    const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight);
    if (maxScroll <= 0) return;
    const ratio = Math.max(0, Math.min(1, positionSeconds / durationSeconds));
    container.scrollTo({ top: maxScroll * ratio, behavior: 'smooth' });
  }, [syncedLines.length, plainLines.length, positionSeconds, durationSeconds]);

  const track = [title, artist].filter(Boolean).join(' ');
  const externalUrl = provider === 'spotify'
    ? `https://open.spotify.com/search/${encodeURIComponent(track)}`
    : provider === 'youtube-music'
      ? `https://music.youtube.com/search?q=${encodeURIComponent(track)}`
      : `https://www.google.com/search?q=${encodeURIComponent(`${track} lyrics`)}`;

  if (loading) {
    return (
      <div className="media-lyrics media-lyrics--loading" aria-busy="true">
        <span className="media-lyrics__skeleton" style={{ width: '68%' }} />
        <span className="media-lyrics__skeleton" style={{ width: '86%' }} />
        <span className="media-lyrics__skeleton" style={{ width: '56%' }} />
      </div>
    );
  }

  if (payload?.instrumental) {
    return (
      <div className="media-lyrics media-lyrics--empty">
        <Music2 size={14} />
        <p className="media-lyrics__status">{localize(language, 'Lagu instrumental ♪', 'Instrumental track ♪')}</p>
      </div>
    );
  }

  if (syncedLines.length > 0) {
    const targetIndex = activeIndex >= 0 ? activeIndex : 0;
    return (
      <div className="media-lyrics media-lyrics--synced" role="region" aria-label={localize(language, 'Lirik tersinkron', 'Synced lyrics')}>
        <div ref={scrollContainerRef} className="media-lyrics__scroll">
          {syncedLines.map((line, index) => {
            const isActive = index === targetIndex;
            const isPast = index < targetIndex;
            return (
              <button
                key={`${line.time}-${index}`}
                ref={isActive ? activeLineRef : undefined}
                type="button"
                className={`media-lyrics__line${isActive ? ' is-active' : ''}${isPast ? ' is-past' : ''}`}
                onClick={() => onSeek(line.time)}
                title={line.text}
              >
                {line.text}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  if (plainLines.length > 0) {
    return (
      <div className="media-lyrics media-lyrics--plain" role="region" aria-label={localize(language, 'Lirik lagu', 'Track lyrics')}>
        <div ref={scrollContainerRef} className="media-lyrics__scroll">
          {plainLines.map((line, index) => (
            <p key={index} className="media-lyrics__plain-line" title={line}>{line}</p>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="media-lyrics media-lyrics--empty">
      <p className="media-lyrics__status">
        {localize(language, 'Lirik belum ditemukan', 'Lyrics not found')}
      </p>
      <div className="media-lyrics__actions">
        <button
          className="media-lyrics__open"
          type="button"
          onClick={() => {
            clearLyricsCacheEntry(title, artist);
            setRetrySeq((seq) => seq + 1);
          }}
        >
          <RefreshCw size={11} />
          <span>{localize(language, 'Coba lagi', 'Retry')}</span>
        </button>
        <button
          className="media-lyrics__open"
          type="button"
          onClick={() => { void openUrl(externalUrl).catch(() => {}); }}
        >
          <span>{provider === 'spotify' ? 'Spotify' : provider === 'youtube-music' ? 'YT Music' : localize(language, 'Cari web', 'Web')}</span>
          <ExternalLink size={11} />
        </button>
      </div>
    </div>
  );
}
