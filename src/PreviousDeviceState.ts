import {SonosState} from '@svrooij/sonos/lib/models/sonos-state';

export interface PreviousDeviceState {
  sonosState?: SonosState | undefined;
  volume?: number | undefined;
}
