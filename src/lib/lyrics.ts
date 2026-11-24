import { invoke } from '@tauri-apps/api/core';

export interface LyricsPayload {
  syncedLyrics: string | null;
  plainLyrics: string | null;
  instrumental: boolean;
}

export interface SyncedLine {
  time: number;
  text: string;
}

const lyricsCache = new Map<string, LyricsPayload | null>();
const inflightRequests = new Map<string, Promise<LyricsPayload | null>>();

export function getLyricsCacheKey(title: string, artist: string): string {
  return `${title.trim().toLowerCase()}|${artist.trim().toLowerCase()}`;
}

export function getCachedLyrics(title: string, artist: string): LyricsPayload | null | undefined {
  const key = getLyricsCacheKey(title, artist);
  if (!lyricsCache.has(key)) return undefined;
  return lyricsCache.get(key) ?? null;
}

export function clearLyricsCacheEntry(title: string, artist: string): void {
  lyricsCache.delete(getLyricsCacheKey(title, artist));
}

export function fetchLyricsCached(
  title: string,
  artist: string,
  durationSeconds: number
): Promise<LyricsPayload | null> {
  const trimmedTitle = title.trim();
  if (!trimmedTitle) return Promise.resolve(null);
  const key = getLyricsCacheKey(trimmedTitle, artist);
  if (lyricsCache.has(key)) {
    return Promise.resolve(lyricsCache.get(key) ?? null);
  }
  const existing = inflightRequests.get(key);
  if (existing) return existing;

  const request = invoke<LyricsPayload>('fetch_synced_lyrics', {
    title: trimmedTitle,
    artist: artist.trim(),
    durationSeconds
  })
    .then((result) => {
      lyricsCache.set(key, result);
      return result;
    })
    .catch(() => {
      lyricsCache.set(key, null);
      return null;
    })
    .finally(() => {
      inflightRequests.delete(key);
    });

  inflightRequests.set(key, request);
  return request;
}

export function parseLrc(raw: string): SyncedLine[] {
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

export function getActiveLyricIndex(lines: SyncedLine[], positionSeconds: number): number {
  if (!lines.length) return -1;
  let index = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].time <= positionSeconds + 0.35) {
      index = i;
    } else {
      break;
    }
  }
  return index;
}

