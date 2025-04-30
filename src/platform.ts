import {API, DynamicPlatformPlugin, Logging, PlatformAccessory, PlatformConfig, Service, Characteristic} from 'homebridge';

import {PLATFORM_NAME, PLUGIN_NAME} from './settings.js';
import {SonosControlPlatformAccessory} from './platformAccessory.js';
import {SonosDevice, SonosEvents, SonosManager} from '@svrooij/sonos/lib/index.js';
import {SonosSwitch} from './SonosSwitch';
import {PluginConfiguration} from './PluginConfiguration';
import {Track} from '@svrooij/sonos/lib/models';


/**
 * HomebridgePlatform
 * This class is the main constructor for your plugin, this is where you should
 * parse the user config and discover/register accessories with Homebridge.
 */
export class SonosControlPlatform implements DynamicPlatformPlugin {

  get getDiscoveredSonosCoordinatorDevices(): Array<SonosDevice> {
    return this.discoveredSonosCoordinatorDevices;
  }

  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;

  // this is used to track restored cached accessories
  private readonly accessories: PlatformAccessory[] = [];
  private readonly sonosManager: SonosManager;
  private readonly discoveredSonosCoordinatorDevices: Array<SonosDevice>;
  private readonly pluginConfiguration: PluginConfiguration;

  constructor(
    public readonly log: Logging,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;
    this.sonosManager = new SonosManager();
    this.discoveredSonosCoordinatorDevices = [];
    try {
      this.pluginConfiguration = this.parseConfiguration();
    } catch (error) {
      this.pluginConfiguration = {switches: [], sonosDeviceIp: undefined};
      return;
    }

    this.discoverSonosDevices()
      .then((successful) => {
        if (!successful) {
          this.log.error('Failed to discover Sonos devices.');
          new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
          return;
        }
      });

    this.log.debug('Finished initializing platform:', this.config.name);

    // Homebridge 1.8.0 introduced a `log.success` method that can be used to log success messages
    // For users that are on a version prior to 1.8.0, we need a 'polyfill' for this method
    if (!log.success) {
      log.success = log.info;
    }

    // When this event is fired it means Homebridge has restored all cached accessories from disk.
    // Dynamic Platform plugins should only register new accessories after this event was fired,
    // in order to ensure they weren't added to homebridge already. This event can also be used
    // to start discovery of new accessories.
    this.api.on('didFinishLaunching', () => {
      log.debug('Executed didFinishLaunching callback');
      // run the method to discover / register your devices as accessories
      this.restoreOrRegisterSwitches();
    });

    this.api.on('shutdown', this.shutdown.bind(this));
  }

  /**
   * This function is invoked when homebridge restores cached accessories from disk at startup.
   * It should be used to set up event handlers for characteristics and update respective values.
   */
  configureAccessory(accessory: PlatformAccessory) {
    this.log.info('Loading accessory from cache:', accessory.displayName);

    // add the restored accessory to the accessories cache, so we can track if it has already been registered
    this.accessories.push(accessory);
  }

  async discoverSonosDevices(): Promise<boolean> {
    try {
      if (this.pluginConfiguration.sonosDeviceIp) {
        this.log.info('Discovering Sonos devices by IP %s...' + this.pluginConfiguration.sonosDeviceIp);
        await this.sonosManager.InitializeFromDevice(this.pluginConfiguration.sonosDeviceIp);
      } else {
        this.log.info('Initializing Sonos by auto discovery...');
        await this.sonosManager.InitializeWithDiscovery(10);
      }

      this.sonosManager.Devices.forEach(device => {
        this.log.info('Found device "%s" in group "%s". Is coordinator: %s',
          device.Name, device.GroupName ?? 'No group', device.IsCoordinator);

        if (device.IsCoordinator) {
          const transportStateListener = (state: string) => {
            this.log.debug('Transport state changed to %s on device "%s"', state, device.Name);
          };
          if (!device.Events.listeners(SonosEvents.CurrentTransportState).includes(transportStateListener)) {
            device.Events.on(SonosEvents.CurrentTransportState, transportStateListener);
          }
          const metaDataListener = (data: Track) => {
            this.log.debug('Current track metadata on device "%s": %s', device.Name, JSON.stringify(data));
          };
          if (!device.Events.listeners(SonosEvents.CurrentTrackMetadata).includes(metaDataListener)) {
            device.Events.on(SonosEvents.CurrentTrackMetadata, metaDataListener);
          }
          this.discoveredSonosCoordinatorDevices.push(device);
        }
      });

      if (this.discoveredSonosCoordinatorDevices.length === 0) {
        this.log.warn('No Sonos coordinator devices found.');
        return false;
      }
      return true;
    } catch (error) {
      this.log.error('Error while discovering devices: ', error);
      return false;
    }
  }

  restoreOrRegisterSwitches() {
    const configuredUUIDs: string[] = [];
    for (const configuredSwitch of this.pluginConfiguration.switches) {
      const uuid = this.api.hap.uuid.generate(configuredSwitch.name);
      configuredUUIDs.push(uuid);

      const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid);

      if (existingAccessory) {
        // the accessory already exists
        this.log.debug('Restoring existing accessory from cache:', existingAccessory.displayName);
        new SonosControlPlatformAccessory(this, existingAccessory, configuredSwitch);

      } else {
        // the accessory does not yet exist, so we need to create it
        this.log.debug('Adding new accessory:', configuredSwitch.name);

        // create a new accessory
        const accessory = new this.api.platformAccessory(configuredSwitch.name, uuid);
        accessory.context.device = configuredSwitch;
        new SonosControlPlatformAccessory(this, accessory, configuredSwitch);

        // link the accessory to your platform
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }
    }

    // remove accessories that are no longer configured
    this.accessories.forEach(accessory => {
      if (!configuredUUIDs.includes(accessory.UUID)) {
        this.log.debug(`🗑 Removing non-existing accessory: ${accessory.displayName}`);
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }
    });
  }

  parseConfiguration(): PluginConfiguration {
    const switches: Array<SonosSwitch> = [];
    // TODO: validate configuration
    if (this.config.notificationSwitches || this.config.trackSwitches) {
      this.log.error('Config schema has changed with version 1.0. Please refer to the documentation.');
      throw new Error();
    }
    // TODO: add boolean to not restore state (for tracks)
    this.config.switches?.forEach((configuredSwitch: {
      name: string;
      sonosDeviceNames: string[];
      onlyWhenPlaying: boolean;
      tracks: {
        trackUri: string;
        volume?: number;
        nativeNotification: boolean;
        seekPosition?: string;
        stopAfter?: number;
      }[];
    }) => {
      switches.push({
        name: configuredSwitch.name,
        sonosDeviceNames: configuredSwitch.sonosDeviceNames,
        onlyWhenPlaying: configuredSwitch.onlyWhenPlaying,

        tracks: configuredSwitch.tracks.map(configTrack => ({
          trackUri: configTrack.trackUri,
          volume: configTrack.volume,
          isNativeNotification: configTrack.nativeNotification,
          seekPosition: configTrack.seekPosition,
          stopAfter: configTrack.stopAfter,
        })),
      });
    });

    return {
      switches: switches,
      sonosDeviceIp: this.config.sonosDeviceIp,
    };
  }

  shutdown() {
    this.log.info('Shutting down platform...');
    this.sonosManager.CancelSubscription();
  }

}
