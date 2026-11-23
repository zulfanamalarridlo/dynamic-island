import { motion } from 'framer-motion';
import { Battery, BatteryCharging, BatteryWarning, X } from 'lucide-react';
import { localize, type AppLanguage } from '../i18n';

interface BatteryDetailProps {
  available: boolean;
  level: number;
  color: string;
  status: string;
  charging: boolean;
  healthLabel: string;
  stateLabel: string;
  error?: string | null;
  language: AppLanguage;
  travelX: number;
  travelY: number;
  transition: { duration: number; ease: number[] };
  onClose: () => void;
}

export default function BatteryDetail({
  available, level, color, status, charging, healthLabel, stateLabel, error, language,
  travelX, travelY, transition, onClose
}: BatteryDetailProps) {
  return (
    <motion.section
      key="battery-detail"
      className="battery-detail"
      initial={{ opacity: 0, x: travelX, y: travelY, scale: 0.99, filter: 'blur(2px)' }}
      animate={{ opacity: 1, x: 0, y: 0, scale: 1, filter: 'blur(0px)' }}
      exit={{ opacity: 0, x: travelX, y: travelY, scale: 0.995, filter: 'blur(1px)' }}
      transition={transition}
      aria-label={localize(language, 'Detail baterai', 'Battery details')}
    >
      <div className="battery-detail__header">
        <div className="battery-detail__title">
          <span className="battery-detail__icon" style={{ color }}>
            {charging
              ? <BatteryCharging size={19} />
              : available && level <= 15
                ? <BatteryWarning size={19} />
                : <Battery size={19} />}
          </span>
          <div><strong>{status}</strong></div>
        </div>
        <button
          type="button"
          className="auto-notice__dismiss"
          aria-label={localize(language, 'Tutup detail baterai', 'Close battery details')}
          title={localize(language, 'Tutup', 'Close')}
          onClick={(event) => { event.stopPropagation(); onClose(); }}
        >
          <X size={15} />
        </button>
      </div>
      <div className="battery-detail__percentage" style={{ color }}>
        {available ? <>{Math.round(level)}<span>%</span></> : '—'}
      </div>
      <div
        className="battery-detail__meter"
        role="img"
        aria-label={available
          ? `${localize(language, 'Baterai', 'Battery')} ${Math.round(level)}%`
          : localize(language, 'Persentase baterai tidak tersedia', 'Battery percentage unavailable')}
      >
        <motion.span
          initial={{ width: '0%' }}
          animate={{ width: available ? `${level}%` : '0%' }}
          transition={{ duration: 0.65, ease: [0.22, 1, 0.36, 1] }}
          style={{ backgroundColor: color }}
        />
      </div>
      <div className="battery-detail__footer">
        <span title={error ?? undefined}>
          {error || (available ? healthLabel : localize(language, 'Persentase tidak tersedia', 'Percentage unavailable'))}
        </span>
        <span>{stateLabel}</span>
      </div>
    </motion.section>
  );
}
