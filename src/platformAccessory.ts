import {CharacteristicValue, PlatformAccessory, Service} from 'homebridge';
import {SonosControlPlatform} from './platform.js';
import {SonosSwitch} from './SonosSwitch';
import {SonosDevice, SonosEvents} from '@svrooij/sonos/lib/index.js';
import {ExtendedTransportState} from '@svrooij/sonos/lib/models';
import {SonosState} from '@svrooij/sonos/lib/models/sonos-state';
import {SonosSwitchTrack} from './SonosSwitchTrack';


/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class SonosControlPlatformAccessory {

  private sonosSwitchService: Service;

  private switchState = {
    playing: false,
  };

  private previousDeviceState: Map<string, SonosState | undefined> = new Map();
  private trackFromNotification: Map<string, string | undefined> = new Map();
  private deviceStopTimers: Map<string, NodeJS.Timeout | undefined> = new Map();


  constructor(
    private readonly platform: SonosControlPlatform,
    private readonly accessory: PlatformAccessory,
    private readonly sonosSwitch: SonosSwitch,
  ) {

    // set accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Glurz')
      .setCharacteristic(this.platform.Characteristic.Model, 'Glurz-Switch')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, 'Default-Serial');

    this.sonosSwitchService = this.accessory.getService(this.platform.Service.Switch) ||
      this.accessory.addService(this.platform.Service.Switch);

    this.sonosSwitchService.setCharacteristic(this.platform.Characteristic.Name, this.sonosSwitch.name);

    this.sonosSwitchService.getCharacteristic(this.platform.Characteristic.On)
      .onSet(this.setOn.bind(this))
      .onGet(this.getOn.bind(this));
  }

  private playOnConfiguredDevices() {
    const sonosDevices = this.platform.getDiscoveredSonosCoordinatorDevices
      .filter((sonosDevice) => this.sonosSwitch.sonosDeviceNames.includes(sonosDevice.Name));

    if (sonosDevices.length === 0) {
      this.platform.log.debug('Configured device names in switch "%s" didn\'t match any Sonos device names.', this.sonosSwitch.name);
      return;
    }
    this.previousDeviceState.clear();
    sonosDevices.forEach(device => {
      // TODO: iterate through devices in parallel.
      const randomTrack = this.sonosSwitch.tracks[Math.floor(Math.random() * this.sonosSwitch.tracks.length)];

      if (randomTrack.isNativeNotification) {
        this.playNotification(device, randomTrack);
      } else {
        this.playTrack(device, randomTrack);
      }
    });
  }

  private stopOnConfiguredDevices () {
    const sonosDevices = this.platform.getDiscoveredSonosCoordinatorDevices
      .filter((sonosDevice) => this.sonosSwitch.sonosDeviceNames.includes(sonosDevice.Name));

    sonosDevices.forEach(device => {
      device.Stop();
    });
  }

  private async playTrack(device: SonosDevice, track: SonosSwitchTrack) {
    const trackStoppedListener = (state: ExtendedTransportState) => {
      if (state === 'STOPPED') {
        // reset switch state
        this.sonosSwitchService.getCharacteristic(this.platform.Characteristic.On).updateValue(false);
        this.switchState.playing = false;

        device.Events.off(SonosEvents.CurrentTransportState, trackStoppedListener);
        const timer = this.deviceStopTimers.get(device.Uuid);
        if (timer) {
          clearTimeout(timer);
        }

        const previousState = this.previousDeviceState.get(device.Uuid);
        this.platform.log.debug('trackStoppedListener: previousState %s', previousState);
        if (previousState) {
          this.previousDeviceState.set(device.Uuid, undefined);
          const notificationTrackId = this.trackFromNotification.get(device.Uuid);

          if (notificationTrackId) {
            device.AVTransportService.GetMediaInfo().then(info => {
              if (notificationTrackId === info.CurrentURI) {
                // track finished playing or manually stopped
                device.RestoreState(previousState, 60).catch(e => {
                  this.platform.log.error('Restore failed on device "%s": %s', device.Name, JSON.stringify(e));
                });
              } else {
                // new track selected. Only restore previous volume.
                device.SetVolume(previousState.volume);
              }
            });
          }
        }
      }
    };
    const trackPlayingListener = (state: ExtendedTransportState) => {
      if (state === 'PLAYING') {
        device.Events.off(SonosEvents.CurrentTransportState, trackPlayingListener);
        device.Events.on(SonosEvents.CurrentTransportState, trackStoppedListener);
        if (track.stopAfter) {
          const timer= setTimeout(() => {
            device.Stop();
          }, track.stopAfter);
          this.deviceStopTimers.set(device.Uuid, timer);
        }
      }
    };
    if (this.sonosSwitch.onlyWhenPlaying) {
      const transportInfo = await device.AVTransportService.GetTransportInfo({ InstanceID: 0 });
      const isPlaying = transportInfo.CurrentTransportState === 'PLAYING';
      if (!isPlaying) {
        // reset switch state
        this.sonosSwitchService.getCharacteristic(this.platform.Characteristic.On).updateValue(false);
        this.switchState.playing = false;
        return;
      }
    }

    await this.savePreviousState(device);
    device.SetAVTransportURI(track.trackUri)
      .then(async played => {
        this.platform.log.debug('Submitted new trackUri to device "%s" from switch "%s": %o',
          device.Name, this.sonosSwitch.name, played);
        if (track.seekPosition) {
          await device.SeekPosition(track.seekPosition);
        }
        if (track.volume) {
          this.platform.log.debug('Setting volume on device "%s" to %d', device.Name, track.volume);
          await device.SetVolume(track.volume);
        }

        device.Events.on(SonosEvents.CurrentTransportState, trackPlayingListener);
        await device.Play().then(() => {
          device.AVTransportService.GetMediaInfo().then((info) => {
            this.platform.log.debug('Stored trackFromNotification %s on device "%s"', info.CurrentURI, device.Name);
            this.trackFromNotification.set(device.Uuid, info.CurrentURI);
          });
        });
      }).catch(error => {
        this.platform.log.error('Error while playing track: ' + JSON.stringify(error));
      });
  }

  private async savePreviousState(device: SonosDevice) {
    const previousState = this.previousDeviceState.get(device.Uuid);
    if (previousState === undefined) {
      const deviceState = await device.GetState();
      this.previousDeviceState.set(device.Uuid, deviceState);
      this.platform.log.debug('Stored current state of device "%s" for later restore: %s', device.Name, JSON.stringify(deviceState));
    }
  }

  private playNotification(device: SonosDevice, randomTrack: SonosSwitchTrack) {
    device.PlayNotificationAudioClip({
      trackUri: randomTrack.trackUri,
      onlyWhenPlaying: this.sonosSwitch.onlyWhenPlaying,
      volume: randomTrack.volume,
    }).then(played => {
      this.platform.log.debug('Submitted notification to device "%s" from switch "%s": %o',
        device.Name, this.sonosSwitch.name, played);
    }).catch(error => {
      this.platform.log.error('Error while playing notification: ' + JSON.stringify(error));
    }).finally(() => {
      this.sonosSwitchService.getCharacteristic(this.platform.Characteristic.On).updateValue(false);
      this.switchState.playing = false;
    });
  }

  /**
   * Handle "SET" requests from HomeKit
   * These are sent when the user changes the state of an accessory, for example, turns on a switch.
   */
  async setOn(value: CharacteristicValue) {
    // implement your own code to turn your device on/off
    this.switchState.playing = value as boolean;
    if (value) {
      this.playOnConfiguredDevices();
    } else {
      this.stopOnConfiguredDevices();
    }
  }

  /**
   * Handle the "GET" requests from HomeKit
   * These are sent when HomeKit wants to know the current state of the accessory, for example, checking if a switch is on.
   *
   * GET requests should return as fast as possible. A long delay here will result in
   * HomeKit being unresponsive and a bad user experience in general.
   *
   * If your device takes time to respond you should update the status of your device
   * asynchronously instead using the `updateCharacteristic` method instead.

   * @example
   * this.service.updateCharacteristic(this.platform.Characteristic.On, true)
   */
  async getOn(): Promise<CharacteristicValue> {
    return this.switchState.playing;
    // if you need to return an error to show the device as "Not Responding" in the Home app:
    // throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
  }

}
