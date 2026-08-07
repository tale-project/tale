'use client';

import { Alert } from '@tale/ui/alert';
import { Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { ChevronRight } from 'lucide-react';
import { useId, useMemo, useState } from 'react';

import { SearchInput } from '@/app/components/ui/forms/search-input';
import { useT } from '@/lib/i18n/client';

import {
  type CredentialAdapter,
  type CredentialLike,
  type CredentialVendor,
} from './adapter';
import { VendorIcon } from './vendor-icon';

/**
 * Step one of adding a credential: the whole shipped catalog, as a list.
 *
 * Two groups, never a flat A-Z. An operator adding a second key almost always
 * wants a vendor they already run, and that vendor is otherwise buried
 * alphabetically among a dozen they have never configured — so what is already
 * in use leads, and the rest follows. Inside each group it is plain alphabetical
 * order: any other ranking (popularity, ship order) is a claim this page cannot
 * honestly make.
 *
 * A vendor with neither a form nor a consent flow is omitted rather than shown
 * inert. It cannot be added from here, and a row that leads nowhere is worse
 * than an absent one.
 */
export function VendorPickerPane<
  V extends CredentialVendor,
  Cred extends CredentialLike,
  Method extends string,
  Draft,
  Extra,
>({
  vendors,
  inUseKeys,
  adapter,
  onSelect,
  searchPlaceholder,
  catalogEmpty,
}: {
  vendors: readonly V[];
  /** `CredentialVendor.key`s the organization already holds a credential for. */
  inUseKeys: ReadonlySet<string>;
  adapter: CredentialAdapter<V, Cred, Method, Draft, Extra>;
  onSelect: (vendor: V) => void;
  searchPlaceholder: string;
  /** Operator-facing copy for a deployment that ships no vendors at all. */
  catalogEmpty: string;
}) {
  const { t } = useT('settings');
  const [query, setQuery] = useState('');
  const headingId = useId();

  const addable = useMemo(
    () =>
      vendors.filter(
        (vendor) =>
          adapter.formMethods(vendor).length > 0 ||
          adapter.offersConsent?.(vendor) === true,
      ),
    [vendors, adapter],
  );

  const { inUse, available } = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matches = addable.filter((vendor) =>
      needle.length === 0
        ? true
        : vendor.displayName.toLowerCase().includes(needle) ||
          vendor.key.toLowerCase().includes(needle),
    );
    const byName = [...matches].sort((a, b) =>
      a.displayName.localeCompare(b.displayName),
    );
    return {
      inUse: byName.filter((vendor) => inUseKeys.has(vendor.key)),
      available: byName.filter((vendor) => !inUseKeys.has(vendor.key)),
    };
  }, [addable, inUseKeys, query]);

  const group = (
    key: string,
    heading: string | null,
    items: readonly V[],
  ): React.ReactNode => {
    if (items.length === 0) return null;
    const id = `${headingId}-${key}`;
    return (
      <section aria-labelledby={heading !== null ? id : undefined}>
        {heading !== null && (
          <h3
            id={id}
            className="text-muted-foreground px-1 pb-2 text-xs font-medium tracking-wide uppercase"
          >
            {heading}
          </h3>
        )}
        <ul className="flex flex-col gap-1.5">
          {items.map((vendor) => {
            const meta = adapter.vendorMeta(t, vendor);
            return (
              <li
                key={vendor.key}
                className="border-border overflow-hidden rounded-lg border"
              >
                <button
                  type="button"
                  onClick={() => onSelect(vendor)}
                  className="hover:bg-accent focus-visible:ring-ring flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors focus-visible:ring-1 focus-visible:outline-none"
                >
                  <VendorIcon iconUrl={vendor.iconUrl} className="size-5" />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-foreground truncate text-sm font-medium">
                      {vendor.displayName}
                    </span>
                    {meta !== null && meta !== undefined && (
                      <span className="text-muted-foreground truncate text-xs">
                        {meta}
                      </span>
                    )}
                  </span>
                  <ChevronRight
                    aria-hidden
                    className="text-muted-foreground size-4 shrink-0"
                  />
                </button>
              </li>
            );
          })}
        </ul>
      </section>
    );
  };

  // Nothing to search through at all is a DEPLOYMENT fault (an unmounted or
  // unreadable config root), not a search that found nothing — so it says so,
  // and it says so instead of the search box rather than under it.
  if (addable.length === 0) {
    return <Alert variant="warning" description={catalogEmpty} />;
  }

  return (
    <Stack gap={4} className="min-h-0 flex-1">
      <SearchInput
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={searchPlaceholder}
        className="max-w-none"
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {inUse.length === 0 && available.length === 0 ? (
          <Text as="p" variant="muted" className="px-1 py-6 text-sm">
            {t('credentials.catalog.noMatches')}
          </Text>
        ) : (
          <Stack gap={5}>
            {group('in-use', t('credentials.catalog.inUse'), inUse)}
            {group('available', null, available)}
          </Stack>
        )}
      </div>
    </Stack>
  );
}
