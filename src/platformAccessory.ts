import {CharacteristicValue, PlatformAccessory, Service} from 'homebridge';
import {SonosControlPlatform} from './platform.js';
import {SonosSwitch} from './SonosSwitch';
import {SonosDevice, SonosEvents} from '@svrooij/sonos/lib/index.js';
import {ExtendedTransportState} from '@svrooij/sonos/lib/models';
import {PreviousDeviceState} from './PreviousDeviceState';


/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class SonosControlPlatformAccessory {

  private sonosSwitchService: Service;

  private switchState = {
    submittingAudio: false,
  };

  private previousDeviceState: Map<string, PreviousDeviceState | undefined> = new Map();

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
      if (this.sonosSwitch.isNotification) {
        this.playNotification(device);
      } else {
        this.playTrack(device);
      }
    });
  }

  private async playTrack(device: SonosDevice) {
    const trackChangedListener = (trackUri: string) => {
      const previousState = this.previousDeviceState.get(device.Uuid);
      if (previousState) {
        this.platform.log.debug('Removing previous state on device "%s" due to new trackUri "%s". Will only restore volume.',
          device.Name, trackUri);
        this.previousDeviceState.set(device.Uuid, {volume: previousState.volume});
      }
      device.Events.off(SonosEvents.CurrentTrackUri, trackChangedListener);
    };
    const playbackStoppedListener = (state: ExtendedTransportState) => {
      if (state === 'STOPPED') {
        this.platform.log.debug('playbackStoppedListener: playback on device "%s" has stopped', device.Name);
        this.restorePreviousState(device);
        device.Events.off(SonosEvents.CurrentTransportState, playbackStoppedListener);
      }
    };
    const stopAfterTimeoutListener = (state: ExtendedTransportState) => {
      if (this.sonosSwitch.stopAfter) {
        if (state === 'PLAYING') {
          // de-register listener itself
          device.Events.off(SonosEvents.CurrentTransportState, stopAfterTimeoutListener);

          setTimeout(() => {
            device.Stop();
          }, this.sonosSwitch.stopAfter * 1000);
        }
      }
    };
    if (this.sonosSwitch.stopAfter) {
      if (!device.Events.listeners(SonosEvents.CurrentTransportState).includes(stopAfterTimeoutListener)) {
        device.Events.on(SonosEvents.CurrentTransportState, stopAfterTimeoutListener);
      }
    }
    await this.savePreviousState(device);
    device.SetAVTransportURI(this.sonosSwitch.trackUri)
      .then(async played => {
        this.platform.log.debug('Submitted new trackUri to device "%s" from switch "%s": %o',
          device.Name, this.sonosSwitch.name, played);
        if (this.sonosSwitch.seekPosition) {
          await device.SeekPosition(this.sonosSwitch.seekPosition);
        }
        if (this.sonosSwitch.volume) {
          this.platform.log.debug('Setting volume on device "%s" to %d', device.Name, this.sonosSwitch.volume);
          await device.SetVolume(this.sonosSwitch.volume);
        }

        await device.Play().then(() => {
          // register a listener that restores the previous state if playback of the track has stopped
          if (!device.Events.listeners(SonosEvents.CurrentTransportState).includes(playbackStoppedListener)) {
            device.Events.on(SonosEvents.CurrentTransportState, playbackStoppedListener);
          }

          // register a listener that deletes the saved state to allow a new track to be played
          if (!device.Events.listeners(SonosEvents.CurrentTrackUri).includes(trackChangedListener)) {
            device.Events.on(SonosEvents.CurrentTrackUri, trackChangedListener);
          }
        });
      }).catch(error => {
        this.platform.log.error('Error while playing track: ' + JSON.stringify(error));
      }).finally(() => {
        this.sonosSwitchService.getCharacteristic(this.platform.Characteristic.On).updateValue(false);
        this.switchState.submittingAudio = false;
      });

  }

  private async savePreviousState(device: SonosDevice) {
    const previousState = this.previousDeviceState.get(device.Uuid);
    if (previousState === undefined) {
      const deviceState = await device.GetState();
      this.previousDeviceState.set(device.Uuid, {sonosState: deviceState});
      this.platform.log.debug('Stored current state of device "%s" for later restore: %s', device.Name, JSON.stringify(deviceState));
    }
  }

  private playNotification(device: SonosDevice) {
    device.PlayNotificationAudioClip({
      trackUri: this.sonosSwitch.trackUri,
      onlyWhenPlaying: this.sonosSwitch.onlyWhenPlaying,
      volume: this.sonosSwitch.volume,
    }).then(played => {
      this.platform.log.debug('Submitted notification to device "%s" from switch "%s": %o',
        device.Name, this.sonosSwitch.name, played);
    }).catch(error => {
      this.platform.log.error('Error while playing notification: ' + JSON.stringify(error));
    }).finally(() => {
      this.sonosSwitchService.getCharacteristic(this.platform.Characteristic.On).updateValue(false);
      this.switchState.submittingAudio = false;
    });
  }

  private async restorePreviousState(device: SonosDevice): Promise<boolean> {
    const previousState = this.previousDeviceState.get(device.Uuid);
    this.previousDeviceState.set(device.Uuid, undefined);
    if (previousState) {
      if (previousState.volume) {
        this.platform.log.debug('Restoring volume on device "%s"', device.Name);
        await device.SetVolume(previousState.volume);
      } else {
        this.platform.log.debug('Restoring state on device "%s"', device.Name);
        await device.RestoreState(previousState.sonosState!, 60);
      }
      return true;
    }
    return false;
  }

  /**
   * Handle "SET" requests from HomeKit
   * These are sent when the user changes the state of an accessory, for example, turns on a switch.
   */
  async setOn(value: CharacteristicValue) {
    // implement your own code to turn your device on/off
    this.switchState.submittingAudio = value as boolean;
    if (value) {
      this.playOnConfiguredDevices();
    }

    //this.platform.log.debug('Set Characteristic On: %s ->', this.sonosSwitch.name, value);
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
    const isOn = this.switchState.submittingAudio;

    //this.platform.log.debug('Get Characteristic On: %s ->', this.sonosSwitch.name, isOn);

    // if you need to return an error to show the device as "Not Responding" in the Home app:
    // throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    return isOn;
  }

}
