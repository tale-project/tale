import { Card } from '@tale/ui/card';
import { cn } from '@tale/ui/cn';
import { SkeletonBox, SkeletonText } from '@tale/ui/skeleton';
import { useSkeleton } from '@tale/ui/skeleton-context';
import { Text } from '@tale/ui/text';
import { ChevronRight } from 'lucide-react';

import { useT } from '@/lib/i18n/client';

export interface SsoSelectableOrg {
  organizationId: string;
  displayName: string;
  protocol: string;
}

interface SsoOrgPickerProps {
  orgs: SsoSelectableOrg[];
  onPick: (organizationId: string, protocol: string) => void;
  /** The list's id, for a host that hands the focus to it. */
  id?: string;
}

/** Rows that hold the list's place, masked, under a loading `Skeletonize`. */
const PLACEHOLDER_ORGS: SsoSelectableOrg[] = [
  { organizationId: 'placeholder-1', displayName: '', protocol: 'oidc' },
  { organizationId: 'placeholder-2', displayName: '', protocol: 'oidc' },
];

function orgInitial(displayName: string): string {
  const trimmed = displayName.trim();
  return trimmed ? trimmed.slice(0, 1).toUpperCase() : '?';
}

function useProtocolLabel(protocol: string): string {
  const { t } = useT('auth');
  switch (protocol) {
    case 'saml':
      return t('sso.protocol.saml');
    case 'oauth2':
      return t('sso.protocol.oauth2');
    default:
      return t('sso.protocol.oidc');
  }
}

function SsoOrgPickerRow({
  org,
  onPick,
}: {
  org: SsoSelectableOrg;
  onPick: (organizationId: string, protocol: string) => void;
}) {
  const loading = useSkeleton();
  const protocolLabel = useProtocolLabel(org.protocol);

  return (
    <button
      type="button"
      role="option"
      aria-selected={false}
      inert={loading || undefined}
      className={cn(
        'group flex w-full cursor-pointer items-center gap-3 px-4 py-3.5 text-left transition-colors',
        'hover:bg-bg-elevated focus-visible:bg-bg-elevated',
        'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset',
      )}
      onClick={() => onPick(org.organizationId, org.protocol)}
    >
      <SkeletonBox asChild>
        <span
          className="bg-muted-foreground/10 text-foreground group-hover:bg-muted-foreground/15 flex size-9 shrink-0 items-center justify-center rounded-lg text-sm font-semibold"
          aria-hidden="true"
        >
          {orgInitial(org.displayName)}
        </span>
      </SkeletonBox>
      <span className="min-w-0 flex-1">
        <Text
          as="span"
          variant="label"
          className={cn('block truncate', loading && 'w-1/2')}
        >
          {loading ? <SkeletonText /> : org.displayName}
        </Text>
        <Text
          as="span"
          variant="caption"
          className={cn('block truncate', loading && 'w-1/4')}
        >
          {loading ? <SkeletonText seed={1} /> : protocolLabel}
        </Text>
      </span>
      <ChevronRight
        className="text-muted-foreground size-4 shrink-0 transition-transform group-hover:translate-x-0.5"
        aria-hidden="true"
      />
    </button>
  );
}

export function SsoOrgPicker({ orgs, onPick, id }: SsoOrgPickerProps) {
  const { t } = useT('auth');
  const loading = useSkeleton();

  return (
    <Card padding="none" shadow="sm" className="overflow-hidden">
      <ul
        id={id}
        role="listbox"
        aria-label={t('login.ssoOrgListLabel')}
        className="divide-border-base divide-y"
      >
        {(loading ? PLACEHOLDER_ORGS : orgs).map((org) => (
          <li key={org.organizationId} role="presentation">
            <SsoOrgPickerRow org={org} onPick={onPick} />
          </li>
        ))}
      </ul>
    </Card>
  );
}
