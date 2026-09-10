import mqtt, { type MqttClient } from 'mqtt';
import type { Logging } from 'homebridge';

import type { MqttConfig } from './types.js';

export type TelemetryHandler = (key: string, payload: string) => void;

/**
 * A single shared MQTT connection for the whole platform, used to talk to every configured
 * amplifier. This is the plugin's primary means of control - the amplifier's own HTTP interface is
 * only ever used to identify a device on the network and to read its list of inputs.
 */
export class NadMqttClient {
  private client?: MqttClient;
  private readonly commandBase: string;
  private readonly telemetryBase: string;
  private readonly subscribedDeviceIds = new Set<string>();
  private readonly handlers = new Map<string, TelemetryHandler>();

  constructor(private readonly log: Logging, private readonly config: MqttConfig) {
    this.commandBase = config.topicBaseCommand?.trim() || 'cmd';
    this.telemetryBase = config.topicBaseTelemetry?.trim() || 'tele';
  }

  connect(): void {
    const port = this.config.port ?? 1883;
    const client = mqtt.connect({
      host: this.config.host,
      port,
      username: this.config.username,
      password: this.config.password,
      reconnectPeriod: 5000,
      clientId: `homebridge-nad-amplifier-${Math.random().toString(16).slice(2, 10)}`,
    });
    this.client = client;

    client.on('connect', () => {
      this.log.info('Connected to MQTT broker at %s:%d', this.config.host, port);
      for (const deviceId of this.subscribedDeviceIds) {
        this.subscribeTopics(deviceId);
      }
    });
    client.on('reconnect', () => this.log.debug('Reconnecting to MQTT broker at %s:%d...', this.config.host, port));
    client.on('close', () => this.log.debug('MQTT connection closed'));
    client.on('error', (err: Error) => this.log.error('MQTT client error: %s', err.message));
    client.on('message', (topic: string, payload: Buffer) => this.dispatch(topic, payload));
  }

  /** Registers the handler that receives telemetry updates ("<key>", "<payload>") for one device id. */
  onDeviceTelemetry(deviceId: string, handler: TelemetryHandler): void {
    this.handlers.set(deviceId, handler);
  }

  /** Subscribes to every telemetry topic under this device id (power, volume, source, ...). */
  subscribeDevice(deviceId: string): void {
    this.subscribedDeviceIds.add(deviceId);
    if (this.client?.connected) {
      this.subscribeTopics(deviceId);
    }
  }

  publish(deviceId: string, key: string, value: string | number): void {
    if (!this.client) {
      this.log.warn('Cannot publish to %s/%s: MQTT client is not connected yet', deviceId, key);
      return;
    }
    const topic = `${this.commandBase}/${deviceId}/${key}`;
    this.client.publish(topic, String(value));
  }

  destroy(): void {
    this.client?.end(true);
  }

  private subscribeTopics(deviceId: string): void {
    const topic = `${this.telemetryBase}/${deviceId}/+`;
    this.client?.subscribe(topic, (err) => {
      if (err) {
        this.log.error('Failed to subscribe to %s: %s', topic, err.message);
      } else {
        this.log.debug('Subscribed to %s', topic);
      }
    });
  }

  private dispatch(topic: string, payload: Buffer): void {
    const parts = topic.split('/');
    if (parts.length < 3 || parts[0] !== this.telemetryBase) {
      return;
    }
    const deviceId = parts[1];
    const key = parts.slice(2).join('/');
    this.handlers.get(deviceId)?.(key, payload.toString('utf8'));
  }
}
