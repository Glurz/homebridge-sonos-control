export interface SonosSwitch {
  name: string;
  trackUri: string;
  volume?: number;
  onlyWhenPlaying?: boolean;
  sonosDeviceNames: Array<string>;
  isNotification: boolean;
  seekPosition?: string;
  stopAfter?: number;
}