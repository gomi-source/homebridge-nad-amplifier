import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';

import type { CaptureInput } from './blueos.js';
import type { NadAmplifierPlatform } from './platform.js';
import { MQTT_OFF_PAYLOAD, MQTT_ON_PAYLOAD } from './settings.js';
import type { NadAccessoryContext } from './types.js';
import { clamp } from './util.js';

/**
 * Represents one NAD amplifier as a Television accessory (with a category of AUDIO_RECEIVER, which
 * gets it a proper amplifier/receiver icon in the Home app - there is no dedicated HomeKit service
 * for amplifiers). Exposes power, input source and a TelevisionSpeaker for volume/mute.
 *
 * All control happens over MQTT; the amplifier's HTTP interface is not used here at all.
 */
export class NadAmplifierAccessory {
  private readonly context: NadAccessoryContext;
  private readonly televisionService: Service;
  private readonly speakerService: Service;

  private active = false;
  private activeIdentifier = 0;
  /** Current volume in the amplifier's own units (matches the MQTT volume topic, e.g. -60..60). */
  private volume = 0;
  private muted = false;

  constructor(
    private readonly platform: NadAmplifierPlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    this.context = accessory.context as NadAccessoryContext;
    const device = this.context.device;

    accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'NAD')
      .setCharacteristic(this.platform.Characteristic.Model, device.modelName || device.model || 'BluOS Amplifier')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, device.macaddress);

    // --- Television service: power, input source ---
    this.televisionService = accessory.getService(this.platform.Service.Television)
      || accessory.addService(this.platform.Service.Television);

    this.televisionService.setCharacteristic(this.platform.Characteristic.ConfiguredName, device.name);
    this.televisionService.setCharacteristic(
      this.platform.Characteristic.SleepDiscoveryMode,
      this.platform.Characteristic.SleepDiscoveryMode.ALWAYS_DISCOVERABLE,
    );

    this.televisionService.getCharacteristic(this.platform.Characteristic.Active)
      .onGet(() => (this.active ? this.platform.Characteristic.Active.ACTIVE : this.platform.Characteristic.Active.INACTIVE))
      .onSet(this.setActive.bind(this));

    this.televisionService.getCharacteristic(this.platform.Characteristic.ActiveIdentifier)
      .onGet(() => this.activeIdentifier)
      .onSet(this.setActiveIdentifier.bind(this));

    // Siri Remote / Control Center navigation keys aren't meaningful for an amplifier; log and ignore.
    this.televisionService.getCharacteristic(this.platform.Characteristic.RemoteKey)
      .onSet((value: CharacteristicValue) => {
        this.platform.log.debug('%s: received RemoteKey %s (no action mapped for an amplifier)', device.name, value);
      });

    // --- Television Speaker service: mute, volume ---
    this.speakerService = accessory.getService(this.platform.Service.TelevisionSpeaker)
      || accessory.addService(this.platform.Service.TelevisionSpeaker);

    this.speakerService.setCharacteristic(
      this.platform.Characteristic.VolumeControlType,
      this.platform.Characteristic.VolumeControlType.ABSOLUTE,
    );

    this.speakerService.getCharacteristic(this.platform.Characteristic.Mute)
      .onGet(() => this.muted)
      .onSet(this.setMute.bind(this));

    this.speakerService.getCharacteristic(this.platform.Characteristic.Volume)
      .onGet(() => this.rawVolumeToPercent(this.volume))
      .onSet(this.setVolumePercent.bind(this));

    this.speakerService.getCharacteristic(this.platform.Characteristic.VolumeSelector)
      .onSet(this.setVolumeSelector.bind(this));

    this.televisionService.addLinkedService(this.speakerService);

    this.setupInputs(this.context.inputs);

    this.platform.mqtt?.onDeviceTelemetry(device.id, this.handleTelemetry.bind(this));
    this.platform.mqtt?.subscribeDevice(device.id);
  }

  /** Rebuilds the InputSource list, e.g. after a fresh /RadioBrowse read finds a changed input set. */
  refreshInputs(inputs: CaptureInput[]): void {
    this.context.inputs = inputs;
    this.setupInputs(inputs);
  }

  /** Updates the cached connection details after a re-discovery (e.g. the amplifier's IP changed). */
  updateConnection(host: string, port: number): void {
    this.context.device.host = host;
    this.context.device.port = port;
  }

  private setupInputs(inputs: CaptureInput[]): void {
    const device = this.context.device;
    const allInputs: Array<CaptureInput> = [
      ...inputs,
      { position: device.streamSourcePosition, name: 'BluOS', id: 'stream', inputType: 'stream' },
    ];

    const expectedSubtypes = new Set(allInputs.map((input) => `input-${input.position}`));
    for (const service of [...this.accessory.services]) {
      if (service.UUID === this.platform.Service.InputSource.UUID && !expectedSubtypes.has(service.subtype ?? '')) {
        this.accessory.removeService(service);
      }
    }

    for (const input of allInputs) {
      const subtype = `input-${input.position}`;
      const inputService = this.accessory.getServiceById(this.platform.Service.InputSource, subtype)
        || this.accessory.addService(this.platform.Service.InputSource, input.name, subtype);

      inputService
        .setCharacteristic(this.platform.Characteristic.Identifier, input.position)
        .setCharacteristic(this.platform.Characteristic.ConfiguredName, input.name)
        .setCharacteristic(this.platform.Characteristic.IsConfigured, this.platform.Characteristic.IsConfigured.CONFIGURED)
        .setCharacteristic(
          this.platform.Characteristic.CurrentVisibilityState,
          this.platform.Characteristic.CurrentVisibilityState.SHOWN,
        )
        .setCharacteristic(this.platform.Characteristic.InputSourceType, this.mapInputSourceType(input.inputType));

      this.televisionService.addLinkedService(inputService);
    }
  }

  private mapInputSourceType(inputType: string): number {
    // HAP has no connector-specific types beyond HDMI; HDMI ARC is the only one of the amplifier's
    // physical inputs that maps onto a real HAP InputSourceType, everything else falls back to OTHER.
    if (inputType === 'arc') {
      return this.platform.Characteristic.InputSourceType.HDMI;
    }
    return this.platform.Characteristic.InputSourceType.OTHER;
  }

  private handleTelemetry(key: string, payload: string): void {
    this.platform.log.debug('%s: telemetry %s = "%s"', this.context.device.name, key, payload);
    switch (key) {
    case 'power':
      this.active = this.isTruthyPayload(payload);
      this.televisionService.updateCharacteristic(
        this.platform.Characteristic.Active,
        this.active ? this.platform.Characteristic.Active.ACTIVE : this.platform.Characteristic.Active.INACTIVE,
      );
      break;

    case 'mute':
      this.muted = this.isTruthyPayload(payload);
      this.speakerService.updateCharacteristic(this.platform.Characteristic.Mute, this.muted);
      break;

    case 'volume': {
      const raw = Number(payload);
      if (Number.isNaN(raw)) {
        break;
      }
      this.volume = raw;
      if (!this.muted) {
        this.speakerService.updateCharacteristic(this.platform.Characteristic.Volume, this.rawVolumeToPercent(raw));
      }
      break;
    }

    case 'source': {
      const position = Number(payload);
      if (Number.isNaN(position)) {
        break;
      }
      this.activeIdentifier = position;
      this.televisionService.updateCharacteristic(this.platform.Characteristic.ActiveIdentifier, position);
      break;
    }

    default:
      this.platform.log.debug('%s: unhandled telemetry "%s" = %s', this.context.device.name, key, payload);
    }
  }

  private isTruthyPayload(payload: string): boolean {
    return ['1', 'true', 'on'].includes(payload.trim().toLowerCase());
  }

  private async setActive(value: CharacteristicValue): Promise<void> {
    this.active = value === this.platform.Characteristic.Active.ACTIVE;
    this.platform.mqtt?.publish(this.context.device.id, 'power', this.active ? MQTT_ON_PAYLOAD : MQTT_OFF_PAYLOAD);
  }

  private setActiveIdentifier(value: CharacteristicValue): void {
    const position = Number(value);
    this.activeIdentifier = position;
    this.platform.mqtt?.publish(this.context.device.id, 'source', position);
  }

  private setMute(value: CharacteristicValue): void {
    this.muted = Boolean(value);
    this.platform.mqtt?.publish(this.context.device.id, 'mute', this.muted ? MQTT_ON_PAYLOAD : MQTT_OFF_PAYLOAD);
  }

  private setVolumePercent(value: CharacteristicValue): void {
    const device = this.context.device;
    const percent = Number(value);
    const raw = Math.round(device.minVolume + (percent / 100) * (device.volumeCap - device.minVolume));
    this.volume = raw;
    this.platform.mqtt?.publish(device.id, 'volume', raw);
  }

  private setVolumeSelector(value: CharacteristicValue): void {
    const device = this.context.device;
    const delta = value === this.platform.Characteristic.VolumeSelector.INCREMENT ? 1 : -1;
    const next = clamp(this.volume + delta, device.minVolume, device.volumeCap);
    this.volume = next;
    this.platform.mqtt?.publish(device.id, 'volume', next);
  }

  private rawVolumeToPercent(raw: number): number {
    const device = this.context.device;
    const range = device.volumeCap - device.minVolume;
    if (range <= 0) {
      return 0;
    }
    return clamp(Math.round(((raw - device.minVolume) / range) * 100), 0, 100);
  }
}
