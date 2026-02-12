'use client';

import { createAvailableIntegrationsCollection } from '@/lib/collections/entities/available-integrations';
import { createAvailableToolsCollection } from '@/lib/collections/entities/available-tools';
import { createCustomAgentVersionsCollection } from '@/lib/collections/entities/custom-agent-versions';
import { createCustomAgentWebhooksCollection } from '@/lib/collections/entities/custom-agent-webhooks';
import { createCustomAgentsCollection } from '@/lib/collections/entities/custom-agents';
import { useCollection } from '@/lib/collections/use-collection';

export function useCustomAgentCollection(organizationId: string) {
  return useCollection(
    'custom-agents',
    createCustomAgentsCollection,
    organizationId,
  );
}

export function useCustomAgentVersionCollection(
  customAgentId: string | undefined,
) {
  return useCollection(
    'custom-agent-versions',
    createCustomAgentVersionsCollection,
    customAgentId ?? '',
  );
}

export function useCustomAgentWebhookCollection(
  customAgentId: string | undefined,
) {
  return useCollection(
    'custom-agent-webhooks',
    createCustomAgentWebhooksCollection,
    customAgentId ?? '',
  );
}

export function useAvailableIntegrationCollection(organizationId: string) {
  return useCollection(
    'available-integrations',
    createAvailableIntegrationsCollection,
    organizationId,
  );
}

export function useAvailableToolCollection() {
  return useCollection(
    'available-tools',
    createAvailableToolsCollection,
    'global',
  );
}
