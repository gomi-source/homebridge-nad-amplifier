import type { API, Characteristic, DynamicPlatformPlugin, Logging, PlatformAccessory, PlatformConfig, Service } from 'homebridge';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { type CaptureInput, fetchCaptureInputs, fetchStatus } from './blueos.js';
import { type DiscoveredNadDevice, NadDiscovery } from './discovery.js';
import { NadMqttClient } from './mqttClient.js';
import { NadAmplifierAccessory } from './nadAccessory.js';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js';
import type { NadAccessoryContext, NadAmplifierPlatformConfig, NadDeviceConfig } from './types.js';
import { normalizeMac } from './util.js';

const DEFAULT_STREAM_SOURCE_POSITION = 9;
const DEFAULT_DISCOVERY_INTERVAL_MINUTES = 10;

/** Name of the file (in Homebridge's storage directory) tracking which devices this plugin has ever published. */
const PUBLISHED_DEVICES_FILE = 'nad-amplifier-published-devices.json';

interface PublishedDeviceRecord {
  name: string;
  macaddress: string;
}

/**
 * Main platform: validates config, finds NAD amplifiers on the network, matches them against
 * configured devices by MAC address, and publishes HomeKit accessories for the matches.
 *
 * A device found on the network is never added to HomeKit until it has a matching entry (by MAC
 * address) under `devices` in the config, since without it we have no MQTT topic id or volume range
 * to control it with - and this plugin requires MQTT as its prerequisite control channel, so nothing
 * is registered at all until an "mqtt" block is present in the config.
 *
 * Accessories are published with `publishExternalAccessories` rather than `registerPlatformAccessories`:
 * HomeKit only honors an accessory's Category (and so the receiver icon) for standalone accessories,
 * not ones bridged under Homebridge's shared pairing. The tradeoff is that Homebridge never restores
 * these from its own accessory cache (`configureAccessory` is never called for them) and there is no
 * API to unpublish one - see warnAboutRemovedDevices() below for how removal is handled instead.
 */
export class NadAmplifierPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;
  public readonly config: NadAmplifierPlatformConfig;
  public mqtt?: NadMqttClient;

  private readonly configuredDevicesByMac = new Map<string, NadDeviceConfig>();
  private readonly loggedUnconfiguredMacs = new Set<string>();
  private readonly liveAccessories = new Map<string, NadAmplifierAccessory>();
  private readonly publishedDevicesFile: string;
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
    this.publishedDevicesFile = path.join(this.api.user.storagePath(), PUBLISHED_DEVICES_FILE);

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

  /**
   * Invoked by Homebridge for any accessory it restored from its platform-accessory cache. This
   * plugin no longer uses that mechanism (see the class comment above), so any accessory that shows
   * up here is a leftover from before the switch to external accessories - unregister it immediately
   * rather than leaving a stale, never-updated duplicate of the (now externally-published) accessory.
   */
  configureAccessory(accessory: PlatformAccessory): void {
    this.log.info(
      '"%s" was cached from the old platform-accessory registration; this plugin now publishes devices as ' +
      'external accessories instead, so this stale cache entry is being removed. If it left behind a duplicate ' +
      'tile in the Home app, remove that one manually.',
      accessory.displayName,
    );
    this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
  }

  private startPlatform(): void {
    this.warnAboutRemovedDevices();

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
   * External accessories have no "unpublish" API, so a device removed from config can't be cleaned
   * out of HomeKit automatically - the best this plugin can do is notice the removal and say so
   * loudly, rather than leaving it to silently show "No Response" forever with no explanation.
   *
   * This works by keeping its own small record (in Homebridge's storage directory, not the HomeKit
   * accessory cache) of every device id/MAC this plugin has been configured to publish. Every startup,
   * anything in that record that's no longer in the current config gets a warning; the record is then
   * overwritten with the current config's device list.
   */
  private warnAboutRemovedDevices(): void {
    const previouslyPublished = this.readPublishedDevicesRecord();

    for (const [mac, info] of Object.entries(previouslyPublished)) {
      if (!this.configuredDevicesByMac.has(mac)) {
        this.log.warn(
          'Device "%s" (MAC %s) is no longer in your config. It cannot be removed from HomeKit automatically ' +
          '(external accessories have no "unpublish" API) - if it was added to the Home app, remove it manually ' +
          '(press and hold the tile, then Remove Accessory), or it will keep showing as "No Response".',
          info.name, info.macaddress,
        );
      }
    }

    const updated: Record<string, PublishedDeviceRecord> = {};
    for (const [mac, deviceConfig] of this.configuredDevicesByMac) {
      updated[mac] = { name: deviceConfig.name?.trim() || deviceConfig.id, macaddress: deviceConfig.macaddress };
    }
    this.writePublishedDevicesRecord(updated);
  }

  private readPublishedDevicesRecord(): Record<string, PublishedDeviceRecord> {
    try {
      const raw = fs.readFileSync(this.publishedDevicesFile, 'utf8');
      return JSON.parse(raw) as Record<string, PublishedDeviceRecord>;
    } catch {
      return {};
    }
  }

  private writePublishedDevicesRecord(record: Record<string, PublishedDeviceRecord>): void {
    try {
      fs.writeFileSync(this.publishedDevicesFile, JSON.stringify(record, null, 2));
    } catch (err) {
      this.log.debug('Could not persist the published-devices record: %s', (err as Error).message);
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
      // Already published and subscribed this run - just refresh the connection details in case the
      // IP changed, rather than tearing down in-memory state (active/volume/mute) or trying to
      // publish the same external accessory UUID a second time.
      existingHandler.updateConnection(discovered.host, discovered.port);
      return;
    }

    const displayName = deviceConfig.name?.trim() || `NAD ${discovered.modelName || discovered.model || deviceConfig.id}`;

    let inputs: CaptureInput[];
    try {
      inputs = await fetchCaptureInputs(discovered.host, discovered.port, this.log);
      this.log.debug('%s: fetched inputs from /RadioBrowse: %s', deviceConfig.id, JSON.stringify(inputs));
    } catch (err) {
      this.log.warn(
        'Could not read the input list from %s (%s). It will be added without inputs for now.',
        discovered.host, (err as Error).message,
      );
      inputs = [];
    }

    const streamSourcePosition = deviceConfig.streamSourcePosition ?? DEFAULT_STREAM_SOURCE_POSITION;

    let initialActiveIdentifier: number | undefined;
    let initialVolumePercent: number | undefined;
    let initialMuted: boolean | undefined;
    try {
      const status = await fetchStatus(discovered.host, discovered.port, this.log);
      initialActiveIdentifier = status.service === 'Capture'
        ? inputs.find((input) => input.id === status.inputId)?.position
        : streamSourcePosition;
      initialVolumePercent = status.volumePercent;
      initialMuted = status.muted;
      this.log.debug(
        '%s: current status from /Status: service=%s inputId=%s volume=%s mute=%s -> initial ActiveIdentifier=%s',
        deviceConfig.id, status.service, status.inputId, status.volumePercent, status.muted, initialActiveIdentifier,
      );
    } catch (err) {
      this.log.warn(
        'Could not read current status from %s (%s). It will start with a default input selection.',
        discovered.host, (err as Error).message,
      );
    }

    const context: NadAccessoryContext = {
      device: {
        id: deviceConfig.id,
        macaddress: deviceConfig.macaddress,
        name: displayName,
        streamSourcePosition,
        host: discovered.host,
        port: discovered.port,
        model: discovered.model,
        modelName: discovered.modelName,
      },
      inputs,
      initialActiveIdentifier,
      initialVolumePercent,
      initialMuted,
    };

    this.log.info('Publishing accessory: %s', displayName);
    const accessory = new this.api.platformAccessory(displayName, uuid, this.api.hap.Categories.AUDIO_RECEIVER);
    accessory.context = context;
    this.api.publishExternalAccessories(PLUGIN_NAME, [accessory]);

    this.liveAccessories.set(uuid, new NadAmplifierAccessory(this, accessory));
  }
}
