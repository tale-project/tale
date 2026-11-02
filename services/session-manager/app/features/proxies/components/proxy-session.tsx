import { Badge } from '@tale/ui/badge';
import { cn } from '@tale/ui/cn';
import { Text } from '@tale/ui/text';
import { Link } from '@tanstack/react-router';
import { AlertTriangle } from 'lucide-react';

import { SessionStatus } from '@/app/features/sessions/components/session-status';
import { TABLE_LINK_CLASS } from '@/app/lib/table-link';
import type { Proxy } from '@/lib/api/schemas';
import { useT } from '@/lib/i18n/client';

import { sessionCellOf } from '../lib/session-cell';

/**
 * Who has the proxy, or why nobody does. A proxy belongs to at most one
 * session, and a session never gets one that does not work or whose exit IP
 * another session already uses. The reason is a line of the cell, which wraps
 * (the name of a session is never cut short): a tooltip is not on a keyboard
 * or a touch screen.
 */
export function ProxySession({ proxy }: { proxy: Proxy }) {
  const { t } = useT('proxies');
  const cell = sessionCellOf(proxy);

  if (cell.kind === 'session') {
    return (
      <div className="flex min-w-0 flex-col">
        <Link
          to="/sessions/$sessionId"
          params={{ sessionId: String(cell.session.id) }}
          className={cn(TABLE_LINK_CLASS, 'block')}
        >
          <Text as="span" variant="label" className="block wrap-anywhere">
            {cell.session.name}
          </Text>
        </Link>
        <SessionStatus status={cell.session.status} className="text-xs" />
      </div>
    );
  }

  if (cell.kind === 'failed') {
    return (
      <div className="flex min-w-0 flex-col items-start gap-1">
        <Text as="span" variant="muted">
          {t('session.notAssigned')}
        </Text>
        <Text as="span" variant="caption" className="break-words">
          {t('session.failedReason')}
        </Text>
      </div>
    );
  }

  if (cell.kind === 'same-ip') {
    return (
      <div className="flex min-w-0 flex-col items-start gap-1">
        {/* `max-w-full`: a long name is cut inside the cell, not over its
            neighbour; the sentence under it has the name whole. */}
        <Badge variant="yellow" icon={AlertTriangle} className="max-w-full">
          {t('session.sameIp', { name: cell.other.name })}
        </Badge>
        <Text as="span" variant="caption" className="break-words">
          {t('session.sameIpReason', { name: cell.other.name })}
        </Text>
      </div>
    );
  }

  return (
    <Text as="span" variant="body">
      {t('session.free')}
    </Text>
  );
}
