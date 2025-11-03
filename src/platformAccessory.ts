import bent from 'bent';
import { connect, MqttClient } from 'mqtt';

import { PlatformAccessory, type CharacteristicValue, type Service } from 'homebridge';

import type { NadAmplifierPlatform } from './platform.js';
// import { PLUGIN_NAME, PLATFORM_NAME } from './settings.js';


/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class NadAmplifierAccessory {
  private televisionService: Service;
  private inputSourceServices: Service[] = [];
  // private televisionSpeakerService: Service;
  
  private mqtt: MqttClient;

  private amplifierStates = {
    Power: false,
    // Mute: false,
    // Volume: 40,
    Source: 99,
  };

  private readonly topics: {
    // readonly volume: string;
    // readonly mute: string;
    readonly power: string;
    readonly source: string;
  };

  constructor(
    private readonly platform: NadAmplifierPlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    this.topics = {
      // volume: `${this.platform.config.mqtt.topicBase}/${accessory.context.device.id}/volume_percent`,
      // mute: `${this.platform.config.mqtt.topicBase}/${accessory.context.device.id}/mute`,
      power: `${this.platform.config.mqtt.topicBase}/${accessory.context.device.id}/power`,
      source: `${this.platform.config.mqtt.topicBase}/${accessory.context.device.id}/source`,
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
      /*
        case this.topics.volume:
        this.amplifierStates.Volume = parseInt(payload, 10);
        // this.speaker.updateCharacteristic(this.platform.Characteristic.Volume, parseInt(payload));
        // this.lightbulbService.updateCharacteristic(this.platform.Characteristic.Brightness, parseInt(payload));
        // this.televisionSpeakerService.updateCharacteristic(this.platform.Characteristic.Volume, parseInt(payload));
        // this.fanService.updateCharacteristic(this.platform.Characteristic.RotationSpeed, parseInt(payload));
        this.platform.log.debug(`Updating characteristic Volume: ${parseInt(payload)}`);
        break;
      case this.topics.mute:
        this.amplifierStates.Mute = payload === 'On';
        // this.speaker.updateCharacteristic(this.platform.Characteristic.Mute, payload === 'On');
        // this.televisionSpeakerService.updateCharacteristic(this.platform.Characteristic.Mute, payload === 'On');
        break;
      */      
      case this.topics.power:
        this.amplifierStates.Power = payload === 'On';
        // this.speaker.updateCharacteristic(this.platform.Characteristic.Active, payload === 'On');
        this.televisionService.updateCharacteristic(this.platform.Characteristic.Active, payload === 'On');
        // this.fanService.updateCharacteristic(this.platform.Characteristic.On, payload === 'On');
        break;
      case this.topics.source:
        this.amplifierStates.Source = parseInt(payload, 10);
        this.televisionService.updateCharacteristic(this.platform.Characteristic.ActiveIdentifier, parseInt(payload, 10));
        break;
      }
    });

    this.amplifierStates.Power = accessory.context.device.amplifier.power;
    // this.amplifierStates.Mute = accessory.context.device.amplifier.mute;
    // this.amplifierStates.Volume = accessory.context.device.amplifier.volume_percent;
    this.platform.log.debug(`Available context: ${JSON.stringify(accessory.context.device, null, 2)}`);

    // set accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'NAD')
      .setCharacteristic(this.platform.Characteristic.Model, accessory.context.device.id)
      .setCharacteristic(this.platform.Characteristic.SerialNumber, accessory.context.device.mac_address);

    // set the accessory category
    this.accessory.category = this.platform.api.hap.Categories.AUDIO_RECEIVER;
    
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
    
    // TV SPEAKER SERVICE
    /* ***********************************************
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

    this.televisionSpeakerService.getCharacteristic(this.platform.Characteristic.VolumeSelector)
      .onSet((newValue) => {
        this.platform.log.info('set VolumeSelector => setNewValue: ' + newValue);
      });

    this.televisionSpeakerService.updateCharacteristic(this.platform.Characteristic.VolumeControlType, this.platform.Characteristic.VolumeControlType.ABSOLUTE);
    this.televisionService.addLinkedService(this.televisionSpeakerService);
    */

    // INPUT SOURCE SERVICE
    // ***********************************************
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    accessory.context.device.sources.forEach((input: any) => {
      const subTypeName = JSON.stringify(input.name).replace( /\W/g , '').toLowerCase();
      const inputSourceService = this.accessory.getService(input.name)
        || this.accessory.addService(this.platform.Service.InputSource, input.name, subTypeName);
      inputSourceService
        .setCharacteristic(this.platform.Characteristic.Identifier, String(input.position))
        .setCharacteristic(this.platform.Characteristic.ConfiguredName, input.name)
        .setCharacteristic(this.platform.Characteristic.IsConfigured, this.platform.Characteristic.IsConfigured.CONFIGURED)
        .setCharacteristic(this.platform.Characteristic.InputSourceType, this.platform.Characteristic.InputSourceType.OTHER)
        .setCharacteristic(this.platform.Characteristic.CurrentVisibilityState, input.is_enabled 
          ? this.platform.Characteristic.CurrentVisibilityState.SHOWN : this.platform.Characteristic.CurrentVisibilityState.HIDDEN);
      this.inputSourceServices.push(inputSourceService);
      this.platform.log.debug(
        `inputSourceService.serviceId=${inputSourceService.getServiceId()}; identifier=${input.position}; is_enabled=${input.is_enabled}`);
      this.televisionService.addLinkedService(inputSourceService); // link to tv service
    });

    /* Create a Lightbulb service to control the volume through a dimmer
    const lightbulbService = this.accessory.getService(this.platform.Service.Lightbulb) || 
    this.accessory.addService(this.platform.Service.Lightbulb, 'Volume');

    lightbulbService.getCharacteristic(this.platform.Characteristic.Brightness)
      .onGet(this.getVolume.bind(this)) // GET - bind to the correct context
      .onSet(this.setVolume.bind(this)); // SET - bind to the correct context

    this.televisionService.addLinkedService(lightbulbService);
    */
    
    /* Create a Fan service to control volume through fan speed
    this.fanService = this.accessory.getService(this.platform.Service.Fan) || this.accessory.addService(this.platform.Service.Fan);
    this.fanService.updateCharacteristic(this.platform.Characteristic.On, true);
    this.fanService.updateCharacteristic(this.platform.Characteristic.Name, 'Volume');

    this.fanService.getCharacteristic(this.platform.Characteristic.RotationSpeed)
      .onGet(this.getVolume.bind(this))
      .onSet(this.setVolume.bind(this));
    */

    /* Create a Switch Service to control Mute state
    // switchAccessory = unusedDeviceAccessories.find(function(a) { return a.context.kind === 'SwitchAccessory'; });
    platform.log.info('Adding new accessory with serial number ' + accessory.context.device.mac_address! + ' and kind SwitchAccessory.');
    const switchAccessory = new platform.api.platformAccessory(this.televisionService.displayName + ' Settings',
      this.platform.api.hap.uuid.generate(accessory.context.device.mac_address! + 'SwitchAccessory'));
    switchAccessory.context.serialNumber = accessory.context.device.mac_address!;
    switchAccessory.context.kind = 'SwitchAccessory';
    switchAccessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'NAD')
      .setCharacteristic(this.platform.Characteristic.Model, accessory.context.device.id)
      .setCharacteristic(this.platform.Characteristic.SerialNumber, accessory.context.device.mac_address);

    if (!switchAccessory.getServiceById(this.platform.Service.Switch, 'AutoMode')) {
      switchAccessory.addService(this.platform.Service.Switch, this.televisionService.displayName + ' Auto Mode', 'AutoMode');
    }
    this.platform.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory, switchAccessory]);
    // autoModeSwitchService

    /* Updates the auto mode
    let autoModeSwitchService = null;
    if (switchAccessory && config.isAutoModeEnabled) {
      autoModeSwitchService = switchAccessory.getServiceById(platform.Service.Switch, 'AutoMode');
      if (!autoModeSwitchService) {
        autoModeSwitchService = switchAccessory.addService(Service.Switch, device.info.name + ' Auto Mode', 'AutoMode');
      }
    }
    autoModeSwitchService.updateCharacteristic(Characteristic.On, content['product-state'].fmod === 'AUTO');
    */


    this.televisionService.setPrimaryService();
    // this.platform.api.publishExternalAccessories(PLUGIN_NAME, [switchAccessory]);
    // this.platform.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory, switchAccessory]);
  }





  
  // Seems to only sort the list of inputs in `settings` unfortunately, the sorting of selector carousel is random (maybe based on UUID?)
  sortInputs() {
    // Update DisplayOrder characteristic (base64 encoded)
    this.inputSourceServices.sort((a, b) => a.displayName.localeCompare(b.displayName));
    const orderDump = this.inputSourceServices.map(svc => ({ displayName: svc.displayName, iid: svc.iid, name: svc.name, subtype: svc.subtype }));
    this.platform.log.debug(`Inputs display order:\n${JSON.stringify(orderDump, null, 2)}`);
    const displayOrder = this.inputSourceServices.map(svc =>
      String(svc.getCharacteristic(this.platform.Characteristic.Identifier).value)); // String(svc.displayName));
    this.platform.log.debug(`Display order before encoding:\n${JSON.stringify(displayOrder, null, 2)}`);
    const encodedOrder = this.platform.api.hap.encode(1, displayOrder).toString('base64'); // api.hap.encode
    this.platform.log.debug(encodedOrder);
    this.televisionService.updateCharacteristic(this.platform.Characteristic.DisplayOrder, encodedOrder);
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
  /*
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
  */
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
