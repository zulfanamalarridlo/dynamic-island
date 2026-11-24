import { useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import { ExternalLink, Music2, RefreshCw } from 'lucide-react';
import { localize, type AppLanguage } from '../lib/i18n';
import type { MediaProvider } from '../types';

interface LyricsPayload {
  syncedLyrics: string | null;
  plainLyrics: string | null;
  instrumental: boolean;
}

interface SyncedLine {
  time: number;
  text: string;
}

interface LyricsPanelProps {
  title: string;
  artist: string;
  durationSeconds: number;
  positionSeconds: number;
  provider: MediaProvider | null;
  language: AppLanguage;
  onSeek: (seconds: number) => void;
}

const lyricsCache = new Map<string, LyricsPayload | null>();

function parseLrc(raw: string): SyncedLine[] {
  const lines: SyncedLine[] = [];
  const pattern = /\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]/g;
  for (const row of raw.split(/\r?\n/)) {
    const timestamps: number[] = [];
    let match: RegExpExecArray | null;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(row)) !== null) {
      const minutes = Number(match[1]);
      const seconds = Number(match[2]);
      const frac = match[3] ? Number(match[3].padEnd(3, '0')) / 1000 : 0;
      timestamps.push(minutes * 60 + seconds + frac);
    }
    const text = row.replace(pattern, '').trim();
    if (!timestamps.length || !text) continue;
    for (const time of timestamps) {
      lines.push({ time, text });
    }
  }
  lines.sort((a, b) => a.time - b.time);
  return lines;
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
  const cacheKey = `${title.trim().toLowerCase()}|${artist.trim().toLowerCase()}`;
  const [payload, setPayload] = useState<LyricsPayload | null>(() => lyricsCache.get(cacheKey) ?? null);
  const [loading, setLoading] = useState(() => !lyricsCache.has(cacheKey));
  const [retrySeq, setRetrySeq] = useState(0);
  const activeLineRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setPayload(null);
      setLoading(false);
      return;
    }
    if (retrySeq === 0 && lyricsCache.has(cacheKey)) {
      setPayload(lyricsCache.get(cacheKey) ?? null);
      setLoading(false);
      return;
    }

    let active = true;
    setLoading(true);
    void invoke<LyricsPayload>('fetch_synced_lyrics', {
      title: trimmedTitle,
      artist: artist.trim(),
      durationSeconds
    })
      .then((result) => {
        if (!active) return;
        lyricsCache.set(cacheKey, result);
        setPayload(result);
        setLoading(false);
      })
      .catch(() => {
        if (!active) return;
        lyricsCache.set(cacheKey, null);
        setPayload(null);
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [cacheKey, title, artist, durationSeconds, retrySeq]);

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

  const activeIndex = useMemo(() => {
    if (!syncedLines.length) return -1;
    let index = -1;
    for (let i = 0; i < syncedLines.length; i += 1) {
      if (syncedLines[i].time <= positionSeconds + 0.35) {
        index = i;
      } else {
        break;
      }
    }
    return index;
  }, [syncedLines, positionSeconds]);

  useEffect(() => {
    if (activeIndex < 0) return;
    activeLineRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [activeIndex]);

  const track = [title, artist].filter(Boolean).join(' ');
  const externalUrl = provider === 'spotify'
    ? `https://open.spotify.com/search/${encodeURIComponent(track)}`
    : provider === 'youtube-music'
      ? `https://music.youtube.com/search?q=${encodeURIComponent(track)}`
      : `https://www.google.com/search?q=${encodeURIComponent(`${track} lyrics`)}`;

  if (loading) {
    return (
      <div className="media-lyrics media-lyrics--loading" aria-busy="true">
        <span className="media-lyrics__skeleton" style={{ width: '72%' }} />
        <span className="media-lyrics__skeleton" style={{ width: '90%' }} />
        <span className="media-lyrics__skeleton" style={{ width: '60%' }} />
      </div>
    );
  }

  if (payload?.instrumental) {
    return (
      <div className="media-lyrics media-lyrics--empty">
        <Music2 size={16} />
        <p className="media-lyrics__status">{localize(language, 'Lagu instrumental ♪', 'Instrumental track ♪')}</p>
      </div>
    );
  }

  if (syncedLines.length > 0) {
    return (
      <div className="media-lyrics media-lyrics--synced" role="region" aria-label={localize(language, 'Lirik tersinkron', 'Synced lyrics')}>
        <div className="media-lyrics__scroll">
          {syncedLines.map((line, index) => {
            const isActive = index === activeIndex;
            const isPast = activeIndex >= 0 && index < activeIndex;
            return (
              <button
                key={`${line.time}-${index}`}
                ref={isActive ? activeLineRef : undefined}
                type="button"
                className={`media-lyrics__line${isActive ? ' is-active' : ''}${isPast ? ' is-past' : ''}`}
                onClick={() => onSeek(line.time)}
                title={localize(language, 'Klik untuk lompat ke bagian ini', 'Click to jump to this line')}
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
        <div className="media-lyrics__scroll">
          {plainLines.map((line, index) => (
            <p key={index} className="media-lyrics__plain-line">{line}</p>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="media-lyrics media-lyrics--empty">
      <p className="media-lyrics__status">
        {localize(language, 'Lirik belum ditemukan.', 'Lyrics not found.')}
      </p>
      <div className="media-lyrics__actions">
        <button
          className="media-lyrics__open"
          type="button"
          onClick={() => {
            lyricsCache.delete(cacheKey);
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
          <span>{provider === 'spotify' ? 'Spotify' : provider === 'youtube-music' ? 'YT Music' : localize(language, 'Cari web', 'Web search')}</span>
          <ExternalLink size={11} />
        </button>
      </div>
    </div>
  );
}
