import type { ReactNode } from 'react';
import { Activity, Battery, BatteryCharging, Cpu, HardDrive, Pin, Wifi, X } from 'lucide-react';
import { motion } from 'framer-motion';
import { localize, type AppLanguage } from '../i18n';

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
  travelX: number;
  travelY: number;
  transition: { duration: number; ease: number[] };
  onClose: () => void;
}

interface MetricCardProps {
  icon: ReactNode;
  label: string;
  value: string;
  detail: string;
  percentage: number;
  color: string;
}

function MetricCard({ icon, label, value, detail, percentage, color }: MetricCardProps) {
  return (
    <article className="system-monitor__metric">
      <div className="system-monitor__metric-heading">
        <span className="system-monitor__metric-icon" style={{ color }}>{icon}</span>
        <span>{label}</span>
      </div>
      <strong className="system-monitor__metric-value">{value}</strong>
      <small className="system-monitor__metric-detail" title={detail}>{detail}</small>
      <span className="system-monitor__meter" aria-hidden="true">
        <span style={{ width: `${percentage}%`, backgroundColor: color }} />
      </span>
    </article>
  );
}

function formatMemory(bytes: number | null, language: AppLanguage): string {
  if (bytes === null || !Number.isFinite(bytes)) return '—';
  const gigabytes = bytes / 1024 ** 3;
  return `${new Intl.NumberFormat(language === 'id' ? 'id-ID' : 'en-US', {
    maximumFractionDigits: 1
  }).format(gigabytes)} GB`;
}

export default function SystemMonitorDetail({
  language, cpuUsage, memoryUsedBytes, memoryTotalBytes, batteryAvailable, batteryLevel,
  batteryColor, batteryCharging, pinned, onTogglePin, isWifiConnected, activeWifiName,
  travelX, travelY, transition, onClose
}: SystemMonitorDetailProps) {
  const memoryPercentage = memoryUsedBytes !== null && memoryTotalBytes !== null && memoryTotalBytes > 0
    ? Math.min(100, Math.max(0, memoryUsedBytes / memoryTotalBytes * 100))
    : 0;
  const safeCpuUsage = cpuUsage !== null && Number.isFinite(cpuUsage)
    ? Math.min(100, Math.max(0, cpuUsage))
    : null;
  const networkColor = isWifiConnected ? '#65c9a5' : '#8993a0';

  return (
    <motion.section
      key="system-monitor"
      className="system-monitor-detail"
      initial={{ opacity: 0, x: travelX, y: travelY, scale: 0.99, filter: 'blur(2px)' }}
      animate={{ opacity: 1, x: 0, y: 0, scale: 1, filter: 'blur(0px)' }}
      exit={{ opacity: 0, x: travelX, y: travelY, scale: 0.995, filter: 'blur(1px)' }}
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
          icon={<Cpu size={15} />}
          label="CPU"
          value={safeCpuUsage === null ? '—' : `${Math.round(safeCpuUsage)}%`}
          detail={localize(language, 'Penggunaan prosesor', 'Processor usage')}
          percentage={safeCpuUsage ?? 0}
          color="#8db7ff"
        />
        <MetricCard
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
          icon={<Wifi size={15} />}
          label={localize(language, 'Jaringan', 'Network')}
          value={isWifiConnected
            ? localize(language, 'Terhubung', 'Connected')
            : localize(language, 'Offline', 'Offline')}
          detail={activeWifiName || localize(language, 'Tidak ada jaringan Wi-Fi', 'No Wi-Fi network')}
          percentage={isWifiConnected ? 100 : 0}
          color={networkColor}
        />
      </div>
      <footer className="system-monitor__footer">
        {localize(language, 'Diperbarui setiap detik', 'Updates every second')}
      </footer>
    </motion.section>
  );
}
