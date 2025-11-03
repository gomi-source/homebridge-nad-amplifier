import bent from 'bent';
import { connect, MqttClient } from 'mqtt';

import { PlatformAccessory, Units, type CharacteristicValue, type Service } from 'homebridge';

import type { NadAmplifierPlatform } from './platform.js';


/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class NadAmplifierVolumeAccessory {
  // private lightbulbService: Service;
  // private televisionService: Service;
  private fanService: Service;
  private switchService: Service;
  
  private mqtt: MqttClient;

  private amplifierStates = {
    Power: false,
    Mute: false,
    Volume: 50,
  };

  private readonly topics: {
    readonly volume: string;
    readonly mute: string;
  };

  constructor(
    private readonly platform: NadAmplifierPlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    this.topics = {
      volume: `${this.platform.config.mqtt.topicBase}/${accessory.context.device.id}/volume_percent`,
      mute: `${this.platform.config.mqtt.topicBase}/${accessory.context.device.id}/mute`,
    };

    const mqtt_connection_options = {
      username: this.platform.config.mqtt.username,
      password: this.platform.config.mqtt.password,
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
        this.amplifierStates.Volume = parseFloat(payload);
        // this.speaker.updateCharacteristic(this.platform.Characteristic.Volume, parseInt(payload));
        // this.lightbulbService.updateCharacteristic(this.platform.Characteristic.Brightness, parseInt(payload));
        // this.televisionSpeakerService.updateCharacteristic(this.platform.Characteristic.Volume, parseInt(payload));
        this.fanService.updateCharacteristic(this.platform.Characteristic.RotationSpeed, parseFloat(payload));
        this.platform.log.debug(`Updating characteristic Volume: ${parseFloat(payload)}`);
        break;
      case this.topics.mute:
        this.amplifierStates.Mute = payload === 'On';
        // this.speaker.updateCharacteristic(this.platform.Characteristic.Mute, payload === 'On');
        // this.televisionSpeakerService.updateCharacteristic(this.platform.Characteristic.Mute, payload === 'On');
        break;
      }
    });

    this.amplifierStates.Power = true;
    this.amplifierStates.Mute = accessory.context.device.amplifier.mute;
    this.amplifierStates.Volume = accessory.context.device.amplifier.volume_percent;
    this.platform.log.debug(`Available context: ${JSON.stringify(accessory.context.device, null, 2)}`);

    // set accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'NAD')
      .setCharacteristic(this.platform.Characteristic.Model, accessory.context.device.id)
      .setCharacteristic(this.platform.Characteristic.SerialNumber, accessory.context.device.mac_address);

    /* Create a Lightbulb service to control the volume through a dimmer
    const lightbulbService = this.accessory.getService(this.platform.Service.Lightbulb) || 
    this.accessory.addService(this.platform.Service.Lightbulb, 'Volume');

    lightbulbService.getCharacteristic(this.platform.Characteristic.Brightness)
      .onGet(this.getVolume.bind(this)) // GET - bind to the correct context
      .onSet(this.setVolume.bind(this)); // SET - bind to the correct context

    this.televisionService.addLinkedService(lightbulbService);
    */
    
    // Create a Fan service to control volume through fan speed
    this.fanService = this.accessory.getService(this.platform.Service.Fanv2) || this.accessory.addService(this.platform.Service.Fanv2, 'Volume', 'volume');
    this.fanService.updateCharacteristic(this.platform.Characteristic.Active, true);
    this.fanService.updateCharacteristic(this.platform.Characteristic.Name, 'Volume');

    this.fanService.getCharacteristic(this.platform.Characteristic.RotationSpeed)
      .setProps({
        unit: Units.PERCENTAGE,
        minStep: 1,
        minValue: -1,
        maxValue: 100,
      });

    this.fanService.getCharacteristic(this.platform.Characteristic.RotationSpeed)
      .onGet(this.getVolume.bind(this))
      .onSet(this.setVolume.bind(this));
    
    // Create a Switch Service to control Mute state
    // switchAccessory = unusedDeviceAccessories.find(function(a) { return a.context.kind === 'SwitchAccessory'; });
    this.switchService = this.accessory.getService(this.platform.Service.Switch) || this.accessory.addService(this.platform.Service.Switch, 'Mute', 'mute');
    this.switchService.updateCharacteristic(this.platform.Characteristic.Name, 'Mute');
    this.switchService.getCharacteristic(this.platform.Characteristic.On)
      .onGet(this.getMute.bind(this))
      .onSet(this.setMute.bind(this));

  
    // this.platform.api.publishExternalAccessories(PLUGIN_NAME, [switchAccessory]);
    // this.platform.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
  }


  async getPower(): Promise<CharacteristicValue> {
    this.platform.log.debug('Triggered GET Power:', this.amplifierStates.Power);
    return true;
  }

  async setPower(value: CharacteristicValue) {
    this.platform.log.debug('Triggered Set Power: ', value.toString());
    this.amplifierStates.Power = true;
  }

  async getMute(): Promise<CharacteristicValue> {
    this.platform.log.debug('Triggered GET Mute: ', this.amplifierStates.Mute);
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

    this.amplifierStates.Mute = value as boolean;
  }

  async getVolume(): Promise<CharacteristicValue> {
    this.platform.log.debug('Triggered GET Volume: ', this.amplifierStates.Volume);
    return this.amplifierStates.Volume;
  }

  async setVolume(value: CharacteristicValue) {
    this.platform.log.debug('Triggered SET Volume:', value);

    if (typeof value !== 'number' || value < 0 || value > 100) {
      this.platform.log.error('Volume must be between 0 and 100');
      return;
    }

    const limit = this.platform.config.volumeCap;
    if (limit && value > limit) {
      this.platform.log.error(`Volume is capped at ${limit}%, to keep Siri from accidentally blasting our eardrums to smithereens.`,
        'Adjust as needed with config "volumeCap".');
      value = limit;
    }
    
    // Call HTTP server to set volume
    const url = this.platform.config.http.basePath + '/amplifiers/' + this.accessory.context.device.id + '/volume_percent';    
    const basic_auth_string = Buffer.from(this.platform.config.http.username + ':' + this.platform.config.http.password).toString('base64');
    const headers = {
      'Authorization': 'Basic ' + basic_auth_string,
    };

    const postJSON = bent('POST', 204);
    await postJSON(url, value.toString(), headers);

    // if you need to return an error to show the device as "Not Responding" in the Home app:
    // throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);

    this.amplifierStates.Volume = value as number;
  }
}
