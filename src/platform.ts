import {API, DynamicPlatformPlugin, Logging, PlatformAccessory, PlatformConfig, Service, Characteristic} from 'homebridge';

import {PLATFORM_NAME, PLUGIN_NAME} from './settings.js';
import {SonosControlPlatformAccessory} from './platformAccessory.js';
import {SonosDevice, SonosEvents, SonosManager} from '@svrooij/sonos/lib/index.js';
import {SonosSwitch} from './SonosSwitch';
import {PluginConfiguration} from './PluginConfiguration';
import {Track} from '@svrooij/sonos/lib/models';
import { CronJob } from 'cron';


/**
 * HomebridgePlatform
 * This class is the main constructor for your plugin, this is where you should
 * parse the user config and discover/register accessories with Homebridge.
 */
export class SonosControlPlatform implements DynamicPlatformPlugin {

  get getDiscoveredSonosCoordinatorDevices(): Array<SonosDevice> {
    return [...this.discoveredSonosCoordinatorDevices];
  }

  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;

  // this is used to track restored cached accessories
  private readonly accessories: PlatformAccessory[] = [];
  private readonly sonosManager: SonosManager;
  private readonly secondarySonosManager: SonosManager | undefined;
  private readonly discoveredSonosCoordinatorDevices: Set<SonosDevice>;
  private readonly pluginConfiguration: PluginConfiguration;
  private cronJobs: Array<CronJob> = [];

  constructor(
    public readonly log: Logging,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;
    this.sonosManager = new SonosManager();
    this.discoveredSonosCoordinatorDevices = new Set();
    try {
      this.pluginConfiguration = this.parseConfiguration();
    } catch (_error) {
      this.pluginConfiguration = {switches: [], sonosDeviceIp: undefined, secondarySonosDeviceIp: undefined};
      return;
    }
    if (this.pluginConfiguration.secondarySonosDeviceIp) {
      this.secondarySonosManager = new SonosManager();
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

  private registerCoordinatorDevice(device: SonosDevice) {
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
      this.discoveredSonosCoordinatorDevices.add(device);
    }
  }

  async discoverSonosDevices(): Promise<boolean> {
    try {
      if (this.pluginConfiguration.sonosDeviceIp) {
        this.log.info('Discovering Sonos devices by IP %s...', this.pluginConfiguration.sonosDeviceIp);
        await this.sonosManager.InitializeFromDevice(this.pluginConfiguration.sonosDeviceIp);
      } else {
        this.log.info('Initializing Sonos by auto discovery...');
        await this.sonosManager.InitializeWithDiscovery(10);
      }

      this.sonosManager.Devices.forEach(device => this.registerCoordinatorDevice(device));

      if (this.secondarySonosManager && this.pluginConfiguration.secondarySonosDeviceIp) {
        try {
          this.log.info('Discovering Sonos additional devices by secondary IP %s...', this.pluginConfiguration.secondarySonosDeviceIp);
          await this.secondarySonosManager.InitializeFromDevice(this.pluginConfiguration.secondarySonosDeviceIp);
          this.secondarySonosManager.Devices.forEach(device => this.registerCoordinatorDevice(device));
        } catch (error) {
          this.log.error('Error while discovering S1 devices: ', error);
        }
      }

      if (this.discoveredSonosCoordinatorDevices.size === 0) {
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

      let platformAccessory: SonosControlPlatformAccessory;
      if (existingAccessory) {
        // the accessory already exists
        this.log.debug('Restoring existing accessory from cache:', existingAccessory.displayName);
        platformAccessory= new SonosControlPlatformAccessory(this, existingAccessory, configuredSwitch);

      } else {
        // the accessory does not yet exist, so we need to create it
        this.log.debug('Adding new accessory:', configuredSwitch.name);

        // create a new accessory
        const accessory = new this.api.platformAccessory(configuredSwitch.name, uuid);
        accessory.context.device = configuredSwitch;
        platformAccessory= new SonosControlPlatformAccessory(this, accessory, configuredSwitch);

        // link the accessory to your platform
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }

      configuredSwitch.cronExpressions.forEach((cronExpression) => {
        try {
          const job = CronJob.from({
            cronTime: cronExpression,
            onTick: () => {
              platformAccessory.turnOnSwitchState();
              platformAccessory.setOn(true).then(() => {
                this.log.debug('Switch %s triggered by cron expression.', configuredSwitch.name);
              });
            },
            start: true,
          });
          this.cronJobs.push(job);
        } catch (_error) {
          this.log.error('Failed to parse cronExpression: %s', cronExpression);
        }
      });
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
    const hasLegacyCronExpression = this.config.switches?.some(
      (configuredSwitch: { cronExpression?: string }) => Boolean(configuredSwitch.cronExpression),
    );
    if (hasLegacyCronExpression) {
      this.log.warn('A legacy "cronExpression" configuration was detected. Please migrate from "cronExpression" to "cronExpressions".');
    }
    // TODO: add boolean to not restore state (for tracks)
    this.config.switches?.forEach((configuredSwitch: {
      name: string;
      sonosDeviceNames: string[];
      onlyWhenPlaying: boolean;
      // legacy property
      cronExpression?: string;
      cronExpressions?: string[];
      tracks: {
        trackUri: string;
        volume?: number;
        nativeNotification: boolean;
        seekPosition?: string;
        stopAfter?: number;
        repeatContinuously?: boolean;
      }[];
    }) => {
      switches.push({
        name: configuredSwitch.name,
        sonosDeviceNames: configuredSwitch.sonosDeviceNames,
        onlyWhenPlaying: configuredSwitch.onlyWhenPlaying,
        cronExpressions: configuredSwitch.cronExpressions ??
          (configuredSwitch.cronExpression ? [configuredSwitch.cronExpression] : []),
        tracks: configuredSwitch.tracks.map(configTrack => ({
          trackUri: configTrack.trackUri,
          volume: this.getValidVolume(configTrack),
          isNativeNotification: configTrack.nativeNotification,
          seekPosition: this.getValidSeekPosition(configTrack),
          stopAfter: this.getValidStopAfter(configTrack),
          repeatContinuously: configTrack.repeatContinuously ?? false,
        })),
      });
    });

    return {
      switches: switches,
      sonosDeviceIp: this.getValidSonosDeviceIp(),
      secondarySonosDeviceIp: this.getValidSecondarySonosDeviceIp(),
    };
  }

  private getValidStopAfter(configTrack: {
    trackUri: string;
    volume?: number;
    nativeNotification: boolean;
    seekPosition?: string;
    stopAfter?: number;
  }) {
    if (configTrack.stopAfter && (configTrack.stopAfter < 1)) {
      this.log.error('stopAfter: %d is an invalid stopAfter value.', configTrack.stopAfter);
      throw Error();
    }
    return configTrack.stopAfter;
  }

  private getValidSeekPosition(configTrack: {
    trackUri: string;
    volume?: number;
    nativeNotification: boolean;
    seekPosition?: string;
    stopAfter?: number;
  }) {
    if(configTrack.seekPosition &&
      !/^[0-9]{2}:[0-9]{2}:[0-9]{2}$/.test(configTrack.seekPosition)) {
      this.log.error('seekPosition: %s is not a valid seek position.', configTrack.seekPosition);
      throw Error();
    }
    return configTrack.seekPosition;
  }

  private getValidVolume(configTrack: {
    trackUri: string;
    volume?: number;
    nativeNotification: boolean;
    seekPosition?: string;
    stopAfter?: number;
  }) {
    if (configTrack.volume && (configTrack.volume < 1 || configTrack.volume > 100)) {
      this.log.error('volume: %d is an invalid volume value.', configTrack.volume);
      throw Error();
    }
    return configTrack.volume;
  }

  private getValidSonosDeviceIp() {
    if(this.config.sonosDeviceIp && (!(typeof this.config.sonosDeviceIp === 'string') ||
      !/^(\d{1,3}\.){3}\d{1,3}$/.test(this.config.sonosDeviceIp))) {
      this.log.error('sonosDeviceIp: %s is not a valid IPv4 address.', this.config.sonosDeviceIp);
      throw Error();
    }
    return this.config.sonosDeviceIp;
  }

  private getValidSecondarySonosDeviceIp() {
    if(this.config.secondarySonosDeviceIp && (!(typeof this.config.secondarySonosDeviceIp === 'string') ||
      !/^(\d{1,3}\.){3}\d{1,3}$/.test(this.config.secondarySonosDeviceIp))) {
      this.log.error('secondarySonosDeviceIp: %s is not a valid IPv4 address.', this.config.secondarySonosDeviceIp);
      throw Error();
    }
    return this.config.secondarySonosDeviceIp;
  }

  shutdown() {
    this.log.info('Shutting down platform...');
    this.sonosManager.CancelSubscription();
    this.secondarySonosManager?.CancelSubscription();
    this.log.debug('Stopping %d cron jobs...', this.cronJobs.length);
    this.cronJobs.forEach(cronJob => {
      cronJob.stop();
    });
  }

}
