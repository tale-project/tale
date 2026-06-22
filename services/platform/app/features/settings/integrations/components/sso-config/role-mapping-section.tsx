'use client';

import { Button } from '@tale/ui/button';
import { Stack, HStack } from '@tale/ui/layout';
import { Plus, Trash2 } from 'lucide-react';

import { FormSection } from '@/app/components/ui/forms/form-section';
import { Input } from '@/app/components/ui/forms/input';
import { Select } from '@/app/components/ui/forms/select';
import { useT } from '@/lib/i18n/client';
import type {
  PlatformRole,
  RoleMappingRule,
} from '@/lib/shared/schemas/sso_providers';
import { narrowStringUnion } from '@/lib/utils/type-utils';

import type { SsoProviderType } from '../../hooks/use-sso-config-form';

type RuleSource = RoleMappingRule['source'];

interface RoleMappingSectionProps {
  rules: RoleMappingRule[];
  platformRoles: { value: PlatformRole; label: string }[];
  providerType: SsoProviderType;
  disabled: boolean;
  onAdd: () => void;
  onRemove: (index: number) => void;
  onUpdate: (index: number, updates: Partial<RoleMappingRule>) => void;
}

export function RoleMappingSection({
  rules,
  platformRoles,
  providerType,
  disabled,
  onAdd,
  onRemove,
  onUpdate,
}: RoleMappingSectionProps) {
  const { t } = useT('settings');

  // Entra reads jobTitle/appRole from Microsoft Graph and groups from the
  // directory; generic OIDC only has the userinfo response, so groups and
  // arbitrary claims are its rule sources.
  const isGeneric = providerType === 'generic-oidc';
  const sourceValues: RuleSource[] = isGeneric
    ? ['group', 'claim']
    : ['jobTitle', 'appRole', 'group'];
  const sourceLabels: Record<RuleSource, string> = {
    jobTitle: t('integrations.sso.sourceJobTitle'),
    appRole: t('integrations.sso.sourceAppRole'),
    group: t('integrations.sso.sourceGroup'),
    claim: t('integrations.sso.sourceClaim'),
  };

  return (
    <FormSection
      label={t('integrations.sso.roleMappingRulesLabel')}
      description={
        isGeneric
          ? t('integrations.sso.roleMappingRulesHelpGeneric')
          : t('integrations.sso.roleMappingRulesHelp')
      }
    >
      <Stack gap={0} className="divide-border divide-y">
        {rules.map((rule, index) => (
          <HStack
            key={index}
            gap={2}
            align="center"
            className="flex-wrap py-3 first:pt-0 last:pb-0"
          >
            <Select
              value={rule.source}
              onValueChange={(value) => {
                const narrowed = narrowStringUnion<RuleSource>(
                  value,
                  sourceValues,
                );
                if (narrowed) {
                  onUpdate(index, { source: narrowed });
                }
              }}
              disabled={disabled}
              aria-label={t('integrations.sso.ruleSourceLabel')}
              className="w-28 shrink-0"
              options={sourceValues.map((source) => ({
                value: source,
                label: sourceLabels[source],
              }))}
            />

            {rule.source === 'claim' && (
              <Input
                placeholder="realm_access.roles"
                aria-label={t('integrations.sso.claimPathLabel')}
                value={rule.claim ?? ''}
                onChange={(e) => onUpdate(index, { claim: e.target.value })}
                disabled={disabled}
                className="min-w-32 flex-1"
              />
            )}

            <Input
              placeholder={isGeneric ? '*admin*' : '*developer*'}
              aria-label={t('integrations.sso.rulePatternLabel')}
              value={rule.pattern}
              onChange={(e) => onUpdate(index, { pattern: e.target.value })}
              disabled={disabled}
              className="min-w-32 flex-1"
            />

            <Select
              value={rule.targetRole}
              onValueChange={(value) => {
                const narrowed = narrowStringUnion<PlatformRole>(value, [
                  'admin',
                  'developer',
                  'editor',
                  'member',
                  'disabled',
                ] as const);
                if (narrowed) {
                  onUpdate(index, { targetRole: narrowed });
                }
              }}
              disabled={disabled}
              aria-label={t('integrations.sso.ruleTargetRoleLabel')}
              className="w-28 shrink-0"
              options={platformRoles}
            />

            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => onRemove(index)}
              disabled={disabled}
              title={t('integrations.sso.removeRule')}
              className="shrink-0"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </HStack>
        ))}

        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={onAdd}
          disabled={disabled}
        >
          <Plus className="mr-2 h-4 w-4" />
          {t('integrations.sso.addRule')}
        </Button>
      </Stack>
    </FormSection>
  );
}
