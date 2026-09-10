import Bonjour, { type Browser, type Service } from 'bonjour-service';
import type { Logging } from 'homebridge';

import { fetchSyncStatus } from './blueos.js';
import { BLUEOS_MDNS_PROTOCOL, BLUEOS_MDNS_TYPE } from './settings.js';

export interface DiscoveredNadDevice {
  host: string;
  port: number;
  mac: string;
  name: string;
  model: string;
  modelName: string;
}

export type DiscoveryCallback = (device: DiscoveredNadDevice) => void;

/**
 * Finds NAD amplifiers on the local network.
 *
 * BluOS players (which is what NAD's amplifiers run) advertise themselves over mDNS/Bonjour as
 * "_musc._tcp" - this is the same mechanism the BluOS app and Home Assistant's Bluesound integration
 * use to find players, so it works without needing to guess at IP ranges or use a proprietary
 * broadcast protocol.
 *
 * mDNS only tells us that *some* BluOS player exists at a given address; it says nothing about
 * brand or model. So for every service seen, we also query its BluOS HTTP API (/SyncStatus) and
 * only report it onwards if it identifies itself as an NAD-branded device.
 */
export class NadDiscovery {
  private bonjour?: Bonjour;
  private browser?: Browser;
  private readonly loggedNonNadMacs = new Set<string>();

  constructor(private readonly log: Logging) {}

  start(onDiscovered: DiscoveryCallback): void {
    this.bonjour = new Bonjour();
    this.browser = this.bonjour.find({ type: BLUEOS_MDNS_TYPE, protocol: BLUEOS_MDNS_PROTOCOL }, (service) => {
      this.probe(service, onDiscovered);
    });
  }

  /** Re-examines currently known mDNS records and re-fires discovery callbacks for each. */
  rescan(): void {
    this.browser?.update();
  }

  stop(): void {
    this.browser?.stop();
    this.bonjour?.destroy();
  }

  private probe(service: Service, onDiscovered: DiscoveryCallback): void {
    const host = service.referer?.address || service.addresses?.[0] || service.host;
    const port = service.port || 11000;
    if (!host) {
      return;
    }

    fetchSyncStatus(host, port)
      .then((sync) => {
        if (!sync.mac) {
          this.log.debug('Ignoring BluOS device at %s: /SyncStatus did not include a MAC address', host);
          return;
        }
        if (sync.brand.toUpperCase() !== 'NAD') {
          if (!this.loggedNonNadMacs.has(sync.mac)) {
            this.loggedNonNadMacs.add(sync.mac);
            this.log.debug('Ignoring non-NAD BluOS device "%s" (brand: %s) at %s', sync.name, sync.brand, host);
          }
          return;
        }
        onDiscovered({ host, port, mac: sync.mac, name: sync.name, model: sync.model, modelName: sync.modelName });
      })
      .catch((err: Error) => {
        this.log.debug('Could not query BluOS device at %s:%d (%s) - ignoring for now', host, port, err.message);
      });
  }
}
