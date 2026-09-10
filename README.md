<p align="center">

<img src="https://github.com/homebridge/branding/raw/latest/logos/homebridge-wordmark-logo-vertical.png" width="150">

</p>

<span align="center">

# homebridge-nad-amplifier

</span>

A [Homebridge](https://homebridge.io) plugin that exposes a NAD BluOS amplifier (developed against the **NAD M33**, but should work with any NAD BluOS-based unit) to Apple Home: power on/off, input source switching, and volume/mute.

There's no HomeKit service type for an amplifier or AV receiver, so this plugin registers the amplifier as a **Television** accessory with its category set to `AUDIO_RECEIVER`, which gets it a proper receiver icon and remote-style controls in the Home app instead of a TV icon.

Each amplifier is published as its own **external accessory** rather than as a child of Homebridge's shared bridge - HomeKit only honors an accessory's category (and so the receiver icon) for standalone accessories, not ones bridged under a shared pairing. That has two consequences worth knowing about: each amplifier needs its own "Add Accessory" step in the Home app, with its own setup code that Homebridge logs at startup (separate from the main bridge's code); and there is no API to unpublish an external accessory, so removing a device from `devices` in config stops it from being republished but does not remove any existing HomeKit pairing for it - the plugin will log a warning identifying it when this happens, and you'll need to remove it from the Home app yourself (press and hold the tile, then Remove Accessory).

## How it works

- **Discovery**: BluOS players (which is what NAD's amplifiers run) advertise themselves on the network over mDNS/Bonjour as `_musc._tcp` - the same mechanism the BluOS app and Home Assistant's own Bluesound integration use. This plugin browses for that service type, and for every device it finds, queries its BluOS HTTP API (`/SyncStatus` on port 11000) to read its MAC address, brand and model. Anything that doesn't identify itself as NAD-branded is ignored.
- **Matching to config**: a discovered amplifier is only added to HomeKit once its MAC address matches an entry you've added under `devices` in the config. This is deliberate - discovery can tell us a NAD amplifier exists at some IP, but not the topic id or volume range to control it with, and this plugin won't guess at those.
- **Control**: once matched, everything at runtime - power, volume, source - goes over **MQTT**, not the amplifier's HTTP interface. An MQTT broker bridging the amplifier's control topics is a hard prerequisite: the plugin will refuse to add or update any device until an `mqtt` block is present in its config.
- **Inputs**: the amplifier's own HTTP API (`/RadioBrowse?service=Capture`) is used once, at startup, to read the current list of physical inputs and build the Home app's input picker from it. This is the only other thing the HTTP interface is used for.

## Prerequisites

1. An MQTT broker, with something bridging your NAD amplifier's control surface onto it. This plugin does not implement that bridge itself - it assumes the following topics already exist and behave as described (this matches a typical NAD/BluOS MQTT bridge, but if yours differs, see [Assumptions & things to verify](#assumptions--things-to-verify) below):

   | Purpose | Topic | Payload |
   |---|---|---|
   | Set power | `<cmdBase>/<id>/power` | `On` / `Off` |
   | Power state | `<teleBase>/<id>/power` | `On` / `Off` (also accepts `1`/`0`/`true`) |
   | Set mute | `<cmdBase>/<id>/mute` | `On` / `Off` |
   | Mute state | `<teleBase>/<id>/mute` | `On` / `Off` (also accepts `1`/`0`/`true`) |
   | Set volume | `<cmdBase>/<id>/volume` | integer, e.g. `-60` to `60` |
   | Volume state | `<teleBase>/<id>/volume` | integer |
   | Set input source | `<cmdBase>/<id>/source` | integer position |
   | Source state | `<teleBase>/<id>/source` | integer position |

2. The amplifier's MAC address (from its own settings page, e.g. `http://<amp-ip>/diagnostics`, or from the BluOS app).

## Configuration

Example `config.json` platform block:

```json
{
  "platform": "NadAmplifier",
  "name": "NAD Amplifier",
  "devices": [
    {
      "id": "m33",
      "macaddress": "00-00-00-00-00-00",
      "volumeCap": 60
    }
  ],
  "mqtt": {
    "host": "10.10.1.30",
    "port": 1883,
    "username": "my-mqtt-user",
    "password": "my-mqtt-password",
    "topicBaseCommand": "cmd",
    "topicBaseTelemetry": "tele"
  }
}
```

(This plugin ships a config UI schema, so all of this can also be filled in from Homebridge Config UI X.)

### `devices[]`

| Key | Required | Default | Description |
|---|---|---|---|
| `id` | yes | - | Used as the MQTT topic segment, e.g. `m33` for `cmd/m33/volume`. Not readable from the amplifier - pick your own. |
| `macaddress` | yes | - | Matches this entry to the amplifier found on the network. |
| `name` | no | `NAD <model>` | Display name in the Home app. |
| `volumeCap` | no | `60` | Highest value ever written to the volume topic. Also what 100% (and un-muting to full) map to in the Home app's volume control. Use this to cap how loud Siri/Home can turn the amp up, independent of what the hardware itself supports. |
| `minVolume` | no | `-60` | Lowest value ever written to the volume topic. What 0% and muting map to. |
| `streamSourcePosition` | no | `9` | See [Inputs and source positions](#inputs-and-source-positions) below. |

### `mqtt`

| Key | Required | Default |
|---|---|---|
| `host` | yes | - |
| `port` | no | `1883` |
| `username` / `password` | no | - |
| `topicBaseCommand` | no | `cmd` |
| `topicBaseTelemetry` | no | `tele` |

### `discoveryIntervalMinutes`

How often (in minutes) to re-scan the network for configured amplifiers, to pick up an IP address change or a device that was offline at startup. Default `10`; set to `0` to disable.

## Inputs and source positions

`/RadioBrowse?service=Capture` returns each physical input's internal id, e.g. `xdynamic-Source3` or `input0`. The integer written to the `source` MQTT topic is derived from the trailing number in that id (so `xdynamic-Source3` -> `3`, `input0` -> `0`).

Bluetooth is deliberately **excluded** from that list: on a BluOS player it isn't a discrete physical input like an optical or coax connector, it's reached the same way as any other streaming service (Spotify, Tidal, AirPlay, ...) - through the amplifier's normal BluOS/streaming source, not a `source` position of its own.

Since that normal streaming mode isn't listed by `/RadioBrowse` at all (it only enumerates physical Capture inputs), this plugin adds one extra input itself, named **BluOS**, to let you leave a physical input and return to normal network playback. The position it writes is `streamSourcePosition`, which defaults to `9` - **verify this against your own unit** (e.g. by watching `tele/<id>/source` while switching to streaming playback from the BluOS app) and adjust it in config if it's wrong.

The input list is read once at startup. If you change what's connected to the amplifier, restart Homebridge to pick up the new list.

## Volume and mute

Apple Home doesn't show a volume slider for TV/receiver-type accessories - this is a HomeKit limitation, not something this plugin works around with an unrelated accessory type (e.g. a fake lightbulb or sensor). What it does implement, natively, on the Television Speaker service:

- **Relative volume** (the physical up/down buttons Siri Remote / Control Center expose for the active audio output) - steps the amplifier by 1 in whichever direction.
- **Absolute volume**, scaled from `minVolume`-`volumeCap` to 0-100% - not shown in the Home app itself, but visible to other HomeKit apps (e.g. Eve) that do display it.
- **Mute** - published straight to the amplifier's own `mute` topic (`On`/`Off`), and reflects the amplifier's real mute state from its `mute` telemetry.

## Assumptions & things to verify

This plugin was built from a description of one MQTT bridge setup, not by testing against live hardware. Power and mute payloads (`On`/`Off`) are confirmed; a couple of other details are still the best available guess and worth checking once you have it running, all overridable in config:

- **BluOS streaming source position**: assumed `9` (see above) - override with `streamSourcePosition` per device.
- **Volume range**: assumed `-60` to `60`, matching the example in the original request. Override with `minVolume`/`volumeCap` if your amplifier's actual range differs.

## Development

```shell
npm install
npm run build
npm run lint
npm link
homebridge -D
```

Or, with a plugin dev config already in `test/hbConfig/config.json`:

```shell
npm run watch
```
