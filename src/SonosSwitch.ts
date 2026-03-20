import {SonosSwitchTrack} from './SonosSwitchTrack';

export interface SonosSwitch {
  name: string;
  sonosDeviceNames: Array<string>;
  onlyWhenPlaying: boolean;
  cronExpressions: Array<string>;
  tracks: Array<SonosSwitchTrack>;
}
