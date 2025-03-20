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
    sonosDevices.forEach(device => {
      this.platform.log.debug('Going to play on device ' + device.Name);

      if (this.sonosSwitch.isNotification) {
        device.PlayNotificationAudioClip({
          trackUri: this.sonosSwitch.trackUri,
          onlyWhenPlaying: this.sonosSwitch.onlyWhenPlaying,
          volume: this.sonosSwitch.volume,
        })
          .then(played => {
            this.platform.log.debug('Submitted notification %o', played);
            this.sonosSwitchService.getCharacteristic(this.platform.Characteristic.On).updateValue(false);
            this.deviceState.submittingAudio= false;
          });
      } else {
        const transportStateListener = (state: ExtendedTransportState) => {
          if (this.sonosSwitch.stopAfter) {
            if (state === 'PLAYING') {
              // deregister again
              device.Events.off(SonosEvents.CurrentTransportState, transportStateListener);
              setTimeout(() => {
                device.Stop();
              }, this.sonosSwitch.stopAfter * 1000);
            }
          }
        };
        if (this.sonosSwitch.stopAfter) {
          device.Events.on(SonosEvents.CurrentTransportState, transportStateListener);
        }
        device.SetAVTransportURI(this.sonosSwitch.trackUri)
          .then(async played => {
            this.platform.log.debug('Submitted new trackUri %o', played);
            if (this.sonosSwitch.seekPosition) {
              await device.SeekPosition(this.sonosSwitch.seekPosition);
            }
            if (this.sonosSwitch.volume) {
              await device.SetVolume(this.sonosSwitch.volume);
            }
            await device.Play();
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
