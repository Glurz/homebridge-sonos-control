import {SonosSwitchTrack} from './SonosSwitchTrack';

export interface SonosSwitch {
  name: string;
  sonosDeviceNames: Array<string>;
  onlyWhenPlaying: boolean;
  cronExpression?: string;
  tracks: Array<SonosSwitchTrack>;
}
