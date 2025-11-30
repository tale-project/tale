import { replaceVariables } from '../../../../lib/variables/replace_variables';

interface ManualTriggerConfig {
  type: 'manual';
  data?: unknown;
}

interface ScheduleTriggerConfig {
  type: 'scheduled';
  schedule: string;
  timezone?: string;
}

interface WebhookTriggerConfig {
  type: 'webhook';
  webhookData?: unknown;
  headers?: Record<string, unknown>;
}

interface EventTriggerConfig {
  type: 'event';
  eventType: string;
  eventData?: unknown;
}

export type TriggerConfig =
  | ManualTriggerConfig
  | ScheduleTriggerConfig
  | WebhookTriggerConfig
  | EventTriggerConfig;

export async function processTriggerConfig(
  config: TriggerConfig,
  variables: Record<string, unknown>,
): Promise<{ variables: Record<string, unknown> }> {
  let triggerData: unknown;
  let triggerSource: string;

  switch (config.type) {
    case 'manual': {
      const data = config.data || {};
      const processed = replaceVariables(JSON.stringify(data), variables);
      triggerData = JSON.parse(processed);
      triggerSource = 'manual';
      break;
    }

    case 'scheduled':
      triggerData = {
        schedule: config.schedule || '0 0 * * *',
        timezone: config.timezone || 'UTC',
        executedAt: new Date().toISOString(),
      };
      triggerSource = 'scheduled';
      break;

    case 'webhook':
      triggerData = {
        payload: config.webhookData ?? variables['webhookData'] ?? {},
        headers: config.headers ?? variables['headers'] ?? {},
        receivedAt: new Date().toISOString(),
      };
      triggerSource = 'webhook';
      break;

    case 'event':
      triggerData = {
        eventType: config.eventType || 'generic',
        eventData: config.eventData ?? variables['eventData'] ?? {},
        triggeredAt: new Date().toISOString(),
      };
      triggerSource = 'event';
      break;

    default:
      throw new Error(
        `Unsupported trigger type: ${(config as TriggerConfig).type}`,
      );
  }

  return { variables: { triggerData, triggerSource } };
}
