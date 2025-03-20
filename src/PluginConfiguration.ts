import {SonosSwitch} from './SonosSwitch';

export interface PluginConfiguration {
  sonosDeviceIp: string | undefined;
  switches: Array<SonosSwitch>;
}