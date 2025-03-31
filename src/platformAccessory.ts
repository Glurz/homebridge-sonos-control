import {CharacteristicValue, PlatformAccessory, Service} from 'homebridge';
import {SonosControlPlatform} from './platform.js';
import {SonosSwitch} from './SonosSwitch';
import {SonosEvents} from '@svrooij/sonos/lib/index.js';
import {ExtendedTransportState} from '@svrooij/sonos/lib/models';


/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class SonosControlPlatformAccessory {

  private sonosSwitchService: Service;

  private deviceState = {
    submittingAudio: false,
  };

  private previousVolumeByUUID: Map<string, number | undefined> = new Map();

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
    this.previousVolumeByUUID.clear();
    sonosDevices.forEach(device => {
      if (this.sonosSwitch.isNotification) {
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
          this.deviceState.submittingAudio= false;
        });
      } else {
        const volumeRestoreListener= (trackUri: string) => {
          this.platform.log.debug('volumeRestoreListener: track on device "%s" has changed to "%s"', device.Name, trackUri);
          const previousVolume = this.previousVolumeByUUID.get(device.Uuid);
          if (previousVolume) {
            device.SetVolume(previousVolume).then(() => {
              this.platform.log.debug('volumeRestoreListener: restored volume to %d on device "%s"', previousVolume, device.Name);
              this.previousVolumeByUUID.set(device.Uuid, undefined);
              device.Events.off(SonosEvents.CurrentTrackUri, volumeRestoreListener);
            });
          }
        };
        const transportStateListener = (state: ExtendedTransportState) => {
          if (this.sonosSwitch.stopAfter) {
            if (state === 'PLAYING') {
              // de-register listener that stops after configured amount of time
              device.Events.off(SonosEvents.CurrentTransportState, transportStateListener);

              // register a listener that restores the previous volume after this track
              if (!device.Events.listeners(SonosEvents.CurrentTrackUri).includes(volumeRestoreListener)) {
                device.Events.on(SonosEvents.CurrentTrackUri, volumeRestoreListener);
              }
              setTimeout(() => {
                device.Stop();
              }, this.sonosSwitch.stopAfter * 1000);
            }
          }
        };
        if (this.sonosSwitch.stopAfter) {
          if (!device.Events.listeners(SonosEvents.CurrentTransportState).includes(transportStateListener)) {
            device.Events.on(SonosEvents.CurrentTransportState, transportStateListener);
          }
        }
        device.SetAVTransportURI(this.sonosSwitch.trackUri)
          .then(async played => {
            this.platform.log.debug('Submitted new trackUri to device "%s" from switch "%s": %o',
              device.Name, this.sonosSwitch.name, played);
            if (this.sonosSwitch.seekPosition) {
              await device.SeekPosition(this.sonosSwitch.seekPosition);
            }
            if (this.sonosSwitch.volume) {
              const previousVolume = this.previousVolumeByUUID.get(device.Uuid);
              if (previousVolume === undefined) {
                // store current device volume for later restore
                await device.RenderingControlService.GetVolume({InstanceID: 0, Channel: 'Master'})
                  .then(currentVolume => {
                    this.previousVolumeByUUID.set(device.Uuid, currentVolume.CurrentVolume);
                    this.platform.log.debug('Stored current volume %d of device "%s" for later restore',
                      currentVolume.CurrentVolume, device.Name);
                  });
              }
              this.platform.log.debug('Setting volume on device "%s" to %d', device.Name, this.sonosSwitch.volume);
              await device.SetVolume(this.sonosSwitch.volume);
            }
            await device.Play();
          }).catch(error => {
            this.platform.log.error('Error while playing track: ' + JSON.stringify(error));
          }).finally(() => {
            this.sonosSwitchService.getCharacteristic(this.platform.Characteristic.On).updateValue(false);
            this.deviceState.submittingAudio = false;
          });
      }
    });
  }

  /**
   * Handle "SET" requests from HomeKit
   * These are sent when the user changes the state of an accessory, for example, turns on a switch.
   */
  async setOn(value: CharacteristicValue) {
    // implement your own code to turn your device on/off
    this.deviceState.submittingAudio = value as boolean;
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
    const isOn = this.deviceState.submittingAudio;

    //this.platform.log.debug('Get Characteristic On: %s ->', this.sonosSwitch.name, isOn);

    // if you need to return an error to show the device as "Not Responding" in the Home app:
    // throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    return isOn;
  }

}
