import bent from 'bent';
import { connect, MqttClient } from 'mqtt';

import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';

import type { NadAmplifierPlatform } from './platform.js';


/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class NadAmplifierAccessory {
  private speaker: Service;
  private mqtt: MqttClient;

  private amplifierStates = {
    Power: false,
    Mute: false,
    Volume: 40,
    Source: 99,
  };

  private readonly topics: {
    readonly volume: string;
    readonly power: string;
    readonly mute: string;
    readonly source: string;
  };

  constructor(
    private readonly platform: NadAmplifierPlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    this.topics = {
      volume: `${this.platform.config.mqtt.topicBase}/volume_percent`,
      power: `${this.platform.config.mqtt.topicBase}/power`,
      mute: `${this.platform.config.mqtt.topicBase}/mute`,
      source: `${this.platform.config.mqtt.topicBase}/source`,
    };

    const mqtt_connection_options = {
      username: this.platform.config.mqtt.username,
      password: this.platform.config.mqtt.password, // Buffer.from(this.platform.config.mqtt.password), // Passwords are buffers
    };
    if (this.platform.config.mqtt.username) {
      this.mqtt = connect(`mqtt://${this.platform.config.mqtt.host}:${this.platform.config.mqtt.port}`, mqtt_connection_options);
    } else {
      this.mqtt = connect(`mqtt://${this.platform.config.mqtt.host}:${this.platform.config.mqtt.port}`);
    }
    this.mqtt.on('connect', () => {
      this.platform.log.info('Connected to MQTT broker');
    });
    this.mqtt.on('error', (error) => {
      this.platform.log.error('MQTT error:', error);
    });
    Object.values(this.topics).forEach((topic) => this.mqtt.subscribe(topic, (error) => { 
      if (error) {
        this.platform.log.error('Error subscribing to topic:', error);
      } else {
        this.platform.log.info('Subscribed to topic ', topic);
      }
    }));
    this.mqtt.on('message', (topic, message) => {
      const payload = message.toString();
      this.platform.log.info(`Received message on topic ${topic}: ${payload}`);
      switch (topic) {
      case this.topics.volume:
        this.amplifierStates.Volume = parseInt(payload, 10);
        this.speaker.updateCharacteristic(this.platform.Characteristic.Volume, this.amplifierStates.Volume);
        break;
      case this.topics.power:
        this.amplifierStates.Power = payload === 'On';
        this.speaker.updateCharacteristic(this.platform.Characteristic.Active, this.amplifierStates.Power ? 1 : 0);
        break;
      case this.topics.mute:
        this.amplifierStates.Mute = payload === 'On';
        this.speaker.updateCharacteristic(this.platform.Characteristic.Mute, this.amplifierStates.Mute);
        break;
      case this.topics.source:
        this.amplifierStates.Source = parseInt(payload, 10);
        break;
      }
    });


    // set accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'NAD')
      .setCharacteristic(this.platform.Characteristic.Model, 'Default-Model')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, 'Default-Serial');

    this.accessory.category = this.platform.api.hap.Categories.TELEVISION;

    const tvService = this.accessory.getService(this.platform.Service.Television) ??
      this.accessory.addService(this.platform.Service.Television, 'NAD T765 TV');

    // set the tv name
    tvService.setCharacteristic(this.platform.Characteristic.ConfiguredName, 'NAD Amplifier TV');

    // set sleep discovery characteristic
    tvService.setCharacteristic(this.platform.Characteristic.SleepDiscoveryMode, this.platform.Characteristic.SleepDiscoveryMode.ALWAYS_DISCOVERABLE);

    // handle on / off events using the Active characteristic
    tvService.getCharacteristic(this.platform.Characteristic.Active)
      .onSet(this.setPower.bind(this)) // SET - bind to the correct context
      .onGet(this.getPower.bind(this)); // GET - bind to the correct context
    // set the initial value of the Active characteristic
    tvService.setCharacteristic(this.platform.Characteristic.ActiveIdentifier, this.amplifierStates.Power ? 1 : 0);

    // handle input source changes
    tvService.getCharacteristic(this.platform.Characteristic.ActiveIdentifier)
      .onSet(this.setPower.bind(this)) // SET - bind to the correct context
      .onGet(this.getPower.bind(this)); // GET - bind to the correct context

    // handle remote control input
    tvService.getCharacteristic(this.platform.Characteristic.RemoteKey)
      .onSet((newValue) => {
        switch(newValue) {
        case this.platform.Characteristic.RemoteKey.REWIND: {
          this.platform.log.info('set Remote Key Pressed: REWIND');
          break;
        }
        case this.platform.Characteristic.RemoteKey.FAST_FORWARD: {
          this.platform.log.info('set Remote Key Pressed: FAST_FORWARD');
          break;
        }
        case this.platform.Characteristic.RemoteKey.NEXT_TRACK: {
          this.platform.log.info('set Remote Key Pressed: NEXT_TRACK');
          break;
        }
        case this.platform.Characteristic.RemoteKey.PREVIOUS_TRACK: {
          this.platform.log.info('set Remote Key Pressed: PREVIOUS_TRACK');
          break;
        }
        case this.platform.Characteristic.RemoteKey.ARROW_UP: {
          this.platform.log.info('set Remote Key Pressed: ARROW_UP');
          break;
        }
        case this.platform.Characteristic.RemoteKey.ARROW_DOWN: {
          this.platform.log.info('set Remote Key Pressed: ARROW_DOWN');
          break;
        }
        case this.platform.Characteristic.RemoteKey.ARROW_LEFT: {
          this.platform.log.info('set Remote Key Pressed: ARROW_LEFT');
          break;
        }
        case this.platform.Characteristic.RemoteKey.ARROW_RIGHT: {
          this.platform.log.info('set Remote Key Pressed: ARROW_RIGHT');
          break;
        }
        case this.platform.Characteristic.RemoteKey.SELECT: {
          this.platform.log.info('set Remote Key Pressed: SELECT');
          break;
        }
        case this.platform.Characteristic.RemoteKey.BACK: {
          this.platform.log.info('set Remote Key Pressed: BACK');
          break;
        }
        case this.platform.Characteristic.RemoteKey.EXIT: {
          this.platform.log.info('set Remote Key Pressed: EXIT');
          break;
        }
        case this.platform.Characteristic.RemoteKey.PLAY_PAUSE: {
          this.platform.log.info('set Remote Key Pressed: PLAY_PAUSE');
          break;
        }
        case this.platform.Characteristic.RemoteKey.INFORMATION: {
          this.platform.log.info('set Remote Key Pressed: INFORMATION');
          break;
        }
        }
      });

    this.speaker = this.accessory.getService(this.platform.Service.TelevisionSpeaker) ?? 
      this.accessory.addService(this.platform.Service.TelevisionSpeaker, 'Speaker');

    this.speaker.setCharacteristic(this.platform.Characteristic.Name, 'Speaker')
      .setCharacteristic(this.platform.Characteristic.VolumeControlType, this.platform.Characteristic.VolumeControlType.ABSOLUTE);

    this.speaker.getCharacteristic(this.platform.Characteristic.Mute)
      .onGet(this.getMute.bind(this)) // GET - bind to the correct context
      .onSet(this.setMute.bind(this)); // SET - bind to the correct context

    this.speaker.getCharacteristic(this.platform.Characteristic.Volume)
      .onGet(this.getVolume.bind(this)) // GET - bind to the correct context
      .onSet(this.setVolume.bind(this)); // SET - bind to the correct context

    this.speaker.getCharacteristic(this.platform.Characteristic.VolumeSelector)
      .onSet((newValue) => {
        switch(newValue) {
        case this.platform.Characteristic.VolumeSelector.INCREMENT: {
          this.platform.log.info('set Volume Selector => setNewValue: Volume Up');
          this.setVolume(this.amplifierStates.Volume + 1);
          break;
        }
        case this.platform.Characteristic.VolumeSelector.DECREMENT: {
          this.platform.log.info('set Volume Selector => setNewValue: Volume Down');
          this.setVolume(this.amplifierStates.Volume - 1);
          break;
        }
        }
      });

    tvService.addLinkedService(this.speaker);

    // Create a Lightbulb service to control the volume as a dimmer
    const lightbulbService = this.accessory.getService(this.platform.Service.Lightbulb) || 
    this.accessory.addService(this.platform.Service.Lightbulb, 'Volume');

    lightbulbService.getCharacteristic(this.platform.Characteristic.Brightness)
      .onGet(this.getVolume.bind(this)) // GET - bind to the correct context
      .onSet(this.setVolume.bind(this)); // SET - bind to the correct context

    tvService.addLinkedService(lightbulbService);

    // TODO: register inputs
  }

  async getPower(): Promise<CharacteristicValue> {
    this.platform.log.debug('Triggered GET Power:', this.amplifierStates.Power);
    return this.amplifierStates.Power;
  }

  async setPower(value: CharacteristicValue) {
    this.platform.log.debug('Triggered Set Power: ', value.toString());

    // Call HTTP server to turn on/off amplifier
    const url = this.platform.config.http.basePath + '/amplifiers/' + this.accessory.context.device.id + '/power';    
    const basic_auth_string = Buffer.from(this.platform.config.http.username + ':' + this.platform.config.http.password).toString('base64');
    const headers = {
      'Authorization': 'Basic ' + basic_auth_string,
    };

    // If value is true then body sent should be the string "true"
    const postJSON = bent('POST', 204);
    await postJSON(url, value as boolean ? 'true' : 'false', headers);
    
    // if you need to return an error to show the device as "Not Responding" in the Home app:
    // throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);

    this.speaker.updateCharacteristic(this.platform.Characteristic.Active, value);
    this.amplifierStates.Power = value as boolean;
    this.platform.log.debug(this.amplifierStates.Power.toString());
  }

  async getMute(): Promise<CharacteristicValue> {
    this.platform.log.debug('Triggered GET Mute');
    return this.amplifierStates.Mute;
  }

  async setMute(value: CharacteristicValue) {
    this.platform.log.debug('Triggered SET Mute:', value);

    // Call HTTP server to turn on/off mute
    const url = this.platform.config.http.basePath + '/amplifiers/' + this.accessory.context.device.id + '/mute';    
    const basic_auth_string = Buffer.from(this.platform.config.http.username + ':' + this.platform.config.http.password).toString('base64');
    const headers = {
      'Authorization': 'Basic ' + basic_auth_string,
    };

    const postJSON = bent('POST', 204);
    await postJSON(url, value as boolean ? 'true' : 'false', headers);

    // if you need to return an error to show the device as "Not Responding" in the Home app:
    // throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);

    this.speaker.updateCharacteristic(this.platform.Characteristic.Mute, value);
    this.amplifierStates.Mute = value as boolean;
    this.platform.log.debug(this.amplifierStates.Mute.toString());
  }

  async getVolume(): Promise<CharacteristicValue> {
    const volume = this.amplifierStates.Volume;
    this.platform.log.debug('Triggered GET Volume: ', volume);
    return volume;
  }

  async setVolume(value: CharacteristicValue) {
    this.platform.log.debug('Triggered SET Volume:', value);

    if (typeof value !== 'number' || value < 0 || value > 100) {
      this.platform.log.error('Volume must be between 0 and 100');
      return;
    }

    // Call HTTP server to set volume
    const url = this.platform.config.http.basePath + '/amplifiers/' + this.accessory.context.device.id + '/volume_percent';    
    const basic_auth_string = Buffer.from(this.platform.config.http.username + ':' + this.platform.config.http.password).toString('base64');
    const headers = {
      'Authorization': 'Basic ' + basic_auth_string,
    };

    const postJSON = bent('POST', 204);
    await postJSON(url, String(this.amplifierStates.Volume), headers);

    // if you need to return an error to show the device as "Not Responding" in the Home app:
    // throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);

    this.speaker.updateCharacteristic(this.platform.Characteristic.Volume, value);
    this.amplifierStates.Volume = value as number;
    this.platform.log.debug(this.amplifierStates.Volume.toString());
  }
}
