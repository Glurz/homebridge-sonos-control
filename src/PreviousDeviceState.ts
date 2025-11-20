import {SonosState} from '@svrooij/sonos/lib/models/sonos-state';
import {Repeat} from '@svrooij/sonos/lib/models/index.js';

export interface PreviousDeviceState {
  sonosState: SonosState;
  repeatMode: Repeat;
}
