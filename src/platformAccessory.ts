import bent from 'bent';
import { connect, MqttClient } from 'mqtt';

import { type CharacteristicValue, type PlatformAccessory, type Service } from 'homebridge';

import type { NadAmplifierPlatform } from './platform.js';


/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class NadAmplifierAccessory {
  // private service: Service;
  // private lightbulbService: Service;
  private televisionService: Service;
  // private televisionSpeakerService: Service;
  // private fanService: Service;
  
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
      volume: `${this.platform.config.mqtt.topicBase}/${accessory.context.device.id}/volume_percent`,
      power: `${this.platform.config.mqtt.topicBase}/${accessory.context.device.id}/power`,
      mute: `${this.platform.config.mqtt.topicBase}/${accessory.context.device.id}/mute`,
      source: `${this.platform.config.mqtt.topicBase}/${accessory.context.device.id}/source`,
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
        // this.speaker.updateCharacteristic(this.platform.Characteristic.Volume, parseInt(payload));
        // this.lightbulbService.updateCharacteristic(this.platform.Characteristic.Brightness, parseInt(payload));
        // this.televisionSpeakerService.updateCharacteristic(this.platform.Characteristic.Volume, parseInt(payload));
        // this.fanService.updateCharacteristic(this.platform.Characteristic.RotationSpeed, parseInt(payload));
        this.platform.log.debug(`Updating characteristic Volume: ${parseInt(payload)}`);
        break;
      case this.topics.power:
        this.amplifierStates.Power = payload === 'On';
        // this.speaker.updateCharacteristic(this.platform.Characteristic.Active, payload === 'On');
        this.televisionService.updateCharacteristic(this.platform.Characteristic.Active, payload === 'On');
        // this.fanService.updateCharacteristic(this.platform.Characteristic.On, payload === 'On');
        break;
      case this.topics.mute:
        this.amplifierStates.Mute = payload === 'On';
        // this.speaker.updateCharacteristic(this.platform.Characteristic.Mute, payload === 'On');
        // this.televisionSpeakerService.updateCharacteristic(this.platform.Characteristic.Mute, payload === 'On');
        break;
      case this.topics.source:
        this.amplifierStates.Source = parseInt(payload, 10);
        this.televisionService.updateCharacteristic(this.platform.Characteristic.ActiveIdentifier, parseInt(payload, 10));
        break;
      }
    });

    this.amplifierStates.Power = accessory.context.device.amplifier.power;
    this.amplifierStates.Mute = accessory.context.device.amplifier.mute;
    this.amplifierStates.Volume = accessory.context.device.amplifier.volume_percent;
    this.platform.log.debug(`Available context: ${accessory.context.device}`);

    // set accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'NAD')
      .setCharacteristic(this.platform.Characteristic.Model, accessory.context.device.id)
      .setCharacteristic(this.platform.Characteristic.SerialNumber, 'unknown');

    // set the accessory category
    // this.accessory.category = this.platform.api.hap.Categories.TELEVISION;
    
    // TV SERVICE
    // ***********************************************
    this.televisionService = this.accessory.getService(this.platform.Service.Television)
      || this.accessory.addService(this.platform.Service.Television, 'NAD AS TV');

    // Required Characteristics
    this.televisionService.getCharacteristic(this.platform.Characteristic.Active)
      .onSet(this.setPower.bind(this))
      .onGet(this.getPower.bind(this));
    this.televisionService.setCharacteristic(this.platform.Characteristic.Active, this.amplifierStates.Power ? 1 : 0);

    this.televisionService.getCharacteristic(this.platform.Characteristic.ActiveIdentifier)
      .onSet(this.setSource.bind(this))
      .onGet(this.getSource.bind(this));
    this.televisionService.setCharacteristic(this.platform.Characteristic.ActiveIdentifier, this.amplifierStates.Source);
    
    this.televisionService.setCharacteristic(this.platform.Characteristic.ConfiguredName, 'NAD Amplifier TV');

    this.televisionService.getCharacteristic(this.platform.Characteristic.RemoteKey)
      .onSet((newValue) => {
        switch(newValue) {
        case this.platform.Characteristic.RemoteKey.PLAY_PAUSE: {
          this.platform.log.info('set Remote Key Pressed: PLAY_PAUSE');
          break;
        }
        }
      });

    this.televisionService.setCharacteristic(this.platform.Characteristic.SleepDiscoveryMode,
      this.platform.Characteristic.SleepDiscoveryMode.ALWAYS_DISCOVERABLE);
    
    /* TV SPEAKER SERVICE
    // ***********************************************
    this.televisionSpeakerService = this.accessory.getService(this.platform.Service.TelevisionSpeaker)
      || this.accessory.addService(this.platform.Service.TelevisionSpeaker);

    // Required Characteristics
    this.televisionSpeakerService.getCharacteristic(this.platform.Characteristic.Mute)
      .onGet(this.getMute.bind(this))
      .onSet(this.setMute.bind(this));

    // Optional Characteristics
    this.televisionSpeakerService.getCharacteristic(this.platform.Characteristic.Volume)
      .onGet(this.getVolume.bind(this))
      .onSet(this.setVolume.bind(this));

    /*
    this.televisionSpeakerService.getCharacteristic(this.platform.Characteristic.VolumeSelector)
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
    */
    /*
    this.televisionSpeakerService.getCharacteristic(this.platform.Characteristic.VolumeSelector)
      .onSet((newValue) => {
        this.platform.log.info('set VolumeSelector => setNewValue: ' + newValue);
      });

    this.televisionSpeakerService.setCharacteristic(this.platform.Characteristic.VolumeControlType, this.platform.Characteristic.VolumeControlType.ABSOLUTE);

    this.televisionService.addLinkedService(this.televisionSpeakerService);
    */
    // INPUT SOURCE SERVICE
    // ***********************************************
    /* Create TV Input Source Services
     * These are the inputs the user can select from.
     * When a user selected an input the corresponding Identifier Characteristic
     * is sent to the TV Service ActiveIdentifier Characteristic handler.
     */
    const inputSourceService1 = this.accessory.getService('hdmi-arc')
      || this.accessory.addService(this.platform.Service.InputSource, 'HDMI ARC', 'hdmi-arc');
    inputSourceService1
      .setCharacteristic(this.platform.Characteristic.Identifier, 99)
      .setCharacteristic(this.platform.Characteristic.ConfiguredName, 'HDMI ARC')
      .setCharacteristic(this.platform.Characteristic.IsConfigured, this.platform.Characteristic.IsConfigured.CONFIGURED)
      .setCharacteristic(this.platform.Characteristic.InputSourceType, this.platform.Characteristic.InputSourceType.HDMI)
      .setCharacteristic(this.platform.Characteristic.CurrentVisibilityState, this.platform.Characteristic.CurrentVisibilityState.SHOWN);
    this.televisionService.addLinkedService(inputSourceService1); // link to tv service

    const inputSourceService2 = this.accessory.getService('optical1')
      || this.accessory.addService(this.platform.Service.InputSource, 'Optical 1', 'optical1');
    inputSourceService2
      .setCharacteristic(this.platform.Characteristic.Identifier, 2)
      .setCharacteristic(this.platform.Characteristic.ConfiguredName, 'Optical 1')
      .setCharacteristic(this.platform.Characteristic.IsConfigured, this.platform.Characteristic.IsConfigured.CONFIGURED)
      .setCharacteristic(this.platform.Characteristic.InputSourceType, this.platform.Characteristic.InputSourceType.OTHER)
      .setCharacteristic(this.platform.Characteristic.CurrentVisibilityState, this.platform.Characteristic.CurrentVisibilityState.SHOWN);
    this.televisionService.addLinkedService(inputSourceService2); // link to tv service

    // this.televisionService.setPrimaryService();

    /* Create a Lightbulb service to control the volume as a dimmer
    const lightbulbService = this.accessory.getService(this.platform.Service.Lightbulb) || 
    this.accessory.addService(this.platform.Service.Lightbulb, 'Volume');

    lightbulbService.getCharacteristic(this.platform.Characteristic.Brightness)
      .onGet(this.getVolume.bind(this)) // GET - bind to the correct context
      .onSet(this.setVolume.bind(this)); // SET - bind to the correct context

    tvService.addLinkedService(lightbulbService);
    */
    
    /* Fan service to control volume
    this.fanService = this.accessory.getService(this.platform.Service.Fan) || this.accessory.addService(this.platform.Service.Fan);
    this.fanService.setCharacteristic(this.platform.Characteristic.On, true);
    this.fanService.setCharacteristic(this.platform.Characteristic.Name, 'Volume');

    this.fanService.getCharacteristic(this.platform.Characteristic.RotationSpeed)
      .onGet(this.getVolume.bind(this))
      .onSet(this.setVolume.bind(this));
    */
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

    this.televisionService.updateCharacteristic(this.platform.Characteristic.Active, value);
    this.amplifierStates.Power = value as boolean;
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

    // this.speaker.updateCharacteristic(this.platform.Characteristic.Mute, value);
    // this.televisionSpeakerService.updateCharacteristic(this.platform.Characteristic.Mute, value);
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

    // this.speaker.updateCharacteristic(this.platform.Characteristic.Volume, value);
    // this.lightbulbService.updateCharacteristic(this.platform.Characteristic.Brightness, value);
    // this.fanService.updateCharacteristic(this.platform.Characteristic.RotationSpeed, value);

    this.amplifierStates.Volume = value as number;
  }

  async getSource(): Promise<CharacteristicValue> {
    this.platform.log.debug('Triggered GET Source: ', this.amplifierStates.Source);
    return this.amplifierStates.Source;
  }

  async setSource(value: CharacteristicValue) {
    this.platform.log.debug('Triggered Set source: ', value.toString());

    // Call HTTP server to turn on/off amplifier
    const url = this.platform.config.http.basePath + '/amplifiers/' + this.accessory.context.device.id + '/source';    
    const basic_auth_string = Buffer.from(this.platform.config.http.username + ':' + this.platform.config.http.password).toString('base64');
    const headers = {
      'Authorization': 'Basic ' + basic_auth_string,
    };

    // If value is true then body sent should be the string "true"
    const postJSON = bent('POST', 204);
    await postJSON(url, value.toString(), headers);
    
    // if you need to return an error to show the device as "Not Responding" in the Home app:
    // throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);

    this.televisionService.updateCharacteristic(this.platform.Characteristic.ActiveIdentifier, value);
    this.amplifierStates.Source = value as number;
  }

}
