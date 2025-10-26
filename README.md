<p align="center">

<img src="https://github.com/homebridge/branding/raw/latest/logos/homebridge-wordmark-logo-vertical.png" width="150">

</p>

# NAD Amplifier Homebridge Plugin

This Homebridge plugin allows you to control your NAD amplifier via MQTT and HTTP, integrating it with HomeKit. It supports controlling power, volume, mute, and input source selection.

Based on https://github.com/wkronmiller/nad-mqtt-homebridge-plugin

## Features

- Control your NAD amplifier using HomeKit
- Power on/off control
- Volume control (using both TV Speaker and a virtual lightbulb for easier access)
- Mute control
- Ready for input source selection (configurable)

## Requirements

- Homebridge v1.8.0 or newer
- Node.js v18, v20, or v22
- An MQTT broker
- A connected NAD amplifier with an MQTT-to-serial bridge
- An HTTP server that can broker messages with both the MQTT broker and the amplifier's HTTP interfaces (native interface + BluOS interface)

## Installation

```bash
npm install -g @gomi-source/homebridge-nad-amplifier
```

## Configuration

Add the platform to your Homebridge `config.json`:

```json
{
  "platforms": [
    {
      "platform": "NadAmplifier",
      "name": "Useless",
      "mqtt": {
        "host": "192.168.1.100",
        "port": 1883,
        "topicBase": "tele/command/m33",
        "username": "mqtt-server-username",  // Optional
        "password": "mqtt-server-password"  // Optional
      },
      "http": {
        "basePath": "http://127.0.0.1:8080/p-nad/v1",
        "username": "http-server-username",  // Optional
        "password": "http-server-password"  // Optional
      }

    }
  ]
}
```

### MQTT Topic Structure

The plugin expects the following MQTT topic structure:

- Power state updates: `topicBase`/power
- Volume state updates (in percent): `topicBase`/volume_percent
- Mute state updates: `topicBase`/mute
- Source selection updates: `topicBase`/source

## Volume Scaling

The plugin uses the VolumePercent feature in the amplifier, rather than the default dB range (-70dB to 10dB). This makes controlling the volume make sense in the Home app's UI.

### Setup Development Environment

To develop Homebridge plugins you must have Node.js 18 or later installed, and a modern code editor such as [VS Code](https://code.visualstudio.com/). This plugin template uses [TypeScript](https://www.typescriptlang.org/) to make development easier and comes with pre-configured settings for [VS Code](https://code.visualstudio.com/) and ESLint. If you are using VS Code install these extensions:

- [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint)

### Install Development Dependencies

Using a terminal, navigate to the project folder and run this command to install the development dependencies:

```shell
npm install
```

### Build Plugin

TypeScript needs to be compiled into JavaScript before it can run. The following command will compile the contents of your [`src`](./src) directory and put the resulting code into the `dist` folder.

```shell
npm run build
```

### Link To Homebridge

Run this command so your global installation of Homebridge can discover the plugin in your development environment:

```shell
npm link
```

You can now start Homebridge, use the `-D` flag, so you can see debug log messages in your plugin:

```shell
homebridge -D
```

### Watch For Changes and Build Automatically

If you want to have your code compile automatically as you make changes, and restart Homebridge automatically between changes, you first need to add your plugin as a platform in `./test/hbConfig/config.json`:
```
{
...
    "platforms": [
        {
            "name": "Config",
            "port": 8581,
            "platform": "config"
        },
        {
            "name": "NAD Amplifier",
            "platform": "NadAmplifier",
            "mqtt": {
                "host": "localhost",
                "port": 1883,
                "topicBase": "tele/control/m33"
            }
        }
    ]
}
```

and then you can run:

```shell
npm run watch
```

This will launch an instance of Homebridge in debug mode which will restart every time you make a change to the source code. It will load the config stored in the default location under `~/.homebridge`. You may need to stop other running instances of Homebridge while using this command to prevent conflicts. You can adjust the Homebridge startup command in the [`nodemon.json`](./nodemon.json) file.

## License

This project is licensed under the Apache-2.0 License - see the LICENSE file for details.