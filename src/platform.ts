import type { API, Characteristic, DynamicPlatformPlugin, Logging, PlatformAccessory, PlatformConfig, Service } from 'homebridge';

import { type CaptureInput, fetchCaptureInputs } from './blueos.js';
import { type DiscoveredNadDevice, NadDiscovery } from './discovery.js';
import { NadMqttClient } from './mqttClient.js';
import { NadAmplifierAccessory } from './nadAccessory.js';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js';
import type { NadAccessoryContext, NadAmplifierPlatformConfig, NadDeviceConfig } from './types.js';
import { normalizeMac } from './util.js';

const DEFAULT_MIN_VOLUME = -60;
const DEFAULT_VOLUME_CAP = 60;
const DEFAULT_STREAM_SOURCE_POSITION = 9;
const DEFAULT_DISCOVERY_INTERVAL_MINUTES = 10;

/**
 * Main platform: validates config, finds NAD amplifiers on the network, matches them against
 * configured devices by MAC address, and registers/updates HomeKit accessories for the matches.
 *
 * A device found on the network is never added to HomeKit until it has a matching entry (by MAC
 * address) under `devices` in the config, since without it we have no MQTT topic id or volume range
 * to control it with - and this plugin requires MQTT as its prerequisite control channel, so nothing
 * is registered at all until an "mqtt" block is present in the config.
 */
export class NadAmplifierPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;
  public readonly config: NadAmplifierPlatformConfig;
  public readonly accessories = new Map<string, PlatformAccessory>();
  public mqtt?: NadMqttClient;

  private readonly configuredDevicesByMac = new Map<string, NadDeviceConfig>();
  private readonly loggedUnconfiguredMacs = new Set<string>();
  private readonly liveAccessories = new Map<string, NadAmplifierAccessory>();
  private discovery?: NadDiscovery;
  private rescanTimer?: ReturnType<typeof setInterval>;

  constructor(
    public readonly log: Logging,
    config: PlatformConfig,
    public readonly api: API,
  ) {
    this.config = config as NadAmplifierPlatformConfig;
    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;

    for (const device of this.config.devices ?? []) {
      if (!device.id || !device.macaddress) {
        this.log.warn('Ignoring an entry under "devices" that is missing "id" or "macaddress": %s', JSON.stringify(device));
        continue;
      }
      this.configuredDevicesByMac.set(normalizeMac(device.macaddress), device);
    }

    this.api.on('didFinishLaunching', () => {
      this.log.debug('Executed didFinishLaunching callback');
      this.startPlatform();
    });

    this.api.on('shutdown', () => {
      this.discovery?.stop();
      if (this.rescanTimer) {
        clearInterval(this.rescanTimer);
      }
      this.mqtt?.destroy();
    });
  }

  /** Invoked by Homebridge for every accessory it restored from its cache on disk. */
  configureAccessory(accessory: PlatformAccessory): void {
    this.log.info('Loading accessory from cache:', accessory.displayName);
    this.accessories.set(accessory.UUID, accessory);
  }

  private startPlatform(): void {
    this.removeAccessoriesForRemovedDevices();

    if (!this.config.mqtt?.host) {
      this.log.error(
        'No MQTT broker configured. This plugin is controlled entirely through MQTT and will not add or update ' +
        'any devices until you add an "mqtt" block to its config (broker host/port, and credentials if required).',
      );
      return;
    }

    this.mqtt = new NadMqttClient(this.log, this.config.mqtt);
    this.mqtt.connect();

    this.discovery = new NadDiscovery(this.log);
    this.discovery.start((device) => this.handleDiscoveredDevice(device));

    const intervalMinutes = this.config.discoveryIntervalMinutes ?? DEFAULT_DISCOVERY_INTERVAL_MINUTES;
    if (intervalMinutes > 0) {
      this.rescanTimer = setInterval(() => this.discovery?.rescan(), intervalMinutes * 60 * 1000);
    }
  }

  /**
   * Removes any cached accessory whose device is no longer present under "devices" in the config.
   * This runs unconditionally at startup (even if MQTT is missing) so that deleting a device from
   * the config is enough to remove it, without needing it to be rediscovered on the network first.
   */
  private removeAccessoriesForRemovedDevices(): void {
    const expectedUUIDs = new Set(
      Array.from(this.configuredDevicesByMac.values())
        .map((device) => this.api.hap.uuid.generate(normalizeMac(device.macaddress))),
    );

    for (const [uuid, accessory] of this.accessories) {
      if (!expectedUUIDs.has(uuid)) {
        this.log.info('Removing accessory for a device no longer present in config: %s', accessory.displayName);
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        this.accessories.delete(uuid);
        this.liveAccessories.delete(uuid);
      }
    }
  }

  private handleDiscoveredDevice(discovered: DiscoveredNadDevice): void {
    const normalizedMac = normalizeMac(discovered.mac);
    const deviceConfig = this.configuredDevicesByMac.get(normalizedMac);

    if (!deviceConfig) {
      if (!this.loggedUnconfiguredMacs.has(normalizedMac)) {
        this.loggedUnconfiguredMacs.add(normalizedMac);
        this.log.info(
          'Discovered a NAD %s at %s (MAC %s) that is not yet configured. Add it under "devices" with this MAC ' +
          'address (and a topic id of your choice) to start controlling it through this plugin.',
          discovered.modelName || discovered.model || 'amplifier', discovered.host, discovered.mac,
        );
      }
      return;
    }

    this.registerDevice(deviceConfig, discovered).catch((err: Error) => {
      this.log.error('Failed to set up device "%s": %s', deviceConfig.id, err.message);
    });
  }

  private async registerDevice(deviceConfig: NadDeviceConfig, discovered: DiscoveredNadDevice): Promise<void> {
    const uuid = this.api.hap.uuid.generate(normalizeMac(deviceConfig.macaddress));

    const existingHandler = this.liveAccessories.get(uuid);
    if (existingHandler) {
      // Already set up and subscribed - just refresh the connection details in case the IP changed,
      // rather than tearing down and recreating in-memory state (active/volume/mute) on every rescan.
      existingHandler.updateConnection(discovered.host, discovered.port);
      return;
    }

    const displayName = deviceConfig.name?.trim() || `NAD ${discovered.modelName || discovered.model || deviceConfig.id}`;

    let inputs: CaptureInput[];
    try {
      inputs = await fetchCaptureInputs(discovered.host, discovered.port);
    } catch (err) {
      this.log.warn(
        'Could not read the input list from %s (%s). It will be added without inputs for now.',
        discovered.host, (err as Error).message,
      );
      inputs = [];
    }

    const context: NadAccessoryContext = {
      device: {
        id: deviceConfig.id,
        macaddress: deviceConfig.macaddress,
        name: displayName,
        volumeCap: deviceConfig.volumeCap ?? DEFAULT_VOLUME_CAP,
        minVolume: deviceConfig.minVolume ?? DEFAULT_MIN_VOLUME,
        streamSourcePosition: deviceConfig.streamSourcePosition ?? DEFAULT_STREAM_SOURCE_POSITION,
        host: discovered.host,
        port: discovered.port,
        model: discovered.model,
        modelName: discovered.modelName,
      },
      inputs,
    };

    let accessory = this.accessories.get(uuid);
    if (accessory) {
      this.log.info('Restoring existing accessory: %s', displayName);
      accessory.context = context;
      this.api.updatePlatformAccessories([accessory]);
    } else {
      this.log.info('Adding new accessory: %s', displayName);
      accessory = new this.api.platformAccessory(displayName, uuid, this.api.hap.Categories.AUDIO_RECEIVER);
      accessory.context = context;
      this.accessories.set(uuid, accessory);
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    }

    this.liveAccessories.set(uuid, new NadAmplifierAccessory(this, accessory));
  }
}
