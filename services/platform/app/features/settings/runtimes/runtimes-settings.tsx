'use client';

import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { EmptyState } from '@tale/ui/empty-state';
import { Text } from '@tale/ui/text';
import { Link } from '@tanstack/react-router';
import { Cpu, KeyRound, TerminalSquare } from 'lucide-react';
import { useMemo } from 'react';

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

/**
 * Settings → API → Runtimes: connect-a-daemon instructions plus the live
 * fleet list (one card per daemon, its detected adapters with versions,
 * advertised workspace keys, and heartbeat-derived status).
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
    <div className="flex flex-col gap-4">
      {/* Install card */}
      <section className="border-border bg-card flex flex-col gap-3 rounded-lg border p-4">
        <div className="flex items-center gap-2">
          <TerminalSquare
            className="text-muted-foreground size-4"
            aria-hidden
          />
          <Text as="h3" variant="label">
            {t('install.title')}
          </Text>
        </div>
        <Text as="p" variant="muted" className="text-sm">
          {t('install.description')}
        </Text>
        <pre className="bg-muted overflow-x-auto rounded-md p-3 font-mono text-xs">
          {'bunx tale-daemon setup\nbunx tale-daemon start'}
        </pre>
        <Text as="p" variant="muted" className="text-xs">
          {t('install.privacy')}
        </Text>
        <div>
          <Button asChild size="sm" variant="secondary" icon={KeyRound}>
            <Link
              to="/dashboard/$id/settings/api/rest"
              params={{ id: organizationId }}
            >
              {t('install.createKey')}
            </Link>
          </Button>
        </div>
      </section>

      {/* Fleet list */}
      {daemons.length === 0 ? (
        <EmptyState
          icon={Cpu}
          title={t('list.empty')}
          description={t('list.emptyHint')}
        />
      ) : (
        daemons.map(([daemonId, adapters]) => {
          const first = adapters[0];
          const worst: RuntimeRow['status'] = adapters.some(
            (a) => a.status === 'offline',
          )
            ? 'offline'
            : adapters.some((a) => a.status === 'degraded')
              ? 'degraded'
              : 'active';
          return (
            <section
              key={daemonId}
              className="border-border bg-card flex flex-col gap-2 rounded-lg border p-4"
            >
              <div className="flex flex-wrap items-center gap-2">
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
              </div>
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
            </section>
          );
        })
      )}
    </div>
  );
}
