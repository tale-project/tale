'use client';

import { Alert } from '@tale/ui/alert';
import { Badge } from '@tale/ui/badge';
import { Stack } from '@tale/ui/layout';
import { SearchInput } from '@tale/ui/search-input';
import { SkeletonBox } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Text } from '@tale/ui/text';
import { VendorIcon } from '@tale/ui/vendor-icon';
import { ChevronRight, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';

import { useT } from '@/lib/i18n/client';

import {
  type CredentialAdapter,
  type CredentialLike,
  type CredentialVendor,
} from './adapter';

/**
 * Step one of adding a credential: the whole shipped catalog, as a list.
 *
 * Configured vendors lead, then the rest — both in plain alphabetical order.
 * An operator adding a second key almost always wants a vendor they already
 * run, and that vendor is otherwise buried among a dozen they have never
 * configured. A section header implied those groups were different pools;
 * a single list with a "Configured" badge keeps the sort without that
 * misread.
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
  catalogLoading,
}: {
  vendors: readonly V[];
  /** `CredentialVendor.key`s the organization already holds a credential for. */
  inUseKeys: ReadonlySet<string>;
  adapter: CredentialAdapter<V, Cred, Method, Draft, Extra>;
  onSelect: (vendor: V) => void;
  searchPlaceholder: string;
  /** Operator-facing copy for a deployment that ships no vendors at all. */
  catalogEmpty: string;
  catalogLoading: boolean;
}) {
  const { t } = useT('settings');
  const { t: tSkeleton } = useT('skeleton');
  const [query, setQuery] = useState('');

  const addable = useMemo(
    () =>
      vendors.filter(
        (vendor) =>
          adapter.formMethods(vendor).length > 0 ||
          adapter.offersConsent?.(vendor) === true,
      ),
    [vendors, adapter],
  );

  const sorted = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matches = addable.filter((vendor) =>
      needle.length === 0
        ? true
        : vendor.displayName.toLowerCase().includes(needle) ||
          vendor.key.toLowerCase().includes(needle),
    );
    const byName = (items: readonly V[]) =>
      [...items].sort((a, b) => a.displayName.localeCompare(b.displayName));
    return [
      ...byName(matches.filter((vendor) => inUseKeys.has(vendor.key))),
      ...byName(matches.filter((vendor) => !inUseKeys.has(vendor.key))),
    ];
  }, [addable, inUseKeys, query]);

  // The surface's own "define your own" entry, pinned under the catalog:
  // it is not one vendor among the shipped ones, it is the way out when
  // none of them is the endpoint the reader runs — so it stays put whatever
  // the search says.
  const custom = adapter.customVendor?.make(t) ?? null;

  if (catalogLoading) {
    return (
      <Skeletonize loading label={tSkeleton('loading')}>
        <Stack gap={4} className="min-h-0 flex-1">
          <SkeletonBox className="h-10 w-full">&nbsp;</SkeletonBox>
          <Stack gap={2} className="min-h-0 flex-1">
            <SkeletonBox className="h-12 w-full">&nbsp;</SkeletonBox>
            <SkeletonBox className="h-12 w-full">&nbsp;</SkeletonBox>
            <SkeletonBox className="h-12 w-full">&nbsp;</SkeletonBox>
          </Stack>
        </Stack>
      </Skeletonize>
    );
  }

  // Nothing to search through at all is a DEPLOYMENT fault (an unmounted or
  // unreadable config root), not a search that found nothing — so it says so,
  // and it says so instead of the search box rather than under it.
  if (addable.length === 0 && custom === null) {
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
        {addable.length === 0 ? (
          <Alert variant="warning" description={catalogEmpty} />
        ) : sorted.length === 0 ? (
          <Text as="p" variant="muted" className="px-1 py-6 text-sm">
            {t('credentials.catalog.noMatches')}
          </Text>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {sorted.map((vendor) => {
              const meta = adapter.vendorMeta(t, vendor);
              const tag = adapter.vendorTag?.(t, vendor) ?? null;
              const configured = inUseKeys.has(vendor.key);
              return (
                <li
                  key={vendor.key}
                  className="border-border overflow-hidden rounded-lg border"
                >
                  {/* The row answers to its own width (`@container`): one
                      grid places its badges beside the name once it is 24rem
                      wide and beneath it when narrower — on a phone two
                      badges and the chevron left the name, the one thing
                      picked by, as "E…". */}
                  <button
                    type="button"
                    onClick={() => onSelect(vendor)}
                    className="hover:bg-accent focus-visible:ring-ring @container block w-full px-3 py-2.5 text-left transition-colors focus-visible:ring-1 focus-visible:outline-none"
                  >
                    <span className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 @sm:grid-cols-[auto_minmax(0,1fr)_auto_auto]">
                      <VendorIcon
                        iconUrl={vendor.iconUrl}
                        className="col-start-1 row-span-2 row-start-1 size-5"
                      />
                      <span className="col-start-2 row-start-1 flex min-w-0 flex-col">
                        <span className="text-foreground truncate text-sm font-medium">
                          {vendor.displayName}
                        </span>
                        {meta !== null && meta !== undefined && (
                          <span className="text-muted-foreground truncate text-xs">
                            {meta}
                          </span>
                        )}
                      </span>
                      {(tag !== null || configured) && (
                        <span className="col-start-2 row-start-2 mt-1 flex flex-wrap gap-1 @sm:col-start-3 @sm:row-start-1 @sm:mt-0 @sm:flex-nowrap @sm:gap-3">
                          {tag !== null && (
                            <Badge variant="slate" className="shrink-0">
                              {tag}
                            </Badge>
                          )}
                          {configured && (
                            <Badge variant="outline" className="shrink-0">
                              {t('credentials.catalog.configured')}
                            </Badge>
                          )}
                        </span>
                      )}
                      <ChevronRight
                        aria-hidden
                        className="text-muted-foreground col-start-3 row-span-2 row-start-1 size-4 @sm:col-start-4"
                      />
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {custom !== null && (
        <div className="border-border shrink-0 border-t pt-3">
          <button
            type="button"
            onClick={() => onSelect(custom)}
            className="border-border hover:bg-accent focus-visible:ring-ring flex w-full items-center gap-3 rounded-lg border border-dashed px-3 py-2.5 text-left transition-colors focus-visible:ring-1 focus-visible:outline-none"
          >
            <span className="bg-muted text-muted-foreground flex size-5 shrink-0 items-center justify-center rounded-md">
              <Plus aria-hidden className="size-4" />
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-foreground truncate text-sm font-medium">
                {custom.displayName}
              </span>
              <span className="text-muted-foreground text-xs">
                {adapter.vendorMeta(t, custom)}
              </span>
            </span>
            <ChevronRight
              aria-hidden
              className="text-muted-foreground size-4 shrink-0"
            />
          </button>
        </div>
      )}
    </Stack>
  );
}
