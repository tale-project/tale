'use client';

import { Badge } from '@tale/ui/badge';
import { LinkButton } from '@tale/ui/button';
import { CodeBlock } from '@tale/ui/code-block';
import { EmptyState } from '@tale/ui/empty-state';
import { Row, Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { Cpu, KeyRound } from 'lucide-react';
import { useMemo } from 'react';

import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { useFormatDate } from '@/app/hooks/use-format-date';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

interface RuntimeRow {
  daemonId: string;
  adapterType: string;
  name?: string;
  version?: string;
  workspaceKeys?: string[];
  status: 'active' | 'degraded' | 'offline';
  lastHeartbeatAt: number;
}

const STATUS_BADGE: Record<RuntimeRow['status'], string> = {
  active: 'text-green-600 dark:text-green-400 border-green-500/40',
  degraded: 'text-amber-600 dark:text-amber-400 border-amber-500/40',
  offline: 'text-red-600 dark:text-red-400 border-red-500/40',
};

const CLI_INSTALL_COMMAND =
  'curl -fsSL https://raw.githubusercontent.com/tale-project/tale/main/scripts/install-cli.sh | bash';
const SETUP_COMMANDS = 'tale daemon setup\ntale daemon start';

/**
 * Settings → API → Runtimes — built on the shared settings UI
 * (SettingsSection, CodeBlock, EmptyState) so it matches every other settings
 * page: a connect-a-daemon section plus the live fleet list (one row per
 * daemon, its detected adapters with versions, advertised workspace keys, and
 * heartbeat-derived status).
 */
export function RuntimesSettings({
  organizationId,
}: {
  organizationId: string;
}) {
  const { t } = useT('runtimes');
  const { formatRelative } = useFormatDate();
  const { data } = useConvexQuery(api.agent_runtimes.queries.listRuntimes, {
    organizationId,
  });
  const daemons = useMemo(() => {
    const rows: RuntimeRow[] = data ?? [];
    const byDaemon = new Map<string, RuntimeRow[]>();
    for (const row of rows) {
      const list = byDaemon.get(row.daemonId) ?? [];
      list.push(row);
      byDaemon.set(row.daemonId, list);
    }
    return [...byDaemon.entries()];
  }, [data]);

  return (
    <>
      <SettingsSection
        title={t('install.title')}
        description={t('description')}
        action={
          <LinkButton
            variant="primary"
            icon={KeyRound}
            href="/dashboard/$id/settings/api/rest"
            params={{ id: organizationId }}
          >
            {t('install.createKey')}
          </LinkButton>
        }
      >
        <Text as="p" variant="muted" className="text-sm">
          {t('install.cliHint')}
        </Text>
        <CodeBlock copyValue={CLI_INSTALL_COMMAND}>
          {CLI_INSTALL_COMMAND}
        </CodeBlock>
        <Text as="p" variant="muted" className="text-sm">
          {t('install.description')}
        </Text>
        <CodeBlock copyValue={SETUP_COMMANDS}>{SETUP_COMMANDS}</CodeBlock>
        <Text as="p" variant="muted" className="text-xs">
          {t('install.privacy')}
        </Text>
      </SettingsSection>

      <SettingsSection title={t('list.title')}>
        {daemons.length === 0 ? (
          <EmptyState
            icon={Cpu}
            title={t('list.empty')}
            description={t('list.emptyHint')}
          />
        ) : (
          <Stack as="ul" gap={2}>
            {daemons.map(([daemonId, adapters]) => {
              const first = adapters[0];
              const worst: RuntimeRow['status'] = adapters.some(
                (a) => a.status === 'offline',
              )
                ? 'offline'
                : adapters.some((a) => a.status === 'degraded')
                  ? 'degraded'
                  : 'active';
              return (
                <li
                  key={daemonId}
                  className="border-border flex flex-col gap-2 rounded-lg border p-3"
                >
                  <Row gap={2} wrap>
                    <Text as="h3" variant="label" className="min-w-0 truncate">
                      {first?.name || daemonId}
                    </Text>
                    <Badge
                      variant="outline"
                      className={cn('text-[10px]', STATUS_BADGE[worst])}
                    >
                      {t(`status.${worst}`)}
                    </Badge>
                    <Text
                      as="span"
                      variant="muted"
                      className="ml-auto shrink-0 text-xs"
                    >
                      {t('list.lastSeen', {
                        age: formatRelative(
                          new Date(
                            Math.max(...adapters.map((a) => a.lastHeartbeatAt)),
                          ),
                        ),
                      })}
                    </Text>
                  </Row>
                  <Text as="p" variant="muted" className="font-mono text-xs">
                    {daemonId}
                  </Text>
                  <ul className="flex flex-wrap gap-1.5">
                    {adapters.map((adapter) => (
                      <li key={adapter.adapterType}>
                        <Badge variant="outline" className="text-[10px]">
                          {adapter.adapterType}
                          {adapter.version ? ` · ${adapter.version}` : ''}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                  {first?.workspaceKeys && first.workspaceKeys.length > 0 && (
                    <Text as="p" variant="muted" className="text-xs">
                      {t('list.workspaces', {
                        keys: first.workspaceKeys.join(', '),
                      })}
                    </Text>
                  )}
                </li>
              );
            })}
          </Stack>
        )}
      </SettingsSection>
    </>
  );
}
