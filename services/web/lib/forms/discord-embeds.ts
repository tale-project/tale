import type {
  ContactPayload,
  RequestDemoPayload,
  SubmitRequest,
} from './schemas';

interface DiscordEmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

interface DiscordEmbed {
  title: string;
  description?: string;
  color: number;
  fields: DiscordEmbedField[];
  timestamp: string;
}

interface DiscordWebhookPayload {
  username: string;
  embeds: DiscordEmbed[];
}

// Discord per-field limits: name ≤ 256, value ≤ 1024.
// We trim defensively even though our zod schemas already cap inputs at 2000.
const FIELD_VALUE_MAX = 1024;
const DESCRIPTION_MAX = 4096;
const USERNAME = 'Tale website';
const COLOR_DEMO = 0x6366f1; // indigo-500
const COLOR_CONTACT = 0x10b981; // emerald-500

const INTEREST_LABELS: Record<string, string> = {
  enterprise: 'Enterprise solutions',
  professional_services: 'Professional services',
  custom_ai_training: 'Custom AI model training',
  ai_hardware: 'AI hardware',
};

function clip(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function field(
  name: string,
  value: string | undefined,
  inline = true,
): DiscordEmbedField | null {
  if (!value || value.length === 0) return null;
  return { name, value: clip(value, FIELD_VALUE_MAX), inline };
}

function buildBaseFields(
  p: RequestDemoPayload | ContactPayload,
): DiscordEmbedField[] {
  return [
    { name: 'Name', value: clip(p.name, FIELD_VALUE_MAX), inline: true },
    { name: 'Email', value: clip(p.email, FIELD_VALUE_MAX), inline: true },
  ];
}

function buildRequestDemoEmbed(payload: RequestDemoPayload): DiscordEmbed {
  const fields: DiscordEmbedField[] = [
    ...buildBaseFields(payload),
    field('Phone', payload.phone),
    field('Company', payload.company),
  ].filter((f): f is DiscordEmbedField => Boolean(f));

  if (payload.interests.length > 0) {
    fields.push({
      name: 'Interested in',
      value: clip(
        payload.interests.map((i) => INTEREST_LABELS[i] ?? i).join(', '),
        FIELD_VALUE_MAX,
      ),
      inline: false,
    });
  }

  return {
    title: 'New demo request',
    description: payload.message
      ? clip(payload.message, DESCRIPTION_MAX)
      : undefined,
    color: COLOR_DEMO,
    fields,
    timestamp: new Date().toISOString(),
  };
}

function buildContactEmbed(payload: ContactPayload): DiscordEmbed {
  const fields: DiscordEmbedField[] = [
    ...buildBaseFields(payload),
    field('Company', payload.company),
  ].filter((f): f is DiscordEmbedField => Boolean(f));

  return {
    title: 'New contact message',
    description: clip(payload.message, DESCRIPTION_MAX),
    color: COLOR_CONTACT,
    fields,
    timestamp: new Date().toISOString(),
  };
}

export function buildDiscordPayload(
  request: SubmitRequest,
): DiscordWebhookPayload {
  const embed =
    request.form === 'request-demo'
      ? buildRequestDemoEmbed(request.payload)
      : buildContactEmbed(request.payload);
  return { username: USERNAME, embeds: [embed] };
}
