import type { PlatformConfig } from 'homebridge';

import type { CaptureInput } from './blueos.js';

export interface MqttPayloadsConfig {
  /** Payload published to power on the amplifier. Defaults to "1". */
  powerOn?: string;
  /** Payload published to power off the amplifier. Defaults to "0". */
  powerOff?: string;
}

export interface MqttConfig {
  host: string;
  port?: number;
  username?: string;
  password?: string;
  /** Base of the command topic, e.g. "cmd" for cmd/<id>/volume. Defaults to "cmd". */
  topicBaseCommand?: string;
  /** Base of the telemetry topic, e.g. "tele" for tele/<id>/volume. Defaults to "tele". */
  topicBaseTelemetry?: string;
  payloads?: MqttPayloadsConfig;
}

export interface NadDeviceConfig {
  /** Arbitrary identifier used as the MQTT topic segment for this device, e.g. "m33". */
  id: string;
  /** MAC address of the amplifier, used to match it to what's discovered on the network. */
  macaddress: string;
  /** Friendly display name shown in the Home app. Defaults to "NAD <model>". */
  name?: string;
  /** Highest value ever written to the volume topic; what 100% (and un-muting) map to. Defaults to 60. */
  volumeCap?: number;
  /** Lowest value ever written to the volume topic; what 0% (and muting) map to. Defaults to -60. */
  minVolume?: number;
  /** Source position that returns the amplifier to normal BluOS/streaming playback. Defaults to 9. */
  streamSourcePosition?: number;
}

export interface NadAmplifierPlatformConfig extends PlatformConfig {
  devices?: NadDeviceConfig[];
  mqtt?: MqttConfig;
  /** How often (in minutes) to re-scan the network for configured amplifiers. 0 disables re-scanning. */
  discoveryIntervalMinutes?: number;
}

/** Fully-resolved, defaulted runtime settings for one accessory - stored in accessory.context. */
export interface NadDeviceRuntime {
  id: string;
  macaddress: string;
  name: string;
  volumeCap: number;
  minVolume: number;
  streamSourcePosition: number;
  host: string;
  port: number;
  model: string;
  modelName: string;
}

export interface NadAccessoryContext {
  device: NadDeviceRuntime;
  inputs: CaptureInput[];
}
