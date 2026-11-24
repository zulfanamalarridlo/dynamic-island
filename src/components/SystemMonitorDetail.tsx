import { useEffect, useState, type ReactNode } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Activity, Battery, BatteryCharging, Cpu, HardDrive, Mic, MicOff, Pin, Volume2, VolumeX, Wifi, X } from 'lucide-react';
import { m, type Transition } from 'framer-motion';
import { localize, type AppLanguage } from '../lib/i18n';

interface SystemMonitorDetailProps {
  language: AppLanguage;
  cpuUsage: number | null;
  memoryUsedBytes: number | null;
  memoryTotalBytes: number | null;
  batteryAvailable: boolean;
  batteryLevel: number;
  batteryColor: string;
  batteryCharging: boolean;
  pinned: boolean;
  onTogglePin: () => void;
  isWifiConnected: boolean;
  activeWifiName: string;
  netRxBytesPerSec: number | null;
  netTxBytesPerSec: number | null;
  volume: number;
  outputMuted: boolean;
  microphoneMuted: boolean;
  travelX: number;
  travelY: number;
  transition: Transition;
  onClose: () => void;
}

interface MetricCardProps {
  icon: ReactNode;
  label: string;
  value: string;
  detail: string;
  percentage: number;
  color: string;
  index: number;
}

function MetricCard({ icon, label, value, detail, percentage, color, index }: MetricCardProps) {
  return (
    <m.article
      className="system-monitor__metric"
      initial={{ opacity: 0, y: 6, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.24, delay: index * 0.045, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="system-monitor__metric-heading">
        <span className="system-monitor__metric-icon" style={{ color }}>{icon}</span>
        <span>{label}</span>
      </div>
      <strong className="system-monitor__metric-value">{value}</strong>
      <small className="system-monitor__metric-detail" title={detail}>{detail}</small>
      <span className="system-monitor__meter" aria-hidden="true">
        <span style={{ width: `${percentage}%`, backgroundColor: color }} />
      </span>
    </m.article>
  );
}

function formatMemory(bytes: number | null, language: AppLanguage): string {
  if (bytes === null || !Number.isFinite(bytes)) return '—';
  const gigabytes = bytes / 1024 ** 3;
  return `${new Intl.NumberFormat(language === 'id' ? 'id-ID' : 'en-US', {
    maximumFractionDigits: 1
  }).format(gigabytes)} GB`;
}

function formatNetSpeed(bytesPerSec: number | null): string {
  if (bytesPerSec === null || !Number.isFinite(bytesPerSec) || bytesPerSec < 0) return '0 B/s';
  if (bytesPerSec >= 1024 * 1024) return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
  if (bytesPerSec >= 1024) return `${Math.round(bytesPerSec / 1024)} KB/s`;
  return `${Math.round(bytesPerSec)} B/s`;
}

export default function SystemMonitorDetail({
  language, cpuUsage, memoryUsedBytes, memoryTotalBytes, batteryAvailable, batteryLevel,
  batteryColor, batteryCharging, pinned, onTogglePin, isWifiConnected, activeWifiName,
  netRxBytesPerSec, netTxBytesPerSec, volume, outputMuted, microphoneMuted, travelX, travelY, transition, onClose
}: SystemMonitorDetailProps) {
  const [localVolume, setLocalVolume] = useState(() => Math.round(Number.isFinite(volume) ? volume : 50));
  const [localOutMuted, setLocalOutMuted] = useState(outputMuted);
  const [localMicMuted, setLocalMicMuted] = useState(microphoneMuted);

  useEffect(() => {
    if (Number.isFinite(volume)) setLocalVolume(Math.round(volume));
  }, [volume]);
  useEffect(() => setLocalOutMuted(outputMuted), [outputMuted]);
  useEffect(() => setLocalMicMuted(microphoneMuted), [microphoneMuted]);

  const handleVolumeChange = (next: number) => {
    setLocalVolume(next);
    void invoke('set_system_volume', { volume: next }).catch(() => {});
  };

  const handleToggleSpeaker = () => {
    setLocalOutMuted((current) => !current);
    void invoke<boolean>('toggle_output_mute')
      .then((muted) => setLocalOutMuted(muted))
      .catch(() => {});
  };

  const handleToggleMic = () => {
    setLocalMicMuted((current) => !current);
    void invoke<boolean>('toggle_microphone_mute')
      .then((muted) => setLocalMicMuted(muted))
      .catch(() => {});
  };
  const memoryPercentage = memoryUsedBytes !== null && memoryTotalBytes !== null && memoryTotalBytes > 0
    ? Math.min(100, Math.max(0, memoryUsedBytes / memoryTotalBytes * 100))
    : 0;
  const safeCpuUsage = cpuUsage !== null && Number.isFinite(cpuUsage)
    ? Math.min(100, Math.max(0, cpuUsage))
    : null;
  const networkColor = isWifiConnected ? '#65c9a5' : '#8993a0';

  return (
    <m.section
      key="system-monitor"
      className="system-monitor-detail"
      initial={{ opacity: 0, x: travelX, y: travelY, scale: 0.99 }}
      animate={{ opacity: 1, x: 0, y: 0, scale: 1 }}
      exit={{ opacity: 0, x: travelX, y: travelY, scale: 0.995 }}
      transition={transition}
      aria-label={localize(language, 'Monitor sistem', 'System monitor')}
    >
      <header className="system-monitor__header">
        <span className="system-monitor__header-icon"><Activity size={18} /></span>
        <div>
          <strong>{localize(language, 'Monitor Sistem', 'System Monitor')}</strong>
          <small>{localize(language, 'Penggunaan perangkat', 'Device usage')}</small>
        </div>
        <button
          type="button"
          className={`detail-action-button detail-action-button--pin${pinned ? ' is-active' : ''}`}
          aria-label={pinned
            ? localize(language, 'Lepas sematan monitor sistem', 'Unpin system monitor')
            : localize(language, 'Sematkan semua monitor sistem', 'Pin all system metrics')}
          aria-pressed={pinned}
          title={pinned
            ? localize(language, 'Lepas sematan monitor sistem', 'Unpin system monitor')
            : localize(language, 'Sematkan semua monitor sistem', 'Pin all system metrics')}
          onClick={(event) => {
            event.stopPropagation();
            onTogglePin();
          }}
        >
          <Pin size={14} />
        </button>
        <button
          type="button"
          className="detail-action-button"
          aria-label={localize(language, 'Tutup monitor sistem', 'Close system monitor')}
          title={localize(language, 'Tutup', 'Close')}
          onClick={(event) => { event.stopPropagation(); onClose(); }}
        >
          <X size={15} />
        </button>
      </header>
      <div className="system-monitor__grid">
        <MetricCard
          index={0}
          icon={<Cpu size={15} />}
          label="CPU"
          value={safeCpuUsage === null ? '—' : `${Math.round(safeCpuUsage)}%`}
          detail={localize(language, 'Penggunaan prosesor', 'Processor usage')}
          percentage={safeCpuUsage ?? 0}
          color="#8db7ff"
        />
        <MetricCard
          index={1}
          icon={<HardDrive size={15} />}
          label="RAM"
          value={memoryUsedBytes === null || memoryTotalBytes === null
            ? '—'
            : `${formatMemory(memoryUsedBytes, language)} / ${formatMemory(memoryTotalBytes, language)}`}
          detail={localize(language, 'Memori digunakan', 'Memory in use')}
          percentage={memoryPercentage}
          color="#c6a2ff"
        />
        <MetricCard
          index={2}
          icon={batteryCharging ? <BatteryCharging size={15} /> : <Battery size={15} />}
          label={localize(language, 'Baterai', 'Battery')}
          value={batteryAvailable ? `${Math.round(batteryLevel)}%` : '—'}
          detail={batteryCharging
            ? localize(language, 'Sedang mengisi daya', 'Charging')
            : localize(language, 'Status baterai', 'Battery status')}
          percentage={batteryAvailable ? batteryLevel : 0}
          color={batteryColor}
        />
        <MetricCard
          index={3}
          icon={<Wifi size={15} />}
          label={localize(language, 'Jaringan', 'Network')}
          value={isWifiConnected
            ? (netRxBytesPerSec !== null ? `↓ ${formatNetSpeed(netRxBytesPerSec)}` : localize(language, 'Terhubung', 'Connected'))
            : localize(language, 'Offline', 'Offline')}
          detail={isWifiConnected
            ? `${activeWifiName || 'Wi-Fi'}${netTxBytesPerSec !== null ? ` · ↑ ${formatNetSpeed(netTxBytesPerSec)}` : ''}`
            : localize(language, 'Tidak ada jaringan Wi-Fi', 'No Wi-Fi network')}
          percentage={isWifiConnected ? 100 : 0}
          color={networkColor}
        />
      </div>
      <div className="system-monitor__audio" aria-label={localize(language, 'Kontrol audio cepat', 'Quick audio controls')}>
        <button
          type="button"
          className={`system-monitor__audio-btn${localOutMuted ? ' is-muted' : ''}`}
          onClick={handleToggleSpeaker}
          title={localOutMuted ? localize(language, 'Aktifkan speaker', 'Unmute speaker') : localize(language, 'Bisukan speaker', 'Mute speaker')}
          aria-label={localOutMuted ? localize(language, 'Aktifkan speaker', 'Unmute speaker') : localize(language, 'Bisukan speaker', 'Mute speaker')}
        >
          {localOutMuted ? <VolumeX size={13} /> : <Volume2 size={13} />}
        </button>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          className="system-monitor__volume-slider"
          value={localVolume}
          onChange={(event) => handleVolumeChange(Number(event.target.value))}
          aria-label="Volume"
        />
        <span className="system-monitor__volume-val">{localVolume}%</span>
        <button
          type="button"
          className={`system-monitor__audio-btn${localMicMuted ? ' is-muted' : ''}`}
          onClick={handleToggleMic}
          title={localMicMuted ? localize(language, 'Aktifkan mikrofon', 'Unmute microphone') : localize(language, 'Bisukan mikrofon', 'Mute microphone')}
          aria-label={localMicMuted ? localize(language, 'Aktifkan mikrofon', 'Unmute microphone') : localize(language, 'Bisukan mikrofon', 'Mute microphone')}
        >
          {localMicMuted ? <MicOff size={13} /> : <Mic size={13} />}
        </button>
      </div>
      <footer className="system-monitor__footer">
        {localize(language, 'Diperbarui setiap detik', 'Updates every second')}
      </footer>
    </m.section>
  );
}
