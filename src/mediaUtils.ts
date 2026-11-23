import type { MediaProvider } from './types';

export function getMediaProvider(sourceApp: string): MediaProvider | null {
  const source = sourceApp.toLowerCase();
  if (source.includes('spotify')) return 'spotify';
  if (
    (source.includes('youtube') && source.includes('music'))
    || source.includes('youtube-music')
    || source.includes('com.github.th-ch.youtube-music')
  ) return 'youtube-music';
  return null;
}
