import type { CSSProperties } from 'react';
import { m } from 'framer-motion';
import {
  AlarmClock, Battery, BatteryCharging, Bluetooth, Camera, Cpu, Download,
  HardDrive, LayoutGrid, Mic, Music2, Wifi
} from 'lucide-react';
import IslandPet from './IslandPet';
import SlideDigits from './SlideDigits';
import type { FocusLiveState } from './ToolsPanel';
import { localize, type AppLanguage } from '../lib/i18n';
import type { WindhawkSettings } from '../lib/appearanceSettings';
import type { IslandLayoutSettings, ToolTabId } from '../lib/layoutSettings';
import type { SysData } from '../types';

function formatCompactSpeed(bytesPerSec: number): string {
  if (!Number.isFinite(bytesPerSec) || bytesPerSec <= 0) return '0K';
  if (bytesPerSec >= 1024 * 1024) return `${(bytesPerSec / (1024 * 1024)).toFixed(1)}M`;
  if (bytesPerSec >= 1024) return `${Math.round(bytesPerSec / 1024)}K`;
  return `${Math.round(bytesPerSec)}B`;
}

export interface IdleViewProps {
  language: AppLanguage;
  isSidePosition: boolean;
  hasPinnedIdleContent: boolean;
  isVinylIdle: boolean;
  isDualIdle: boolean;
  isHudIdle: boolean;
  isStealthCollapsed: boolean;
  time: Date;
  formattedTime: string;
  formattedDate: string;
  showClock: boolean;
  showDate: boolean;
  sysData: SysData;
  batteryAvailable: boolean;
  batteryLevel: number;
  batteryColor: string;
  windhawkSettings: WindhawkSettings;
  layoutSettings: IslandLayoutSettings;
  hasPrivacyAlert: boolean;
  focusLive: FocusLiveState;
  focusFormatted: string;
  focusProgress: number;
  showPrayerPill: boolean;
  nextPrayerLabel: string | null;
  showTickerPill: boolean;
  activeTickerText: string;
  showIdleLyricPill: boolean;
  idleLyricDisplayText: string;
  activeIdleLyric: string;
  shouldMarqueeIdleLyric: boolean;
  idleMediaProgress: number;
  showLyrics: boolean;
  mediaPinned: boolean;
  monitorPinned: boolean;
  mediaArtwork: string | null;
  onOpenLauncher: () => void;
  onOpenMedia: () => void;
  onOpenSystemMonitor: () => void;
  onOpenToolsTab: (tab: ToolTabId) => void;
}

export default function IdleView({
  language,
  isSidePosition,
  hasPinnedIdleContent,
  isVinylIdle,
  isDualIdle,
  isHudIdle,
  isStealthCollapsed,
  time,
  formattedTime,
  formattedDate,
  showClock,
  showDate,
  sysData,
  batteryAvailable,
  batteryLevel,
  batteryColor,
  windhawkSettings,
  layoutSettings,
  hasPrivacyAlert,
  focusLive,
  focusFormatted,
  focusProgress,
  showPrayerPill,
  nextPrayerLabel,
  showTickerPill,
  activeTickerText,
  showIdleLyricPill,
  idleLyricDisplayText,
  activeIdleLyric,
  shouldMarqueeIdleLyric,
  idleMediaProgress,
  showLyrics,
  mediaPinned,
  monitorPinned,
  mediaArtwork,
  onOpenLauncher,
  onOpenMedia,
  onOpenSystemMonitor,
  onOpenToolsTab
}: IdleViewProps) {
  return (
    <m.div
      key="idle"
      className={`island-idle island-module${isSidePosition ? ' island-idle--side' : ' island-idle--top'}${hasPinnedIdleContent ? ' island-idle--pinned' : ''}${isVinylIdle ? ' island-idle--vinyl' : ''}${isDualIdle ? ' island-idle--dual' : ''}${isHudIdle ? ' island-idle--hud' : ''}`}
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.99 }}
      transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
    >
      {isStealthCollapsed ? (
        <button
          type="button"
          className={`idle-stealth${isSidePosition ? ' idle-stealth--side' : ''}`}
          onClick={onOpenLauncher}
          aria-label={localize(language, 'Buka menu', 'Open menu')}
        >
          <span className="idle-stealth__clock">
            {isSidePosition
              ? (
                <>
                  <span>{String(time.getHours()).padStart(2, '0')}</span>
                  <span>{String(time.getMinutes()).padStart(2, '0')}</span>
                </>
              )
              : formattedTime.replace('.', ':')}
          </span>
          <span className="idle-stealth__dots" aria-hidden="true">
            {sysData.media?.is_playing && <i className="is-music" />}
            {focusLive.running && <i className="is-focus" />}
            {hasPrivacyAlert && <i className="is-privacy" />}
            {!sysData.media?.is_playing && !focusLive.running && !hasPrivacyAlert && (
              <i className="is-idle" style={{ background: batteryColor }} />
            )}
          </span>
        </button>
      ) : isHudIdle ? (
        <div className={`idle-hud${isSidePosition ? ' idle-hud--side' : ''}`}>
          <button type="button" className="idle-hud__clock" onClick={onOpenLauncher}>
            {isSidePosition
              ? `${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}`
              : formattedTime.replace('.', ':')}
          </button>
          <button type="button" className="idle-hud__metrics" onClick={onOpenSystemMonitor}>
            <span className="idle-hud__stat">
              <em>CPU</em>
              <strong>{sysData.cpuUsage === null ? '—' : `${Math.round(sysData.cpuUsage)}%`}</strong>
              <span className="idle-hud__bar">
                <i style={{ width: `${Math.min(100, Math.max(0, sysData.cpuUsage ?? 0))}%`, background: '#60a5fa' }} />
              </span>
            </span>
            <span className="idle-hud__stat">
              <em>RAM</em>
              <strong>
                {sysData.memoryUsedBytes !== null && sysData.memoryTotalBytes
                  ? `${Math.round((sysData.memoryUsedBytes / sysData.memoryTotalBytes) * 100)}%`
                  : '—'}
              </strong>
              <span className="idle-hud__bar">
                <i
                  style={{
                    width: `${sysData.memoryUsedBytes !== null && sysData.memoryTotalBytes ? Math.min(100, Math.round((sysData.memoryUsedBytes / sysData.memoryTotalBytes) * 100)) : 0}%`,
                    background: '#c084fc'
                  }}
                />
              </span>
            </span>
            <span className="idle-hud__stat">
              <em>BAT</em>
              <strong style={{ color: batteryColor }}>{batteryAvailable ? `${Math.round(batteryLevel)}%` : '—'}</strong>
            </span>
          </button>
        </div>
      ) : (
        <>
          {(() => {
            let clockRendered = false;
            const renderClockButton = (key: string) => {
              if (clockRendered) return null;
              clockRendered = true;
              return (
                <button
                  key={key}
                  className="idle-clock"
                  aria-label={localize(language, 'Buka menu', 'Open menu')}
                  title={localize(language, 'Buka menu', 'Open menu')}
                  onClick={onOpenLauncher}
                >
                  {showClock && (
                    <span className={`idle-clock__time${isSidePosition ? ' idle-clock__time--vertical' : ''}`}>
                      {isSidePosition
                        ? (
                          <>
                            <SlideDigits value={String(time.getHours()).padStart(2, '0')} />
                            <SlideDigits value={String(time.getMinutes()).padStart(2, '0')} />
                          </>
                        )
                        : <SlideDigits value={formattedTime.replace('.', ':')} />}
                    </span>
                  )}
                  {showDate && <span className="idle-clock__date">{formattedDate}</span>}
                </button>
              );
            };

            const nodes = layoutSettings.idleWidgets.map((widget) => {
              if (!widget.visible) return null;
              if (widget.id === 'pet') {
                return (
                  <IslandPet
                    key="pet"
                    style={windhawkSettings.appearance.petStyle}
                    customImage={windhawkSettings.appearance.customPetImage}
                    isPlaying={Boolean(sysData.media?.is_playing)}
                    isCharging={sysData.batteryState === 'Charging'}
                    pcIdleSeconds={sysData.pcIdleSeconds ?? 0}
                    idleThresholdMinutes={windhawkSettings.appearance.petIdleMinutes}
                  />
                );
              }
              if (widget.id === 'privacy' && hasPrivacyAlert) {
                return (
                  <span key="privacy" className="idle-privacy" aria-label={localize(language, 'Indikator privasi kamera dan mikrofon', 'Camera and microphone privacy indicator')}>
                    {sysData.cameraActive && (
                      <span
                        className="idle-privacy__badge idle-privacy__badge--camera"
                        title={localize(language, `Kamera aktif: ${sysData.cameraApp ?? 'Aplikasi'}`, `Camera in use: ${sysData.cameraApp ?? 'App'}`)}
                      >
                        <Camera size={11} />
                      </span>
                    )}
                    {sysData.micInUse && (
                      <span
                        className="idle-privacy__badge idle-privacy__badge--mic"
                        title={localize(language, `Mikrofon aktif: ${sysData.micApp ?? 'Aplikasi'}`, `Mic in use: ${sysData.micApp ?? 'App'}`)}
                      >
                        <Mic size={11} />
                      </span>
                    )}
                  </span>
                );
              }
              if (widget.id === 'live' && (sysData.activeDownload || sysData.bluetoothDevice)) {
                return (
                  <span key="live" className="idle-live-group">
                    {sysData.activeDownload && (
                      <span
                        className="idle-live-badge idle-live-badge--dl"
                        title={`${localize(language, 'Mengunduh', 'Downloading')}: ${sysData.activeDownload.fileName}`}
                      >
                        <Download size={10} />
                      </span>
                    )}
                    {sysData.bluetoothDevice && (
                      <span
                        className="idle-live-badge idle-live-badge--bt"
                        title={`${sysData.bluetoothDevice.name}: ${sysData.bluetoothDevice.battery}%`}
                      >
                        <Bluetooth size={10} />
                        <strong>{sysData.bluetoothDevice.battery}%</strong>
                      </span>
                    )}
                  </span>
                );
              }
              if (widget.id === 'clock' || widget.id === 'date') {
                return renderClockButton(widget.id);
              }
              if (widget.id === 'battery' && !monitorPinned) {
                return (
                  <button
                    key="battery"
                    type="button"
                    className={`idle-battery${sysData.batteryState === 'Charging' ? ' is-charging' : ''}${batteryAvailable && batteryLevel <= 20 && sysData.batteryState !== 'Charging' ? ' is-low' : ''}`}
                    aria-label={localize(language, 'Buka monitor sistem', 'Open system monitor')}
                    onClick={onOpenSystemMonitor}
                    style={{ '--battery-color': batteryColor, '--battery-level': `${batteryLevel / 100}` } as CSSProperties}
                    title={sysData.batteryError ?? `${localize(language, 'Baterai', 'Battery')} ${batteryAvailable ? `${Math.round(batteryLevel)}%` : 'N/A'}`}
                  >
                    <span className="idle-battery__icon" aria-hidden="true">
                      {sysData.batteryState === 'Charging' ? (
                        <BatteryCharging size={16} />
                      ) : (
                        <>
                          <Battery size={16} />
                          <span />
                        </>
                      )}
                    </span>
                    <span className="idle-battery__percent">{batteryAvailable ? `${Math.round(batteryLevel)}%` : '—'}</span>
                  </button>
                );
              }
              return null;
            });

            return (
              <>
                {!showClock && !showDate && (
                  <button
                    type="button"
                    className="idle-clock"
                    aria-label={localize(language, 'Buka menu', 'Open menu')}
                    title={localize(language, 'Buka menu', 'Open menu')}
                    onClick={onOpenLauncher}
                  >
                    <LayoutGrid size={14} />
                  </button>
                )}
                {nodes}
                {showPrayerPill && (
                  <button
                    type="button"
                    className="idle-prayer-pill"
                    onClick={() => onOpenToolsTab('prayer')}
                    title={localize(language, 'Buka jadwal salat', 'Open prayer schedule')}
                  >
                    <span className="idle-prayer-pill__dot" aria-hidden="true" />
                    <span>{nextPrayerLabel || localize(language, 'Jadwal salat', 'Prayer time')}</span>
                  </button>
                )}
                {showTickerPill && (
                  <button
                    type="button"
                    className="idle-ticker-pill"
                    onClick={onOpenLauncher}
                    title={activeTickerText}
                  >
                    <span key={activeTickerText} className="idle-ticker-pill__text">{activeTickerText}</span>
                  </button>
                )}
                {showIdleLyricPill && (
                  <button
                    type="button"
                    className={`idle-lyric-pill island-module__card${isSidePosition ? ' idle-lyric-pill--side' : ''}${shouldMarqueeIdleLyric ? ' is-marquee' : ''}`}
                    onClick={onOpenMedia}
                    title={`${sysData.media?.title ?? ''}${activeIdleLyric ? ` — ${activeIdleLyric}` : ''}`}
                  >
                    <span className={`idle-lyric-pill__art${mediaArtwork ? ' has-art' : ''}`} aria-hidden="true">
                      {mediaArtwork ? <img src={mediaArtwork} alt="" /> : <Music2 size={10} />}
                    </span>
                    <span className="idle-lyric-pill__body">
                      {!isSidePosition && (
                        <span className="idle-lyric-pill__title">
                          {sysData.media?.title || localize(language, 'Sedang diputar', 'Now playing')}
                        </span>
                      )}
                      <span className="idle-lyric-pill__viewport">
                        <span key={idleLyricDisplayText} className="idle-lyric-pill__text">
                          {activeIdleLyric ? `♪ ${activeIdleLyric}` : idleLyricDisplayText}
                        </span>
                      </span>
                    </span>
                    <span className={`idle-waveform idle-waveform--corner${sysData.media?.is_playing ? ' is-playing' : ''}`} aria-hidden="true">
                      {(isSidePosition
                        ? [40, 76, 54, 96, 68, 100, 50, 84, 60, 42]
                        : [34, 62, 46, 86, 58, 96, 44, 78, 92, 52, 100, 68, 84, 48, 90, 64, 76, 42, 88, 56, 70, 38]
                      ).map((barH, idx, arr) => {
                        const pct = ((idx + 0.5) / arr.length) * 100;
                        const isPlayed = idleMediaProgress > 0 ? pct <= idleMediaProgress : true;
                        return (
                          <i
                            key={idx}
                            className={isPlayed ? 'is-played' : undefined}
                            style={{ height: `${barH}%`, animationDelay: `${(idx % 6) * 0.08}s` }}
                          />
                        );
                      })}
                    </span>
                  </button>
                )}
                {focusLive.running && (
                  <button
                    type="button"
                    className={`idle-focus-pill${focusLive.isBreak ? ' is-break' : ''}`}
                    onClick={() => onOpenToolsTab('focus')}
                    title={focusLive.isBreak
                      ? localize(language, 'Istirahat sedang berjalan — klik untuk buka Focus', 'Break running — click to open Focus')
                      : localize(language, 'Focus sedang berjalan — klik untuk buka Focus', 'Focus running — click to open Focus')}
                  >
                    <span className="idle-focus-pill__row">
                      <AlarmClock size={10} />
                      <strong><SlideDigits value={focusFormatted} /></strong>
                    </span>
                    <span className="idle-focus-pill__bar" aria-hidden="true">
                      <span style={{ width: `${focusProgress}%` }} />
                    </span>
                  </button>
                )}
              </>
            );
          })()}
          {mediaPinned && (
            <button
              type="button"
              className={`idle-pin-card idle-pin-card--media island-module__card${sysData.media?.is_playing ? ' is-playing' : ''}`}
              disabled={!sysData.media}
              aria-label={localize(language, 'Buka media yang disematkan', 'Open pinned media')}
              onClick={onOpenMedia}
            >
              <span className={`idle-pin-card__icon${mediaArtwork ? ' idle-pin-card__icon--art' : ''}`}>
                {mediaArtwork ? <img src={mediaArtwork} alt="" /> : <Music2 size={14} />}
              </span>
              <span className="idle-pin-card__copy">
                <strong>{sysData.media?.title || localize(language, 'Tidak ada media', 'No media')}</strong>
                <span className={`idle-pin-card__subwrap${showLyrics && activeIdleLyric ? ' has-lyric' : ''}${showLyrics && activeIdleLyric.length > 24 ? ' is-marquee' : ''}`}>
                  <small key={(showLyrics && activeIdleLyric) || sysData.media?.artist || 'artist'} className={showLyrics && activeIdleLyric ? 'idle-pin-card__lyric' : undefined}>
                    {showLyrics && activeIdleLyric ? `♪ ${activeIdleLyric}` : (sysData.media?.artist || localize(language, 'Putar musik', 'Play media'))}
                  </small>
                </span>
              </span>
              {sysData.media && (
                <span className={`idle-waveform idle-waveform--corner${sysData.media.is_playing ? ' is-playing' : ''}`} aria-hidden="true">
                  {(isSidePosition
                    ? [38, 74, 52, 94, 66, 100, 48, 86, 58, 40]
                    : [34, 62, 46, 86, 58, 96, 44, 78, 92, 52, 100, 68, 84, 48, 90, 64, 76, 42, 88, 56, 70, 38]
                  ).map((barH, idx, arr) => {
                    const pct = ((idx + 0.5) / arr.length) * 100;
                    const isPlayed = idleMediaProgress > 0 ? pct <= idleMediaProgress : sysData.media?.is_playing;
                    return (
                      <i
                        key={idx}
                        className={isPlayed ? 'is-played' : undefined}
                        style={{ height: `${barH}%`, animationDelay: `${(idx % 6) * 0.08}s` }}
                      />
                    );
                  })}
                </span>
              )}
            </button>
          )}
          {monitorPinned && (
            <button
              type="button"
              className="idle-monitor-card island-module__card"
              aria-label={localize(language, 'Buka semua metrik monitor sistem', 'Open all system monitor metrics')}
              onClick={onOpenSystemMonitor}
            >
              <span className="idle-monitor-card__metric idle-monitor-card__metric--cpu" title={localize(language, 'Penggunaan CPU', 'CPU usage')}>
                <Cpu size={11} />
                <strong>{sysData.cpuUsage === null ? '—' : `${Math.round(sysData.cpuUsage)}%`}</strong>
              </span>
              <span className="idle-monitor-card__metric idle-monitor-card__metric--ram" title={localize(language, 'Penggunaan memori', 'Memory usage')}>
                <HardDrive size={11} />
                <strong>
                  {sysData.memoryUsedBytes !== null && sysData.memoryTotalBytes
                    ? `${Math.round((sysData.memoryUsedBytes / sysData.memoryTotalBytes) * 100)}%`
                    : '—'}
                </strong>
              </span>
              <span
                className="idle-monitor-card__metric idle-monitor-card__metric--bat"
                style={{ color: batteryColor }}
                title={localize(language, 'Baterai', 'Battery')}
              >
                {sysData.batteryState === 'Charging' ? <BatteryCharging size={11} /> : <Battery size={11} />}
                <strong>{batteryAvailable ? `${Math.round(batteryLevel)}%` : '—'}</strong>
              </span>
              <span
                className={`idle-monitor-card__metric idle-monitor-card__metric--wifi${sysData.isWifiConnected ? ' is-connected' : ''}`}
                title={`${sysData.activeWifiName || 'Wi-Fi'} · ↓ ${formatCompactSpeed(sysData.netRxBytesPerSec ?? 0)}/s ↑ ${formatCompactSpeed(sysData.netTxBytesPerSec ?? 0)}/s`}
              >
                <Wifi size={11} />
                <strong>
                  {sysData.isWifiConnected
                    ? `↓${formatCompactSpeed(sysData.netRxBytesPerSec ?? 0)} ↑${formatCompactSpeed(sysData.netTxBytesPerSec ?? 0)}`
                    : 'Off'}
                </strong>
              </span>
            </button>
          )}
        </>
      )}
    </m.div>
  );
}

