import type { PlatformConfig } from 'homebridge';

import type { CaptureInput } from './blueos.js';

export interface MqttConfig {
  host: string;
  port?: number;
  username?: string;
  password?: string;
  /** Base of the command topic, e.g. "cmd" for cmd/<id>/volume. Defaults to "cmd". */
  topicBaseCommand?: string;
  /** Base of the telemetry topic, e.g. "tele" for tele/<id>/volume. Defaults to "tele". */
  topicBaseTelemetry?: string;
}

export interface NadDeviceConfig {
  /** Arbitrary identifier used as the MQTT topic segment for this device, e.g. "m33". */
  id: string;
  /** MAC address of the amplifier, used to match it to what's discovered on the network. */
  macaddress: string;
  /** Friendly display name shown in the Home app. Defaults to "NAD <model>". */
  name?: string;
  /** Source position that returns the amplifier to normal BluOS/streaming playback. Defaults to 9. */
  streamSourcePosition?: number;
}

export interface NadAmplifierPlatformConfig extends PlatformConfig {
  devices?: NadDeviceConfig[];
  mqtt?: MqttConfig;
  /** How often (in minutes) to re-scan the network for configured amplifiers. 0 disables re-scanning. */
  discoveryIntervalMinutes?: number;
  /**
   * Mixed into each accessory's HomeKit identifier alongside its MAC address. Only needed if more than
   * one Homebridge instance (e.g. dev and production) is configured against the same physical
   * amplifier(s) - without this, both instances derive the exact same identifier from the MAC address
   * alone and collide in the Home app. Leave unset for a single Homebridge instance; give each
   * instance its own distinct value (e.g. "dev") if you run more than one against the same hardware.
   */
  instanceId?: string;
}

/** Fully-resolved, defaulted runtime settings for one accessory - stored in accessory.context. */
export interface NadDeviceRuntime {
  id: string;
  macaddress: string;
  name: string;
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
