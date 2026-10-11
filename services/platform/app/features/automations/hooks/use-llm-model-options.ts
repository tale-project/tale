'use client';

import { useMemo } from 'react';

import { useProjectHarnesses } from '@/app/features/projects/hooks/queries';
import { toModelOptions } from '@/lib/shared/harness-offer';

/** One model an `llm` step may name, as the pickers list it. */
export interface LlmModelOption {
  value: string;
  label: string;
  /** The providers that serve it. */
  description: string;
}

/**
 * The models an `llm` step may name: what the organization's connected
 * providers serve, from the composer roster, one entry per model id — the
 * llm walk picks the provider itself, so two providers serving the same id
 * are one choice — and direct lanes only: a subscription-served model only
 * an agent harness can use. `loaded` says the roster has answered, so an
 * empty list while it loads is never read as "nothing is served".
 */
export function useLlmModelOptions(organizationId: string): {
  options: LlmModelOption[];
  loaded: boolean;
} {
  const roster = useProjectHarnesses(organizationId);
  const options = useMemo(() => {
    const byId = new Map<string, { label: string; providers: string[] }>();
    for (const option of toModelOptions(roster.data?.models ?? [])) {
      if (option.subscription !== undefined) continue;
      const entry = byId.get(option.id);
      if (entry) entry.providers.push(option.providerLabel);
      else {
        byId.set(option.id, {
          label: option.label,
          providers: [option.providerLabel],
        });
      }
    }
    return [...byId.entries()].map(([id, entry]) => ({
      value: id,
      label: entry.label,
      description: entry.providers.join(', '),
    }));
  }, [roster.data]);
  return { options, loaded: roster.data !== undefined };
}
