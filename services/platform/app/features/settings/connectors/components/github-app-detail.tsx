'use client';

import { Alert } from '@tale/ui/alert';
import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { CatalogLoadError } from '@tale/ui/catalog/catalog-view';
import { Dialog } from '@tale/ui/dialog/dialog';
import { ExternalLink } from '@tale/ui/external-link';
import { Stack } from '@tale/ui/layout';
import { SkeletonText } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Text } from '@tale/ui/text';
import { Download, FolderGit2 } from 'lucide-react';
import { useState } from 'react';

import { useAbility } from '@/app/hooks/use-ability';
import { useOrganizationId } from '@/app/hooks/use-organization-id';
import type { GithubAppSummary } from '@/app/lib/backend/contract/connector-credentials';
import { useT } from '@/lib/i18n/client';
import { backendErrorCode } from '@/lib/utils/backend-error';
import { isHttpUrl } from '@/lib/utils/url';

import { connectorFailureDetail } from '../connector-error';
import {
  githubAppInstallUrl,
  githubAppPageUrl,
  leavePageFor,
} from '../connector-github-app';
import type { ConnectorVendor } from '../credential-adapter';
import type { MaskedConnectorCredential } from '../hooks/backend';
import { useGithubAppRepositories } from '../hooks/github-app';

/** A link inside a line of muted text: told apart by more than its color. */
const INLINE_LINK = 'text-foreground font-medium underline underline-offset-2';

interface GithubAppDetailProps {
  credential: MaskedConnectorCredential;
  app: GithubAppSummary;
  vendor: ConnectorVendor | null;
}

/**
 * The row's line under a `github-app` credential: the app on GitHub, where
 * it is installed, and — once it is — the repositories it reaches, behind a
 * dialog because GitHub is asked for them live.
 *
 * Phrasing content only: the table renders the line inside a paragraph (the
 * dialog itself is portaled out of it).
 */
export function GithubAppDetail({
  credential,
  app,
  vendor,
}: GithubAppDetailProps) {
  const { t } = useT('settings');
  const organizationId = useOrganizationId();
  const [open, setOpen] = useState(false);
  const installation = app.installation;
  // `needs-reauth` is all a GitHub App credential reports for an app that
  // is not installed: never yet, or no longer when an installation is kept.
  const uninstalled = credential.status === 'needs-reauth';
  const where =
    installation === undefined
      ? t('connectors.githubApp.notInstalled')
      : uninstalled
        ? t('connectors.githubApp.uninstalled', {
            account: installation.account,
          })
        : t('connectors.githubApp.installedOn', {
            account: installation.account,
          });
  // The listing refuses a disabled credential and an uninstalled app, so
  // only an active, installed one offers it. An open dialog stays when the
  // credential changes under it — the read itself is what finds an app
  // uninstalled on GitHub — and says where the app stands now; closed, it
  // leaves the focus to the table, which keeps it in the row.
  const offered = installation !== undefined && credential.status === 'active';
  return (
    <>
      <ExternalLink href={githubAppPageUrl(app.slug)} className={INLINE_LINK}>
        {t('connectors.githubApp.appLink', { slug: app.slug })}
      </ExternalLink>
      {' · '}
      {where}
      {installation !== undefined &&
        organizationId !== undefined &&
        (offered || open) && (
          <>
            {offered && ' · '}
            <GithubAppRepositoriesDialog
              open={open}
              onOpenChange={setOpen}
              organizationId={organizationId}
              credentialId={credential.id}
              where={where}
              uninstalled={uninstalled}
              offered={offered}
              vendor={vendor}
            />
          </>
        )}
    </>
  );
}

function GithubAppRepositoriesDialog({
  open,
  onOpenChange,
  organizationId,
  credentialId,
  where,
  uninstalled,
  offered,
  vendor,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  credentialId: string;
  /** Where the app is installed, as the row says it. */
  where: string;
  uninstalled: boolean;
  /** Whether the row still offers the list; its button goes when not. */
  offered: boolean;
  vendor: ConnectorVendor | null;
}) {
  const { t } = useT('settings');
  const ability = useAbility();
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={t('connectors.githubApp.repositoriesTitle')}
      description={where}
      trigger={
        offered ? (
          <button
            type="button"
            className={`${INLINE_LINK} focus-visible:ring-ring cursor-pointer rounded-sm focus-visible:ring-1 focus-visible:outline-none`}
          >
            {t('connectors.githubApp.showRepositories')}
          </button>
        ) : undefined
      }
      // Choosing the repositories is the installation's business on GitHub,
      // which only an admin may send the browser to; the same route installs
      // an app that is no longer installed, as the row's menu does.
      footer={
        ability.can('write', 'orgSettings') ? (
          <Button
            icon={uninstalled ? Download : FolderGit2}
            onClick={() =>
              leavePageFor(githubAppInstallUrl(organizationId, credentialId))
            }
          >
            {uninstalled
              ? t('connectors.githubApp.install')
              : t('connectors.githubApp.changeRepositories')}
          </Button>
        ) : undefined
      }
    >
      <GithubAppRepositoryList
        organizationId={organizationId}
        credentialId={credentialId}
        vendor={vendor}
      />
    </Dialog>
  );
}

function GithubAppRepositoryList({
  organizationId,
  credentialId,
  vendor,
}: {
  organizationId: string;
  credentialId: string;
  vendor: ConnectorVendor | null;
}) {
  const { t } = useT('settings');
  const query = useGithubAppRepositories(organizationId, credentialId);

  if (query.isPending) {
    return (
      <Skeletonize loading>
        <SkeletonText lines={3} />
      </Skeletonize>
    );
  }

  if (query.isError) {
    // A disabled credential and an app no longer installed are refused with
    // words that speak of defaults and of reconnecting, which a GitHub App
    // has neither of; the dialog's description and the row say where the
    // app stands.
    const code = backendErrorCode(query.error);
    const detail =
      code === 'CREDENTIAL_DISABLED' || code === 'CREDENTIAL_NEEDS_REAUTH'
        ? undefined
        : connectorFailureDetail(query.error, vendor);
    const failed = t('connectors.githubApp.repositoriesLoadFailed');
    return (
      <CatalogLoadError
        message={detail === undefined ? failed : `${failed} ${detail}`}
        onRetry={() => void query.refetch()}
        isRetrying={query.isFetching}
      />
    );
  }

  const listing = query.data;
  const more = listing.truncated
    ? listing.totalCount - listing.repositories.length
    : 0;
  return (
    <Stack gap={3}>
      {listing.repositorySelection === 'all' && (
        <Alert
          variant="warning"
          live="off"
          description={
            <>
              {t('connectors.githubApp.allRepositoriesWarning', {
                account: listing.account,
              })}
              {isHttpUrl(listing.configureUrl) && (
                <>
                  {' '}
                  <ExternalLink
                    href={listing.configureUrl}
                    className={INLINE_LINK}
                  >
                    {t('connectors.githubApp.openOnGitHub')}
                  </ExternalLink>
                </>
              )}
            </>
          }
        />
      )}
      {listing.repositories.length === 0 ? (
        <Text as="p" variant="muted" className="text-sm">
          {t('connectors.githubApp.noRepositories')}
        </Text>
      ) : (
        <ul
          aria-label={t('connectors.githubApp.repositoriesTitle')}
          className="flex flex-col gap-2"
        >
          {listing.repositories.map((repository) => (
            <li
              key={repository.fullName}
              className="flex min-w-0 items-center gap-2 text-sm"
            >
              {isHttpUrl(repository.htmlUrl) ? (
                <ExternalLink
                  href={repository.htmlUrl}
                  className="text-foreground min-w-0 font-medium break-all underline-offset-2 hover:underline"
                >
                  {repository.fullName}
                </ExternalLink>
              ) : (
                <span className="min-w-0 font-medium break-all">
                  {repository.fullName}
                </span>
              )}
              {repository.private && (
                <Badge variant="outline" className="shrink-0">
                  {t('connectors.githubApp.private')}
                </Badge>
              )}
            </li>
          ))}
        </ul>
      )}
      {more > 0 && (
        <Text as="p" variant="muted" className="text-sm">
          {t('connectors.githubApp.more', { count: more })}
        </Text>
      )}
    </Stack>
  );
}
