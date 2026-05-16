import {SonosSwitch} from './SonosSwitch';

export interface PluginConfiguration {
  sonosDeviceIp: string | undefined;
  sonosS1DeviceIp: string | undefined;
  switches: Array<SonosSwitch>;
}
