import { Description } from '@tale/ui/description';
import { Stack } from '@tale/ui/layout';
import { RadioGroup } from '@tale/ui/radio-group';
import { SearchableSelect } from '@tale/ui/searchable-select';
import { Text } from '@tale/ui/text';
import { useId } from 'react';

import { useRoleLabel } from '@/app/features/settings/organization/components/role-badge';
import type { AgentConsentOrganization } from '@/app/lib/backend/agent-connections';
import { useT } from '@/lib/i18n/client';

/** Up to this many organizations are listed as choices; more are searched. */
const LISTED_ORGANIZATIONS = 7;

interface AgentOrganizationPickerProps {
  organizations: readonly AgentConsentOrganization[];
  value: string | null;
  disabled: boolean;
  onChange: (organizationId: string) => void;
}

/**
 * The organization the agent will work in: chosen here, never assumed, and
 * the only one it works in. Those the person may not connect an agent to stay
 * on the page, unavailable, and say why. One organization is shown and not
 * asked about; many are searched.
 */
export function AgentOrganizationPicker({
  organizations,
  value,
  disabled,
  onChange,
}: AgentOrganizationPickerProps) {
  const { t } = useT('agentConnections');
  const roleLabel = useRoleLabel();
  const labelId = useId();

  const label = (organization: AgentConsentOrganization) =>
    t('consent.organization.option', {
      name: organization.name,
      role: roleLabel(organization.role),
    });
  const why = (organization: AgentConsentOrganization): string | undefined =>
    organization.allowed
      ? undefined
      : organization.reason === 'ORG_FORBIDDEN'
        ? t('consent.organization.disabled')
        : t('consent.organization.notAllowed');

  const [only] = organizations;
  if (organizations.length === 1 && only !== undefined) {
    return (
      <div role="group" aria-labelledby={labelId}>
        <Stack gap={1}>
          <Text id={labelId} variant="label">
            {t('consent.organization.label')}
          </Text>
          <Text className="break-words">{label(only)}</Text>
          <Description>
            {why(only) ?? t('consent.organization.description')}
          </Description>
        </Stack>
      </div>
    );
  }

  if (organizations.length > LISTED_ORGANIZATIONS) {
    return (
      <SearchableSelect
        label={t('consent.organization.label')}
        description={t('consent.organization.description')}
        value={value}
        disabled={disabled}
        onValueChange={onChange}
        options={organizations.map((organization) => ({
          value: organization.id,
          label: label(organization),
          disabled: !organization.allowed,
          ...(why(organization) !== undefined
            ? { description: why(organization) }
            : {}),
        }))}
      />
    );
  }

  return (
    <RadioGroup
      columns={1}
      label={t('consent.organization.label')}
      description={t('consent.organization.description')}
      value={value ?? ''}
      disabled={disabled}
      onValueChange={onChange}
      options={organizations.map((organization) => ({
        value: organization.id,
        label: label(organization),
        disabled: !organization.allowed,
        description: why(organization),
      }))}
    />
  );
}
