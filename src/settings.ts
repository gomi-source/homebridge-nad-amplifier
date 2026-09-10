/**
 * This is the name of the platform that users will use to register the plugin in the Homebridge config.json
 */
export const PLATFORM_NAME = 'NadAmplifier';

/**
 * This must match the name of the plugin as defined in package.json's `name` property
 */
export const PLUGIN_NAME = 'homebridge-nad-amplifier';

/** Default port of the BluOS HTTP API on the amplifier ("BluOS Custom Integration API"). */
export const BLUEOS_API_PORT = 11000;

/** mDNS/Bonjour service type advertised by every BluOS player, including NAD's BluOS-based amplifiers. */
export const BLUEOS_MDNS_TYPE = 'musc';
export const BLUEOS_MDNS_PROTOCOL = 'tcp';

/** Payload the amplifier's MQTT bridge expects for on/off (power) and on/off (mute). */
export const MQTT_ON_PAYLOAD = 'On';
export const MQTT_OFF_PAYLOAD = 'Off';

/**
 * "source" position written to reach normal BluOS/network streaming playback (as opposed to a physical
 * Capture input). Not returned by /RadioBrowse, since that endpoint only lists physical Capture inputs.
 */
export const DEFAULT_STREAM_SOURCE_POSITION = 9;

export const DEFAULT_DISCOVERY_INTERVAL_MINUTES = 10;

export const DEFAULT_HTTP_TIMEOUT_MS = 4000;
