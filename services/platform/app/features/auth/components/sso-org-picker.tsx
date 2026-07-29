import { Card } from '@tale/ui/card';
import { Text } from '@tale/ui/text';
import { ChevronRight } from 'lucide-react';

import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

export interface SsoSelectableOrg {
  organizationId: string;
  displayName: string;
  protocol: string;
}

interface SsoOrgPickerProps {
  orgs: SsoSelectableOrg[];
  onPick: (organizationId: string, protocol: string) => void;
}

function orgInitial(displayName: string): string {
  const trimmed = displayName.trim();
  return trimmed ? trimmed.slice(0, 1).toUpperCase() : '?';
}

function useProtocolLabel(protocol: string): string {
  const { t } = useT('settings');
  switch (protocol) {
    case 'saml':
      return t('enterpriseSso.protocol.saml');
    case 'oauth2':
      return t('enterpriseSso.protocol.oauth2');
    default:
      return t('enterpriseSso.protocol.oidc');
  }
}

function SsoOrgPickerRow({
  org,
  onPick,
}: {
  org: SsoSelectableOrg;
  onPick: (organizationId: string, protocol: string) => void;
}) {
  const protocolLabel = useProtocolLabel(org.protocol);

  return (
    <button
      type="button"
      role="option"
      aria-selected={false}
      className={cn(
        'group flex w-full cursor-pointer items-center gap-3 px-4 py-3.5 text-left transition-colors',
        'hover:bg-bg-elevated focus-visible:bg-bg-elevated',
        'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset',
      )}
      onClick={() => onPick(org.organizationId, org.protocol)}
    >
      <span
        className="bg-muted-foreground/10 text-foreground group-hover:bg-muted-foreground/15 flex size-9 shrink-0 items-center justify-center rounded-lg text-sm font-semibold"
        aria-hidden="true"
      >
        {orgInitial(org.displayName)}
      </span>
      <span className="min-w-0 flex-1">
        <Text as="span" variant="label" className="block truncate">
          {org.displayName}
        </Text>
        <Text as="span" variant="caption" className="block truncate">
          {protocolLabel}
        </Text>
      </span>
      <ChevronRight
        className="text-muted-foreground size-4 shrink-0 transition-transform group-hover:translate-x-0.5"
        aria-hidden="true"
      />
    </button>
  );
}

export function SsoOrgPicker({ orgs, onPick }: SsoOrgPickerProps) {
  const { t } = useT('auth');

  return (
    <Card padding="none" shadow="sm" className="overflow-hidden">
      <ul
        role="listbox"
        aria-label={t('login.ssoOrgListLabel')}
        className="divide-border-base divide-y"
      >
        {orgs.map((org) => (
          <li key={org.organizationId} role="presentation">
            <SsoOrgPickerRow org={org} onPick={onPick} />
          </li>
        ))}
      </ul>
    </Card>
  );
}
