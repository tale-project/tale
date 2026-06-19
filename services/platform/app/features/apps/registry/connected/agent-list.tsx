'use client';

/**
 * Connected `AgentList` block — shows the app's agents (the team doing the work)
 * with entry points to configure them. Binds the allowlisted `listAgents` action
 * (one-shot), filtered to the app's manifest agents. "Edit instructions" opens
 * an INLINE modal on this page (no navigation) so configuring the team stays in
 * one place; the env/secrets link still routes to the workflow's Configuration
 * tab (workflow-scoped, where step env/secrets are authored).
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

import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import { isRecord } from '@/lib/utils/type-utils';

import { useBoundAction } from '../../hooks/use-bound-action';
import { useAppRuntime } from '../../runtime/app-runtime';
import { AgentInstructionsDialog } from './agent-instructions-dialog';
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

type AuthMode = 'byo' | 'managed';

/** Compact 2-segment switch for an external-agent's auth mode (BYO ⇄ Managed). */
function AuthModeToggle({
  mode,
  pending,
  onSwitch,
}: {
  mode: AuthMode;
  pending: boolean;
  onSwitch: (next: AuthMode) => void;
}) {
  const { t } = useT('apps');
  return (
    <HStack gap={0} className="border-border overflow-hidden rounded-md border">
      {(['byo', 'managed'] as const).map((m) => (
        <button
          key={m}
          type="button"
          disabled={pending || mode === m}
          aria-pressed={mode === m}
          onClick={() => onSwitch(m)}
          className={
            mode === m
              ? 'bg-muted text-foreground px-2 py-1 text-xs font-medium'
              : 'text-muted-foreground hover:bg-muted/50 px-2 py-1 text-xs disabled:opacity-50'
          }
        >
          {t(`agents.authMode.${m}`)}
        </button>
      ))}
    </HStack>
  );
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
  const read = useBoundAction('agents/file_actions:readAgent', 'action');
  const readRef = useRef(read);
  readRef.current = read;
  const save = useBoundAction('agents/file_actions:saveAgent', 'action');
  const saveRef = useRef(save);
  saveRef.current = save;

  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // The agent whose instructions are being edited inline (null = closed).
  const [editing, setEditing] = useState<{ slug: string; name: string } | null>(
    null,
  );
  // The agent whose auth mode is mid-switch (disables its toggle).
  const [switching, setSwitching] = useState<string | null>(null);

  // Flip an external-agent's authMode in place: read the full config, save it
  // back with the new mode (an authMode-only change isn't capability-widening,
  // so it passes for any member), then reflect it optimistically in the list.
  const switchAuthMode = async (
    slug: string,
    next: AuthMode,
  ): Promise<void> => {
    setSwitching(slug);
    try {
      const cfg = await readRef.current.dispatch({
        organizationId: '$orgId',
        agentName: slug,
      });
      if (!isRecord(cfg) || cfg.ok !== true || !isRecord(cfg.config)) {
        throw new Error(t('agents.authMode.error'));
      }
      await saveRef.current.dispatch({
        organizationId: '$orgId',
        agentName: slug,
        config: { ...cfg.config, authMode: next },
      });
      setRows((rs) =>
        rs.map((r) => (str(r, 'name') === slug ? { ...r, authMode: next } : r)),
      );
    } catch (err) {
      toast({
        title: t('agents.authMode.error'),
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSwitching(null);
    }
  };

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
    <>
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
              const isExternal =
                str(agent, 'primaryBehavior') === 'external-agent';
              const authMode: AuthMode =
                str(agent, 'authMode') === 'managed' ? 'managed' : 'byo';
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
                            setEditing({
                              slug,
                              name: str(agent, 'displayName') || slug,
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
                    <HStack gap={2} className="flex-wrap items-center">
                      {isExternal && (
                        <HStack gap={2} className="items-center">
                          <Text as="span" variant="muted" className="text-xs">
                            {t('agents.authMode.label')}
                          </Text>
                          <AuthModeToggle
                            mode={authMode}
                            pending={switching === slug}
                            onSwitch={(next) => void switchAuthMode(slug, next)}
                          />
                        </HStack>
                      )}
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
      <AgentInstructionsDialog
        agentSlug={editing?.slug ?? null}
        displayName={editing?.name ?? ''}
        onClose={() => setEditing(null)}
      />
    </>
  );
}
