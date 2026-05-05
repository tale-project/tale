import type {
  ContactPayload,
  RequestDemoPayload,
  SubmitRequest,
} from './schemas';

interface AdaptiveCardFact {
  title: string;
  value: string;
}

const INTEREST_LABELS: Record<string, string> = {
  enterprise: 'Enterprise solutions',
  professional_services: 'Professional services',
  custom_ai_training: 'Custom AI model training',
  ai_hardware: 'AI hardware',
};

function asFact(
  title: string,
  value: string | undefined,
): AdaptiveCardFact | null {
  return value && value.length > 0 ? { title, value } : null;
}

function buildBaseFacts(
  p: RequestDemoPayload | ContactPayload,
): AdaptiveCardFact[] {
  return [
    { title: 'Name', value: p.name },
    { title: 'Email', value: p.email },
  ];
}

function buildRequestDemoCard(payload: RequestDemoPayload) {
  const facts: AdaptiveCardFact[] = [
    ...buildBaseFacts(payload),
    asFact('Phone', payload.phone),
    asFact('Company', payload.company),
  ].filter((f): f is AdaptiveCardFact => Boolean(f));

  if (payload.interests.length > 0) {
    facts.push({
      title: 'Interested in',
      value: payload.interests.map((i) => INTEREST_LABELS[i] ?? i).join(', '),
    });
  }

  return {
    type: 'message',
    attachments: [
      {
        contentType: 'application/vnd.microsoft.card.adaptive',
        content: {
          type: 'AdaptiveCard',
          $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
          version: '1.5',
          body: [
            {
              type: 'TextBlock',
              text: 'New demo request',
              weight: 'Bolder',
              size: 'Large',
            },
            { type: 'FactSet', facts },
            payload.message
              ? {
                  type: 'TextBlock',
                  text: payload.message,
                  wrap: true,
                  spacing: 'Medium',
                }
              : null,
          ].filter(Boolean),
        },
      },
    ],
  };
}

function buildContactCard(payload: ContactPayload) {
  const facts: AdaptiveCardFact[] = [
    ...buildBaseFacts(payload),
    asFact('Company', payload.company),
  ].filter((f): f is AdaptiveCardFact => Boolean(f));

  return {
    type: 'message',
    attachments: [
      {
        contentType: 'application/vnd.microsoft.card.adaptive',
        content: {
          type: 'AdaptiveCard',
          $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
          version: '1.5',
          body: [
            {
              type: 'TextBlock',
              text: 'New contact message',
              weight: 'Bolder',
              size: 'Large',
            },
            { type: 'FactSet', facts },
            {
              type: 'TextBlock',
              text: payload.message,
              wrap: true,
              spacing: 'Medium',
            },
          ],
        },
      },
    ],
  };
}

export function buildTeamsCard(request: SubmitRequest) {
  return request.form === 'request-demo'
    ? buildRequestDemoCard(request.payload)
    : buildContactCard(request.payload);
}
