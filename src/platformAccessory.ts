import {CharacteristicValue, PlatformAccessory, Service} from 'homebridge';
import {SonosControlPlatform} from './platform.js';
import {SonosSwitch} from './SonosSwitch';
import {SonosDevice, SonosEvents} from '@svrooij/sonos/lib/index.js';
import {ExtendedTransportState} from '@svrooij/sonos/lib/models';
import {DeviceState} from './deviceState';


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

  private previousDeviceState: Map<string, DeviceState | undefined> = new Map();

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

  private playTrack(device: SonosDevice) {
    const trackChangedListener = (trackUri: string) => {
      this.platform.log.debug('trackChangedListener: track on device "%s" has changed to "%s"', device.Name, trackUri);
      this.restorePreviousState(device);
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
    device.SetAVTransportURI(this.sonosSwitch.trackUri)
      .then(async played => {
        this.platform.log.debug('Submitted new trackUri to device "%s" from switch "%s": %o',
          device.Name, this.sonosSwitch.name, played);
        if (this.sonosSwitch.seekPosition) {
          await device.SeekPosition(this.sonosSwitch.seekPosition);
        }
        await this.savePreviousState(device);
        if (this.sonosSwitch.volume) {
          this.platform.log.debug('Setting volume on device "%s" to %d', device.Name, this.sonosSwitch.volume);
          await device.SetVolume(this.sonosSwitch.volume);
        }
        // register a listener that restores the previous state if playback of the track has stopped
        if (!device.Events.listeners(SonosEvents.CurrentTransportState).includes(playbackStoppedListener)) {
          device.Events.on(SonosEvents.CurrentTransportState, playbackStoppedListener);
        }
        // register a listener that restores the previous state if the track changes
        // TODO: don't restore trackUri in this case?
        if (!device.Events.listeners(SonosEvents.CurrentTrackUri).includes(trackChangedListener)) {
          device.Events.on(SonosEvents.CurrentTrackUri, trackChangedListener);
        }
        await device.Play();
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
      const deviceState: DeviceState = {
        volume: undefined,
        queueUri: undefined,
        trackUri: undefined,
        playing: false,
      };

      const [mediaInfo, transportInfo, volumeInfo] = await Promise.all([
        device.AVTransportService.GetMediaInfo(),
        device.AVTransportService.GetTransportInfo(),
        device.RenderingControlService.GetVolume({ InstanceID: 0, Channel: 'Master' }),
      ]);

      deviceState.volume = volumeInfo.CurrentVolume;
      deviceState.playing = transportInfo.CurrentTransportState === 'PLAYING';
      deviceState.trackUri= mediaInfo.CurrentURI;
      deviceState.queueUri = `x-rincon-queue:${device.Uuid}#0`;

      this.previousDeviceState.set(device.Uuid, deviceState);
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
      this.platform.log.debug('Starting restore on device "%s"', device.Name);

      const promises: Promise<unknown>[] = [];

      if (previousState.volume !== undefined) {
        const volumePromise = device.RenderingControlService.SetVolume({
          InstanceID: 0,
          Channel: 'Master',
          DesiredVolume: previousState.volume,
        });
        this.platform.log.debug('Restored volume to %d on device "%s"', previousState.volume, device.Name);
        promises.push(volumePromise);
      }

      // TODO: figure out how queue uri restore works...
      /*
      let trackUriWasSet = false;
      if (previousState.trackUri) {
        const trackPromise = device.AVTransportService.SetAVTransportURI({
          InstanceID: 0,
          CurrentURI: previousState.trackUri,
          CurrentURIMetaData: '',
        }).then(() => {
          trackUriWasSet = true;
        }).catch(e => {
          this.platform.log.debug('Setting trackUri failed: '+ JSON.stringify(e));
        });
        promises.push(trackPromise);
      }*/
      if (previousState.queueUri) {
        const queuePromise = device.AVTransportService.SetAVTransportURI({
          InstanceID: 0,
          CurrentURI: previousState.queueUri,
          CurrentURIMetaData: '',
        }).catch(e => {
          this.platform.log.debug('Setting queueUri failed: '+ JSON.stringify(e));
        });
        promises.push(queuePromise);
      }

      await Promise.all(promises);

      if (previousState.playing) {
        await device.AVTransportService.Play({InstanceID: 0, Speed: '1'});
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
