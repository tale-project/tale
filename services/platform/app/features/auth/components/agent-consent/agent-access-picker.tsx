import { CheckboxGroup } from '@tale/ui/checkbox-group';
import { RadioGroup } from '@tale/ui/radio-group';
import type { ReactNode } from 'react';

import { useT } from '@/lib/i18n/client';
import {
  type AccessLevel,
  EXTRA_SCOPES,
  type ExtraScope,
} from '@/lib/shared/agent-access';

import {
  ACCESS_LEVEL_ORDER,
  type AccessChoice,
  type ConsentOffer,
  extraAvailability,
  levelAvailability,
  type Unavailable,
  withExtra,
} from './agent-consent-model';

interface AgentAccessPickerProps {
  offer: ConsentOffer;
  choice: AccessChoice;
  /** The organization's name, for what its role does not allow. */
  organizationName: string;
  disabled: boolean;
  onChange: (choice: AccessChoice) => void;
}

/**
 * The access the person gives: one level — read and test, edit, edit and
 * deploy, each adding to the one before — and the extras beside it. What the
 * app did not ask for and what the role does not allow stays on the page,
 * unavailable, and says why.
 */
export function AgentAccessPicker({
  offer,
  choice,
  organizationName,
  disabled,
  onChange,
}: AgentAccessPickerProps) {
  const { t } = useT('agentConnections');

  const reason = (why: Unavailable | null): ReactNode =>
    why === null
      ? null
      : why === 'notRequested'
        ? t('consent.access.notRequested')
        : t('consent.access.roleCannot', { organization: organizationName });

  /** Each key is named in full, so the catalog's checks can find it. */
  const levelWords = (level: AccessLevel) =>
    level === 'read'
      ? {
          label: t('consent.access.read.label'),
          description: t('consent.access.read.description'),
        }
      : level === 'edit'
        ? {
            label: t('consent.access.edit.label'),
            description: t('consent.access.edit.description'),
          }
        : {
            label: t('consent.access.deploy.label'),
            description: t('consent.access.deploy.description'),
          };

  const extraWords = (extra: ExtraScope) =>
    extra === 'tale:settings.read'
      ? {
          label: t('consent.extras.settingsRead'),
          description: t('consent.extras.settingsReadDescription'),
        }
      : {
          label: t('consent.extras.settingsWrite'),
          description: t('consent.extras.settingsWriteDescription'),
        };

  const describe = (description: string, why: Unavailable | null) =>
    why === null ? (
      description
    ) : (
      <>
        {description}
        <span className="mt-0.5 block">{reason(why)}</span>
      </>
    );

  const levelOption = (level: AccessLevel) => {
    const why = levelAvailability(level, offer);
    const words = levelWords(level);
    return {
      value: level,
      label: words.label,
      disabled: why !== null,
      description: describe(words.description, why),
    };
  };

  const extraOptions = EXTRA_SCOPES.map((extra) => {
    const why = extraAvailability(extra, offer);
    // Reading settings is locked on while changing them is allowed.
    const locked =
      extra === 'tale:settings.read' &&
      choice.extras.has('tale:settings.write');
    const words = extraWords(extra);
    return {
      value: extra,
      label: words.label,
      disabled: why !== null || locked,
      description: describe(words.description, why),
    };
  });

  return (
    <>
      <RadioGroup
        columns={1}
        label={t('consent.access.label')}
        value={choice.level}
        disabled={disabled}
        onValueChange={(next) => {
          const level = ACCESS_LEVEL_ORDER.find((entry) => entry === next);
          if (level !== undefined) onChange({ ...choice, level });
        }}
        options={ACCESS_LEVEL_ORDER.map(levelOption)}
      />
      <CheckboxGroup
        columns={1}
        label={t('consent.extras.label')}
        disabled={disabled}
        value={[...choice.extras]}
        onValueChange={(next) => {
          // The checkbox group reports the whole list: apply what differs.
          const wanted = new Set(next);
          let updated = choice;
          for (const extra of EXTRA_SCOPES) {
            if (wanted.has(extra) !== updated.extras.has(extra)) {
              updated = withExtra(updated, extra, wanted.has(extra));
            }
          }
          onChange(updated);
        }}
        options={extraOptions}
      />
    </>
  );
}
