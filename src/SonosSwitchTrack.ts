export interface SonosSwitchTrack {
  trackUri: string;
  volume?: number;
  isNativeNotification: boolean;
  seekPosition?: string;
  stopAfter?: number;
  repeatContinuously: boolean;
}
