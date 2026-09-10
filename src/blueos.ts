import type { Logging } from 'homebridge';

import { XMLParser } from 'fast-xml-parser';

import { DEFAULT_HTTP_TIMEOUT_MS } from './settings.js';

/**
 * Everything this plugin needs from a BluOS player's /SyncStatus endpoint. This is the BluOS HTTP
 * "Custom Integration API" (port 11000), which is used only to identify and enumerate a discovered
 * device - not for runtime control, which happens over MQTT.
 */
export interface BlueOsSyncStatus {
  mac: string;
  name: string;
  brand: string;
  model: string;
  modelName: string;
}

/** A physical Capture input, as read from /RadioBrowse?service=Capture. */
export interface CaptureInput {
  /** The integer this input was assigned in the Home app's input list (derived from `id`). */
  position: number;
  name: string;
  id: string;
  inputType: string;
  /** The exact `url` attribute from /RadioBrowse, used to select this input via /Play?url=... . */
  playUrl: string;
}

const xmlParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });

async function httpGetText(url: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText} for ${url}`);
    }
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetches and parses /SyncStatus. Gives us the amplifier's MAC address, brand and model - used to
 * decide whether a device found on the network is a NAD amplifier, and whether it matches a
 * configured device.
 */
export async function fetchSyncStatus(
  host: string,
  port: number,
  timeoutMs: number = DEFAULT_HTTP_TIMEOUT_MS,
): Promise<BlueOsSyncStatus> {
  const xml = await httpGetText(`http://${host}:${port}/SyncStatus`, timeoutMs);
  const parsed = xmlParser.parse(xml);
  const node = parsed.SyncStatus;
  if (!node || typeof node !== 'object') {
    throw new Error('Unexpected /SyncStatus response: missing <SyncStatus> element');
  }

  return {
    mac: String(node['@_mac'] ?? ''),
    name: String(node['@_name'] ?? ''),
    brand: String(node['@_brand'] ?? ''),
    model: String(node['@_model'] ?? ''),
    modelName: String(node['@_modelName'] ?? node['@_model'] ?? ''),
  };
}

/**
 * Fetches and parses /RadioBrowse?service=Capture into a list of physical inputs, deriving each
 * one's "source" position from its id attribute (e.g. "xdynamic-Source3" or "input0" -> 3, 0).
 *
 * Bluetooth is deliberately excluded: on a BluOS player it isn't a discrete physical source position
 * like an optical or coax input, it's reached the same way as any other streaming service (Spotify,
 * Tidal, AirPlay, ...) - through the normal BluOS/streaming source. That source isn't listed here at
 * all, since this endpoint only enumerates physical Capture inputs, so callers should add it
 * themselves (see DEFAULT_STREAM_SOURCE_POSITION in settings.ts).
 */
export async function fetchCaptureInputs(
  host: string,
  port: number,
  log?: Logging,
  timeoutMs: number = DEFAULT_HTTP_TIMEOUT_MS,
): Promise<CaptureInput[]> {
  const xml = await httpGetText(`http://${host}:${port}/RadioBrowse?service=Capture`, timeoutMs);
  log?.debug('Raw /RadioBrowse?service=Capture response from %s: %s', host, xml);
  const parsed = xmlParser.parse(xml);
  const root = parsed.radiotime;
  if (!root || typeof root !== 'object') {
    return [];
  }

  const rawItems = root.item ?? [];
  const items = Array.isArray(rawItems) ? rawItems : [rawItems];

  const inputs: CaptureInput[] = [];
  for (const item of items) {
    const inputType = String(item['@_inputType'] ?? '').toLowerCase();
    if (inputType === 'bluetooth') {
      continue;
    }

    const id = String(item['@_id'] ?? '');
    const match = id.match(/(\d+)$/);
    if (!match) {
      continue;
    }

    inputs.push({
      position: Number(match[1]),
      name: String(item['@_text'] ?? id),
      id,
      inputType,
      // The XML attribute is percent-encoded (e.g. %3A for ':'); decode it once here so
      // playCaptureInput can send it exactly as-is, matching the raw form confirmed to work
      // against the amplifier directly (colons/commas/slashes/'?' unencoded).
      playUrl: decodeURIComponent(String(item['@_URL'] ?? '')),
    });
  }

  inputs.sort((a, b) => a.position - b.position);
  return inputs;
}

/** The subset of /Status this plugin cares about: what input/service is currently active. */
export interface BlueOsStatus {
  /** id of the active Capture input (matches a CaptureInput.id from /RadioBrowse), when service is "Capture". */
  inputId: string;
  /** "Capture" when a physical input is selected; some other service name otherwise (streaming). */
  service: string;
  /** Current volume, already in percent (0-100) - confirmed to match the volume_percent MQTT topic's scale. */
  volumePercent: number;
  muted: boolean;
}

/**
 * Fetches and parses /Status, used at startup to read the amplifier's *current* input so the Home
 * app can show it immediately, rather than waiting for the first MQTT telemetry change (which never
 * comes until something actually changes).
 */
export async function fetchStatus(
  host: string,
  port: number,
  log?: Logging,
  timeoutMs: number = DEFAULT_HTTP_TIMEOUT_MS,
): Promise<BlueOsStatus> {
  const xml = await httpGetText(`http://${host}:${port}/Status`, timeoutMs);
  log?.debug('Raw /Status response from %s: %s', host, xml);
  const parsed = xmlParser.parse(xml);
  const node = parsed.status;
  if (!node || typeof node !== 'object') {
    throw new Error('Unexpected /Status response: missing <status> element');
  }

  return {
    inputId: String(node.inputId ?? ''),
    service: String(node.service ?? ''),
    volumePercent: Number(node.volume ?? 0),
    muted: String(node.mute ?? '0').trim() === '1',
  };
}

/**
 * Selects a physical Capture input by issuing an HTTP GET to /Play?url=<url>, using the exact
 * `url` value read for that input from /RadioBrowse (see CaptureInput.playUrl). Input switching
 * isn't reliably controllable over the MQTT "source" topic on this bridge - this HTTP call is
 * the mechanism confirmed to actually work.
 */
export async function playCaptureInput(
  host: string,
  port: number,
  playUrl: string,
  timeoutMs: number = DEFAULT_HTTP_TIMEOUT_MS,
): Promise<void> {
  // playUrl is used as-is, unencoded - this matches the exact request confirmed to work against
  // the amplifier (e.g. "Capture:hw:imxspdif,0/1/25/2?id=input0"), including its embedded "?".
  await httpGetText(`http://${host}:${port}/Play?url=${playUrl}`, timeoutMs);
}
