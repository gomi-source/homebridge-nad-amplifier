import type { API, Characteristic, DynamicPlatformPlugin, Logging, PlatformAccessory, PlatformConfig, Service } from 'homebridge';

import { NadAmplifierAccessory } from './platformAccessory.js';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js';

import bent from 'bent';

/**
 * HomebridgePlatform
 * This class is the main constructor for your plugin, this is where you should
 * parse the user config and discover/register accessories with Homebridge.
 */
export class NadAmplifierPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;

  // this is used to track restored cached accessories
  public readonly accessories: Map<string, PlatformAccessory> = new Map();
  public readonly discoveredCacheUUIDs: string[] = [];

  /* This is only required when using Custom Services and Characteristics not support by HomeKit
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public readonly CustomServices: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public readonly CustomCharacteristics: any;
  */
  constructor(
    public readonly log: Logging,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;

    // MY CODE START

    // No configuration found - we won't start.
    if(!config) {
      return;
    }

    // If we don't have any HTTP server configured, we're done here.
    if(!config.mqtt.host) {
      this.log.error('No MQTT server has been configured.');
      return;
    }

    if(!config.http.basePath) {
      this.log.error('No HTTP server has been configured.');
      return;
    }

    // MY CODE STOP


    this.log.debug('Finished initializing platform:', this.config.name);

    // When this event is fired it means Homebridge has restored all cached accessories from disk.
    // Dynamic Platform plugins should only register new accessories after this event was fired,
    // in order to ensure they weren't added to homebridge already. This event can also be used
    // to start discovery of new accessories.
    this.api.on('didFinishLaunching', () => {
      log.debug('Executed didFinishLaunching callback');
      // run the method to discover / register your devices as accessories
      this.discoverDevices();
    });
  }

  /**
   * This function is invoked when homebridge restores cached accessories from disk at startup.
   * It should be used to set up event handlers for characteristics and update respective values.
   */
  configureAccessory(accessory: PlatformAccessory) {
    this.log.info('Loading accessory from cache:', accessory.displayName);

    // add the restored accessory to the accessories cache, so we can track if it has already been registered
    this.accessories.set(accessory.UUID, accessory);
  }

  /**
   * This is an example method showing how to register discovered accessories.
   * Accessories must only be registered once, previously created accessories
   * must not be registered again to prevent "duplicate UUID" errors.
   */
  async discoverDevices() {
    // Query REST API for devices
    const devices = await this.GetAmplifiers();
    console.debug('************ DISCOVERED DEVICES ************');
    console.debug(devices);

    // loop over the discovered devices and register each one if it has not already been registered
    for (const device of devices) {
      // generate a unique id for the accessory this should be generated from
      // something globally unique, but constant, for nad, the device serial
      // number or MAC address
      const uuid = this.api.hap.uuid.generate(device.mac_address!);

      // see if an accessory with the same uuid has already been registered and restored from
      // the cached devices we stored in the `configureAccessory` method above
      const existingAccessory = this.accessories.get(uuid);

      console.debug(device);
      if (existingAccessory) {
        // the accessory already exists
        this.log.info('Restoring existing accessory from cache:', existingAccessory.displayName);

        // if you need to update the accessory.context then you should run `api.updatePlatformAccessories`. e.g.:
        // existingAccessory.context.device = device;
        // this.api.updatePlatformAccessories([existingAccessory]);

        // create the accessory handler for the restored accessory
        // this is imported from `platformAccessory.ts`
        new NadAmplifierAccessory(this, existingAccessory);

        // it is possible to remove platform accessories at any time using `api.unregisterPlatformAccessories`, e.g.:
        // remove platform accessories when no longer present
        // this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [existingAccessory]);
        // this.log.info('Removing existing accessory from cache:', existingAccessory.displayName);
      } else {
        // the accessory does not yet exist, so we need to create it
        this.log.info('Adding new accessory:', device.id);

        // create a new accessory
        const accessory = new this.api.platformAccessory(device.id, uuid);

        // store a copy of the device object in the `accessory.context`
        // the `context` property can be used to store any data about the accessory you may need
        accessory.context.device = device;

        // create the accessory handler for the newly create accessory
        // this is imported from `platformAccessory.ts`
        new NadAmplifierAccessory(this, accessory);

        // link the accessory to your platform
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }

      // push into discoveredCacheUUIDs
      this.discoveredCacheUUIDs.push(uuid);
    }

    // you can also deal with accessories from the cache which are no longer present by removing them from Homebridge
    // for nad, if your plugin logs into a cloud account to retrieve a device list, and a user has previously removed a device
    // from this cloud account, then this device will no longer be present in the device list but will still be in the Homebridge cache
    for (const [uuid, accessory] of this.accessories) {
      if (!this.discoveredCacheUUIDs.includes(uuid)) {
        this.log.info('Removing existing accessory from cache:', accessory.displayName);
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }
    }
  }

  async GetAmplifiers(): Promise<Amplifier[]> {
    const amplifiers: Amplifier[] = [];

    const basic_auth_string = Buffer.from(this.config.username + ':' + this.config.password).toString('base64');
    const headers = {
      'Authorization': 'Basic ' + basic_auth_string,
    };

    const getJSON = bent('json');
    const response = await getJSON(this.config.http.basePath + '/amplifiers', '', headers);

    // Response is an array of amplifiers
    console.debug('************ AMPLIFIER RESPONSE ************');
    console.debug(response);

    for (const amp_response of response) {
      console.debug(amp_response.id);  // "m33"
      
      const amplifier = new Amplifier(amp_response.id);

      // Query for info on each amp
      const ampData = await getJSON(this.config.http.basePath + '/amplifiers/' + amp_response.id, '', headers);
      console.debug(ampData);
      amplifier.amplifier = ampData;
      amplifier.mac_address = ampData.mac_address;

      amplifiers.push(amplifier);
    }

    return amplifiers;
  }
}

export class Amplifier {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public amplifier: any;
  public mac_address?: string;

  constructor(
    public readonly id: string,

  ) {
    this.id = id;
  }
}