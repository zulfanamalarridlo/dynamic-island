export type MediaProvider = 'spotify' | 'youtube-music';

export interface MediaInfo {
  title: string;
  artist: string;
  source_app: string;
  is_playing: boolean;
  position_seconds: number;
  duration_seconds: number;
}

export interface AutoNotice {
  kind: 'system' | 'activity' | 'media' | 'notification';
  title: string;
  body: string;
  appName?: string | null;
  media?: MediaInfo;
  volumeLevel?: number;
  previousVolumeLevel?: number;
}

export interface SysData {
  battery: number | null;
  batteryState: string;
  batteryError?: string | null;
  volume: number;
  isWifiConnected: boolean;
  activeWifiName: string;
  capsLock: boolean;
  numLock: boolean;
  scrollLock: boolean;
  microphoneMuted: boolean;
  outputMuted: boolean;
  media: MediaInfo | null;
  cpuUsage: number | null;
  memoryUsedBytes: number | null;
  memoryTotalBytes: number | null;
  cameraActive?: boolean;
  cameraApp?: string | null;
  micInUse?: boolean;
  micApp?: string | null;
  pcIdleSeconds?: number;
}

export interface BatteryInfo {
  percentage: number | null;
  state: string;
}

export type ActivityModule =
  | 'capsLock'
  | 'numLock'
  | 'scrollLock'
  | 'microphone'
  | 'speaker'
  | 'volume'
  | 'clipboard'
  | 'brightness'
  | 'wifi'
  | 'power'
  | 'battery';

export type ActivityModuleSettings = Record<ActivityModule, boolean>;

export const ACTIVITY_MODULE_DEFAULTS: ActivityModuleSettings = {
  capsLock: true,
  numLock: true,
  scrollLock: true,
  microphone: true,
  speaker: true,
  volume: true,
  clipboard: true,
  brightness: true,
  wifi: true,
  power: true,
  battery: true
};
