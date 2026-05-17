import {SonosSwitch} from './SonosSwitch';

export interface PluginConfiguration {
  sonosDeviceIp: string | undefined;
  secondarySonosDeviceIp: string | undefined;
  switches: Array<SonosSwitch>;
}
