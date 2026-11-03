import { TableIconCell } from '@tale/ui/data-table/table-icon-cell';
import { Text } from '@tale/ui/text';
import { Network } from 'lucide-react';
import type { ReactNode } from 'react';

import type { Proxy } from '@/lib/api/schemas';
import { useT } from '@/lib/i18n/client';

import { ProxyAddress } from './proxy-address';
import { ProxyExit } from './proxy-exit';
import { ProxyHealth } from './proxy-health';
import { ProxySession } from './proxy-session';

/**
 * One fact of the row: a term and what it says. The term is for a screen
 * reader (the row has no column header over it) unless `caption` shows it, for
 * a fact whose words do not say what they are about: "Free" is the session.
 */
function Fact({
  term,
  wide = false,
  caption = false,
  children,
}: {
  term: string;
  wide?: boolean;
  caption?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={wide ? 'min-w-0 basis-full' : 'min-w-0'}>
      <dt className={caption ? 'mb-1' : 'sr-only'}>
        {caption ? (
          <Text as="span" variant="caption">
            {term}
          </Text>
        ) : (
          term
        )}
      </dt>
      <dd className="m-0 min-w-0">{children}</dd>
    </div>
  );
}

/**
 * A proxy as one row of a column too narrow for the table's columns: its
 * address, then what the columns would say, each under the address instead of
 * beside it, and nothing left for a scrollbar to hide. The cells are those of
 * the columns as they are; the facts are named for a screen reader, which a
 * row without column headers over it has no other way to tell apart. A proxy
 * that was never reached has no exit to tell of, and the health says why.
 */
export function ProxyRowSummary({ proxy }: { proxy: Proxy }) {
  const { t } = useT('proxies');
  const { check } = proxy;
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <TableIconCell
        icon={<Network />}
        label={<ProxyAddress proxy={proxy} />}
      />
      {/* Under the address, not under its mark. */}
      <dl className="m-0 flex min-w-0 flex-wrap items-start gap-x-6 gap-y-2 pl-7">
        {check.exitIp === null ? null : (
          <Fact term={t('columns.exit')} wide>
            <ProxyExit check={check} withPing />
          </Fact>
        )}
        <Fact term={t('columns.health')} caption>
          <ProxyHealth check={check} />
        </Fact>
        <Fact term={t('columns.session')} caption>
          <ProxySession proxy={proxy} />
        </Fact>
      </dl>
    </div>
  );
}
