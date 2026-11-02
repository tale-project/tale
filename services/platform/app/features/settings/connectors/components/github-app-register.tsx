'use client';

import { Button } from '@tale/ui/button';
import { Input } from '@tale/ui/input';
import { Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { Link2 } from 'lucide-react';
import { useRef, useState, type FormEvent } from 'react';

import { useOrganization } from '@/app/features/organization/hooks/queries';
import { useAbility } from '@/app/hooks/use-ability';
import { useT } from '@/lib/i18n/client';
import { uniqueCredentialName } from '@/lib/shared/utils/credential-name';

import {
  defaultGithubAppName,
  GITHUB_APP_NAME_MAX,
  githubAppRegisterUrl,
  isGithubAppName,
  isGithubLogin,
  leavePageFor,
} from '../connector-github-app';
import type { ConnectorVendor } from '../credential-adapter';
import { useConnectorCredentials } from '../hooks/queries';

/** The longest credential name the credential door takes — the add form's
 * own limit. */
const CREDENTIAL_NAME_MAX = 100;

/** The longest GitHub login. */
const GITHUB_LOGIN_MAX = 39;

interface GithubAppRegisterProps {
  organizationId: string;
  vendor: ConnectorVendor;
}

/**
 * The add dialog's way to a `github-app` credential: the organization
 * registers its own GitHub App on GitHub, from a manifest the deployment
 * builds, and installs it on the repositories it should reach. Nothing is
 * typed into Tale but names — GitHub hands the app's key to the deployment
 * directly — so this is a hand-off like OAuth's Connect, never the
 * credential form.
 *
 * Registering and installing are org-security decisions, as the OAuth apps
 * card's are: the register route refuses everyone but an admin, and a
 * member who is not one reads why instead of a form that would fail.
 */
export function GithubAppRegister({
  organizationId,
  vendor,
}: GithubAppRegisterProps) {
  const { t } = useT('settings');
  const ability = useAbility();
  const canRegister = ability.can('write', 'orgSettings');
  return (
    // A group of its own, as OAuth's Connect is: its fields sit above the
    // token form's and name a different credential.
    <Stack
      gap={3}
      className="border-border rounded-lg border p-4"
      role="group"
      aria-label={t('connectors.githubApp.registerGroup')}
    >
      <Text as="p" variant="muted" className="text-sm">
        {t('connectors.githubApp.intro')}
      </Text>
      {canRegister ? (
        <GithubAppRegisterForm
          organizationId={organizationId}
          vendor={vendor}
        />
      ) : (
        <Text as="p" variant="muted" className="text-sm">
          {t('connectors.githubApp.adminOnly')}
        </Text>
      )}
    </Stack>
  );
}

type RegisterField = 'credentialName' | 'appName' | 'owner';

function GithubAppRegisterForm({
  organizationId,
  vendor,
}: GithubAppRegisterProps) {
  const { t } = useT('settings');
  const organization = useOrganization(organizationId);
  const credentials = useConnectorCredentials(organizationId);

  // The names this connector's credentials hold: the register route refuses
  // one of them (compared trimmed and case-insensitively) only after the
  // browser has left, so the form says it first.
  const takenNames = (credentials.data ?? [])
    .filter((credential) => credential.connectorSlug === vendor.key)
    .map((credential) => credential.name.trim().toLowerCase());

  // Suggested once, as the add form suggests its name: numbered past the
  // names the connector's credentials already hold.
  const [credentialName, setCredentialName] = useState(() =>
    uniqueCredentialName(takenNames, vendor.displayName),
  );
  // `null` until edited: the suggestion follows the organization's name
  // while it loads.
  const [appNameDraft, setAppNameDraft] = useState<string | null>(null);
  const [owner, setOwner] = useState('');
  const [touched, setTouched] = useState<ReadonlySet<RegisterField>>(
    () => new Set(),
  );
  const [attempted, setAttempted] = useState(false);

  const credentialNameRef = useRef<HTMLInputElement>(null);
  const appNameRef = useRef<HTMLInputElement>(null);
  const ownerRef = useRef<HTMLInputElement>(null);

  const appName =
    appNameDraft ??
    defaultGithubAppName(
      organization.isError ? undefined : organization.data?.name,
    );

  const trimmedCredentialName = credentialName.trim();
  const credentialNameError =
    trimmedCredentialName === ''
      ? t('credentials.errors.nameInvalid')
      : takenNames.includes(trimmedCredentialName.toLowerCase())
        ? t('credentials.errors.nameTaken')
        : undefined;
  const appNameError = isGithubAppName(appName)
    ? undefined
    : t('connectors.githubApp.appNameInvalid', { max: GITHUB_APP_NAME_MAX });
  const ownerError =
    owner.trim() === '' || isGithubLogin(owner)
      ? undefined
      : t('connectors.githubApp.ownerInvalid');

  // An error shows once its field was left or a registration was tried —
  // never under the reader's first keystroke.
  const shown = (field: RegisterField, error: string | undefined) =>
    attempted || touched.has(field) ? error : undefined;
  const touch = (field: RegisterField) => () =>
    setTouched((previous) => new Set(previous).add(field));

  const permissions = Object.entries(
    vendor.summary.githubAppPermissions ?? {},
  ).toSorted(([a], [b]) => a.localeCompare(b));

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const firstInvalid =
      credentialNameError !== undefined
        ? credentialNameRef
        : appNameError !== undefined
          ? appNameRef
          : ownerError !== undefined
            ? ownerRef
            : null;
    if (firstInvalid !== null) {
      setAttempted(true);
      firstInvalid.current?.focus();
      return;
    }
    leavePageFor(
      githubAppRegisterUrl({
        organizationId,
        connectorSlug: vendor.key,
        credentialName,
        appName,
        owner,
      }),
    );
  };

  return (
    <form noValidate onSubmit={handleSubmit}>
      <Stack gap={3}>
        <Input
          ref={credentialNameRef}
          label={t('connectors.githubApp.credentialName')}
          description={t('credentials.nameHelp')}
          value={credentialName}
          onChange={(event) => setCredentialName(event.target.value)}
          onBlur={touch('credentialName')}
          errorMessage={shown('credentialName', credentialNameError)}
          maxLength={CREDENTIAL_NAME_MAX}
          autoComplete="off"
          required
        />
        <Input
          ref={appNameRef}
          label={t('connectors.githubApp.appName')}
          value={appName}
          onChange={(event) => setAppNameDraft(event.target.value)}
          onBlur={touch('appName')}
          errorMessage={shown('appName', appNameError)}
          maxLength={GITHUB_APP_NAME_MAX}
          autoComplete="off"
          required
        />
        <Input
          ref={ownerRef}
          label={t('connectors.githubApp.owner')}
          description={t('connectors.githubApp.ownerHint')}
          value={owner}
          onChange={(event) => setOwner(event.target.value)}
          onBlur={touch('owner')}
          errorMessage={shown('owner', ownerError)}
          maxLength={GITHUB_LOGIN_MAX}
          autoComplete="off"
          spellCheck={false}
        />
        {permissions.length > 0 && (
          <div className="flex flex-col gap-1">
            <Text as="p" variant="muted" className="text-sm">
              {t('connectors.githubApp.permissionsIntro')}
            </Text>
            <dl className="text-sm">
              {permissions.map(([permission, access]) => (
                <div key={permission} className="flex gap-2">
                  <dt>
                    <code className="font-mono text-xs">{permission}</code>
                  </dt>
                  <dd className="text-muted-foreground">
                    {access === 'write'
                      ? t('connectors.githubApp.permissionWrite')
                      : t('connectors.githubApp.permissionRead')}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        )}
        <div>
          <Button type="submit" size="sm" icon={Link2}>
            {t('connectors.githubApp.register')}
          </Button>
        </div>
      </Stack>
    </form>
  );
}
