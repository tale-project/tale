'use client';

/**
 * The agent's own repository access: which of the organization's
 * credentials it acts as for each equipped connector that opens git
 * remotes (GitHub, Forgejo), and the name and email its commits carry.
 *
 * A pin names a credential by its name; a connector without one uses the
 * organization's default. Only Owners and Admins change the pins (the
 * server holds the same rule), since a pin decides which repositories the
 * agent's runs can push to. Pins of connectors the agent is not equipped
 * with are kept as they are and apply again once it is.
 */

import { Description } from '@tale/ui/description';
import { FieldShell } from '@tale/ui/field-shell';
import { Input } from '@tale/ui/input';
import { Label } from '@tale/ui/label';
import { Stack } from '@tale/ui/layout';
import { Select } from '@tale/ui/select';
import { useId } from 'react';

import type { SkillOption } from '@/app/components/skills/skills-menu';
import { useT } from '@/lib/i18n/client';

/** The select's value for "no pin": the organization's default. */
const DEFAULT_VALUE = '__default__';

/** One of the organization's credentials, as the settings listing names it. */
export interface RepositoryCredentialOption {
  connectorSlug: string;
  name: string;
  isDefault: boolean;
  status: 'active' | 'disabled' | 'needs-reauth';
}

/** A connector offered to the agent; `git` when its credential opens git
 * remotes. */
export type RepositoryConnectorOption = SkillOption & { git?: true };

interface AgentRepositoryAccessFieldProps {
  /** The connectors the dialog offers. */
  connectors: readonly RepositoryConnectorOption[];
  /** The connectors the agent is equipped with now. */
  equipped: readonly string[];
  credentials: readonly RepositoryCredentialOption[];
  pins: Readonly<Record<string, string>>;
  onPinsChange: (next: Record<string, string>) => void;
  gitName: string;
  gitEmail: string;
  onGitNameChange: (value: string) => void;
  onGitEmailChange: (value: string) => void;
  gitIdentityError?: string;
  /** Whether the person may change the pins (Owners and Admins). */
  canChangePins: boolean;
  disabled?: boolean;
}

export function AgentRepositoryAccessField({
  connectors,
  equipped,
  credentials,
  pins,
  onPinsChange,
  gitName,
  gitEmail,
  onGitNameChange,
  onGitEmailChange,
  gitIdentityError,
  canChangePins,
  disabled,
}: AgentRepositoryAccessFieldProps) {
  const { t } = useT('projects');
  const fieldId = useId();
  const labelId = `${fieldId}-label`;
  const descriptionId = `${fieldId}-description`;
  const identityLabelId = `${fieldId}-identity-label`;
  const identityDescriptionId = `${fieldId}-identity-description`;
  const gitConnectors = connectors.filter(
    (connector) => connector.git === true && equipped.includes(connector.slug),
  );

  const setPin = (slug: string, value: string): void => {
    const next = { ...pins };
    if (value === DEFAULT_VALUE) delete next[slug];
    else next[slug] = value;
    onPinsChange(next);
  };

  return (
    <Stack gap={3}>
      <FieldShell
        wideControl
        label={<Label id={labelId}>{t('agents.repository.label')}</Label>}
        description={
          <Description id={descriptionId}>
            {gitConnectors.length === 0
              ? t('agents.repository.none')
              : canChangePins
                ? t('agents.repository.hint')
                : t('agents.repository.adminOnly')}
          </Description>
        }
      >
        <Stack
          gap={2}
          role="group"
          aria-labelledby={labelId}
          aria-describedby={descriptionId}
        >
          {gitConnectors.map((connector) => {
            const own = credentials.filter(
              (credential) => credential.connectorSlug === connector.slug,
            );
            const fallback = own.find((credential) => credential.isDefault);
            const pinned = pins[connector.slug];
            const options = [
              {
                value: DEFAULT_VALUE,
                label:
                  fallback === undefined
                    ? t('agents.repository.default')
                    : t('agents.repository.defaultNamed', {
                        name: fallback.name,
                      }),
              },
              ...own.map((credential) => ({
                value: credential.name,
                label:
                  credential.status === 'active'
                    ? credential.name
                    : t('agents.repository.unusable', {
                        name: credential.name,
                      }),
              })),
              // A pin whose credential is gone stays visible, so it can be
              // seen and replaced: runs get nothing for it until then.
              ...(pinned !== undefined &&
              !own.some((credential) => credential.name === pinned)
                ? [
                    {
                      value: pinned,
                      label: t('agents.repository.missing', { name: pinned }),
                    },
                  ]
                : []),
            ];
            return (
              <Select
                key={connector.slug}
                id={`project-agent-credential-${connector.slug}`}
                label={t('agents.repository.connectorLabel', {
                  connector: connector.label,
                })}
                options={options}
                value={pinned ?? DEFAULT_VALUE}
                disabled={disabled === true || !canChangePins}
                onValueChange={(value) => {
                  // Radix fires a spurious '' on unmount/re-select races.
                  if (value === '') return;
                  setPin(connector.slug, value);
                }}
              />
            );
          })}
        </Stack>
      </FieldShell>
      <FieldShell
        wideControl
        label={
          <Label id={identityLabelId}>{t('agents.gitIdentity.label')}</Label>
        }
        description={
          <Description id={identityDescriptionId}>
            {t('agents.gitIdentity.hint')}
          </Description>
        }
      >
        <Stack
          gap={2}
          role="group"
          aria-labelledby={identityLabelId}
          aria-describedby={identityDescriptionId}
        >
          <Input
            id="project-agent-git-name"
            label={t('agents.gitIdentity.nameLabel')}
            placeholder={t('agents.gitIdentity.namePlaceholder')}
            value={gitName}
            disabled={disabled}
            onChange={(e) => onGitNameChange(e.target.value)}
          />
          <Input
            id="project-agent-git-email"
            type="email"
            label={t('agents.gitIdentity.emailLabel')}
            placeholder={t('agents.gitIdentity.emailPlaceholder')}
            value={gitEmail}
            disabled={disabled}
            errorMessage={gitIdentityError}
            onChange={(e) => onGitEmailChange(e.target.value)}
          />
        </Stack>
      </FieldShell>
    </Stack>
  );
}
