'use client';

/**
 * Connected `AgentList` block — shows the app's agents (the team doing the work)
 * with entry points to configure them. Binds the allowlisted `listAgents` action
 * (one-shot), filtered to the app's manifest agents. Configuration deep-edits
 * live on canonical routes, so the cards LINK there (instructions/model editor +
 * env/secrets) rather than rebuild them inline. For an app whose agents run
 * inside a workflow's sandbox, env/secrets are scoped to that workflow — so when
 * a `workflowSlug` is given the env link opens the workflow's Configuration tab
 * (where step env/secrets are authored), not personal settings.
 */
import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { Card } from '@tale/ui/card';
import { HStack, VStack } from '@tale/ui/layout';
import { SkeletonText } from '@tale/ui/skeleton';
import { Text } from '@tale/ui/text';
import { useNavigate } from '@tanstack/react-router';
import { Users } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { useT } from '@/lib/i18n/client';
import { isRecord } from '@/lib/utils/type-utils';

import { useBoundAction } from '../../hooks/use-bound-action';
import { useAppRuntime } from '../../runtime/app-runtime';
import { Section } from './section';

export interface AgentListProps {
  title?: string;
  /** The app's agent slugs (manifest.agents) to show; empty = all org agents. */
  agents?: string[];
  /** role token -> agent slug (manifest.roles), for the role badge. */
  roles?: Record<string, string>;
  /**
   * The workflow these agents run inside. When set, the env/secrets link opens
   * that workflow's Configuration tab (the correct, app-scoped place to set
   * step env/secrets); when absent, it falls back to personal env settings.
   */
  workflowSlug?: string;
}

function str(rec: Record<string, unknown>, key: string): string {
  const v = rec[key];
  return typeof v === 'string' ? v : '';
}

function strArr(rec: Record<string, unknown>, key: string): string[] {
  const v = rec[key];
  return Array.isArray(v)
    ? v.filter((x): x is string => typeof x === 'string')
    : [];
}

export function AgentList({
  title,
  agents,
  roles,
  workflowSlug,
}: AgentListProps) {
  const { t } = useT('apps');
  const { organizationId } = useAppRuntime();
  const navigate = useNavigate();

  const openEnvSettings = (): void => {
    if (workflowSlug) {
      void navigate({
        to: '/dashboard/$id/automations/$amId/configuration',
        params: { id: organizationId, amId: workflowSlug },
      });
    } else {
      void navigate({
        to: '/dashboard/$id/settings/environment',
        params: { id: organizationId },
      });
    }
  };
  const list = useBoundAction('agents/file_actions:listAgents', 'action');
  const listRef = useRef(list);
  listRef.current = list;

  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await listRef.current.dispatch({
          organizationId: '$orgId',
        });
        const all = Array.isArray(result) ? result.filter(isRecord) : [];
        const wanted =
          agents && agents.length > 0
            ? all.filter((a) => agents.includes(str(a, 'name')))
            : all;
        if (!cancelled) setRows(wanted);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [agents]);

  const roleOf = (slug: string): string | undefined => {
    if (!roles) return undefined;
    return Object.entries(roles).find(([, s]) => s === slug)?.[0];
  };

  return (
    <Section title={title} icon={Users}>
      {error ? (
        <Text variant="error">{t('agents.error', { error })}</Text>
      ) : loading && rows.length === 0 ? (
        <SkeletonText lines={3} />
      ) : rows.length === 0 ? (
        <Text variant="muted">{t('agents.none')}</Text>
      ) : (
        <VStack gap={2}>
          {rows.map((agent, i) => {
            const slug = str(agent, 'name');
            const role = roleOf(slug);
            const models = strArr(agent, 'supportedModels');
            const integrations = strArr(agent, 'integrationBindings');
            return (
              <Card key={i}>
                <VStack gap={2}>
                  <HStack gap={3} className="items-center justify-between">
                    <HStack gap={2} className="min-w-0 items-center">
                      <Text as="span" className="font-medium" truncate>
                        {str(agent, 'displayName') || slug}
                      </Text>
                      {role && <Badge variant="blue">{role}</Badge>}
                    </HStack>
                    <HStack gap={2}>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() =>
                          void navigate({
                            to: '/dashboard/$id/agents/$agentId/instructions',
                            params: { id: organizationId, agentId: slug },
                          })
                        }
                      >
                        {t('agents.editInstructions')}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={openEnvSettings}
                      >
                        {t('agents.envSecrets')}
                      </Button>
                    </HStack>
                  </HStack>
                  <HStack gap={2} className="flex-wrap">
                    {models[0] && <Badge variant="slate">{models[0]}</Badge>}
                    {integrations.map((ig) => (
                      <Badge key={ig} variant="green">
                        {ig}
                      </Badge>
                    ))}
                  </HStack>
                </VStack>
              </Card>
            );
          })}
        </VStack>
      )}
    </Section>
  );
}
