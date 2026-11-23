import { useState } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { ExternalLink } from 'lucide-react';
import { localize, type AppLanguage } from './i18n';

interface LyricsPanelProps {
  title: string;
  artist: string;
  provider: 'spotify' | 'youtube-music';
  language: AppLanguage;
}

export default function LyricsPanel({ title, artist, provider, language }: LyricsPanelProps) {
  const [status, setStatus] = useState('');
  const track = [title, artist].filter(Boolean).join(' ');
  const url = provider === 'spotify'
    ? `https://open.spotify.com/search/${encodeURIComponent(track)}`
    : `https://music.youtube.com/search?q=${encodeURIComponent(track)}`;

  const openProvider = async () => {
    try {
      await openUrl(url);
      setStatus('');
    } catch (error) {
      console.error('Gagal membuka layanan musik:', error);
      setStatus(localize(language, 'Tidak dapat membuka layanan musik.', 'Could not open the music service.'));
    }
  };

  return (
    <div className="media-lyrics">
      <p className="media-lyrics__status">
        {localize(language, 'Lihat lirik dari layanan resmi:', 'View lyrics from the official service:')}
      </p>
      <button className="media-lyrics__open" type="button" onClick={() => { void openProvider(); }}>
        <span>{provider === 'spotify' ? 'Spotify' : 'YouTube Music'}</span>
        <ExternalLink size={13} />
      </button>
      {status && <p className="media-lyrics__status" role="status">{status}</p>}
    </div>
  );
}
