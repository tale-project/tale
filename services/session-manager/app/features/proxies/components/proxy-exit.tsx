import { Text } from '@tale/ui/text';

import { NoValue } from '@/app/components/no-value';
import type { ProxyCheckResult } from '@/lib/api/schemas';
import { useT } from '@/lib/i18n/client';

import { useRegionName } from '../hooks/use-region-name';

/**
 * The IP the proxy exits through, with its country (code and name) under it.
 * While a new check runs these are still the last check's, until it ends.
 * They wrap and are never cut short: an IPv6 address and the name of a country
 * are long, and a title is not on a keyboard or a touch screen.
 *
 * `withPing` adds the latency to the country line, for a row that has no
 * column of its own for it. A screen reader hears it named, since it would
 * otherwise hear a bare figure after the country.
 */
export function ProxyExit({
  check,
  withPing = false,
}: {
  check: ProxyCheckResult;
  withPing?: boolean;
}) {
  const { t } = useT('proxies');
  const regionName = useRegionName();
  if (check.exitIp === null) return <NoValue label={t('unknown')} />;
  const country =
    check.country === null
      ? null
      : `${check.country} · ${regionName(check.country)}`;
  const ping =
    withPing && check.latencyMs !== null
      ? t('ping', { ms: check.latencyMs })
      : null;
  return (
    <span className="flex min-w-0 flex-col">
      <Text as="span" variant="body" className="wrap-anywhere tabular-nums">
        {check.exitIp}
      </Text>
      {country === null && ping === null ? null : (
        <Text as="span" variant="caption" className="break-words tabular-nums">
          {country === null ? null : <span>{country}</span>}
          {country !== null && ping !== null ? ' · ' : null}
          {ping === null ? null : (
            <span>
              <span className="sr-only">{t('columns.ping')} </span>
              {ping}
            </span>
          )}
        </Text>
      )}
    </span>
  );
}

/** The latency of the last check, in milliseconds. */
export function ProxyPing({ check }: { check: ProxyCheckResult }) {
  const { t } = useT('proxies');
  if (check.latencyMs === null) return <NoValue label={t('unknown')} />;
  return (
    <Text as="span" variant="body" className="whitespace-nowrap tabular-nums">
      {t('ping', { ms: check.latencyMs })}
    </Text>
  );
}
