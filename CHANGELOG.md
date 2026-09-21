# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project uses [Semantic Versioning](https://semver.org/).

## [0.8.1] - 2026-09-21

### Changed

- `engines.node` is now `^22 || ^24 || ^26`, matching what Homebridge itself requires
  and adding Node 26, which CI tests alongside 22 and 24. The previous `^22.10.0`
  floor was inherited from the Homebridge plugin template and had no basis - the v22
  line entered LTS at 22.11.0, not 22.10.0.
- The GitHub Actions workflows are now identical across the `gomi-source` Homebridge
  plugins: `build.yml` tests every supported Node release (Current, Active LTS and
  Maintenance LTS), runs the test suite when one exists, and audits dependencies;
  `publish.yml` runs verify -> build -> publish -> release.

## [0.8.0] - 2026-09-13

### Added

- `instanceId` config option, for running more than one Homebridge instance (e.g. a dev instance
  alongside production) against the same physical amplifier without them colliding. Each accessory's
  HomeKit identifier was previously derived purely from the amplifier's MAC address, so two instances
  configured for the same amp generated the identical identifier and couldn't both add it to the Home
  app. Optional - tucked into a collapsed "Development" section in the config UI, and leaving it unset
  changes nothing.

### Changed

- Initial state (power, mute, volume, source) is now obtained by publishing an empty payload to each
  MQTT command topic right after subscribing - the bridge treats that as a request for the current
  value and echoes it back on the matching telemetry topic. This replaces the previous approach (one
  HTTP `/Status` call at startup, added in 0.6.0) with a single mechanism used for every metric, and as
  a side effect now also refreshes state after an MQTT reconnect, not just at startup. `source` still
  gets checked against `/Status` before being trusted, since its telemetry is known to be ambiguous
  (see 0.7.0) - that check now runs through the same query instead of a separate startup-only path.
- Config UI reorganized: `Devices` and `MQTT Broker` are explicit, fully-rendered sections again;
  `instanceId` lives in a collapsed "Development" section since most installs will never need it.

### Known limitations

- Apple Home doesn't support a TV Speaker service in its own UI. This plugin still exposes one (for
  volume/mute), and other HomeKit apps (e.g. Eve) can show and control it, but it won't appear in the
  Home app itself - a Home app limitation, not something fixable from the plugin.

## [0.7.0] - 2026-09-10

### Added

- GitHub Actions workflow that publishes to npm on a semver tag pushed to `main`, using npm Trusted
  Publishing (OIDC) - no npm token stored as a repo secret. The tag is verified to actually be reachable
  from `main` and to match `package.json`'s version before anything is published.

### Fixed

- `source` telemetry ambiguity: the bridge could report the same position for the BluOS streaming
  source and for a physical Capture input (e.g. HDMI/ARC). Now disambiguated by checking the
  amplifier's HTTP `/Status` endpoint whenever the reported position is the ambiguous one.

### Changed

- Package made public on npm.

## [0.6.0] - 2026-09-10

Initial tracked release.

### Added

- Homebridge platform plugin exposing a NAD BluOS amplifier (built against the NAD M33) to Apple Home
  as an external accessory - a Television with category `AUDIO_RECEIVER` (there's no dedicated HomeKit
  service for an amplifier), which gets it a proper receiver icon instead of a generic TV one.
- mDNS discovery (`_musc._tcp`) of BluOS players on the network, matched to configured devices by MAC
  address; the amplifier's own HTTP API is used to identify it (brand/model) and to read its physical
  input list.
- Full runtime control over MQTT: power and mute via the amplifier's real `On`/`Off` topics, volume
  read/written directly via its native `volume_percent` topic (no raw-value conversion needed), input
  source switching, and telemetry-driven state updates in the Home app.
- Physical input switching goes through the amplifier's BluOS HTTP API (`/Play?url=...`) rather than
  MQTT, since this bridge's `source` command topic doesn't reliably switch physical inputs.
- Current input, volume and mute are read from the amplifier's HTTP `/Status` endpoint once at
  startup, so the Home app reflects real state immediately rather than waiting for the first change.
- `topicBaseCommand`/`topicBaseTelemetry` support multi-segment values (e.g. `tele/control`), not just
  a single path segment.
