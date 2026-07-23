'use client';

import { Alert } from '@tale/ui/alert';
import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { Text } from '@tale/ui/text';
import { CheckCircle2, Rocket, XCircle } from 'lucide-react';
import { useId, useState } from 'react';

import { useFormatDate } from '@/app/hooks/use-format-date';
import { useT } from '@/lib/i18n/client';

import { useDeployAutomation } from '../hooks/mutations';
import { automationErrorMessage } from '../lib/errors';

/** One row of the immutable version history, as the store reports it. */
export interface AutomationVersionSummary {
  version: number;
  message?: string;
  testsPassed?: boolean;
  createdBy: string;
  createdAt: number;
}

/**
 * The automation's version history, and the one act that makes a version live.
 *
 * Versions are immutable, so this list is a real history rather than a log of
 * edits: every entry is a document that can still be read, run, and deployed.
 * Exactly one is live at a time and it is marked as such.
 *
 * The deploy gate is the reason the refusal is shown verbatim: the store
 * refuses to promote a version that was saved with failing tests, and its
 * message names the version and the fix. Replacing that with "deploy failed"
 * would delete the only sentence that tells the author what to do.
 */
export function VersionList({
  organizationId,
  name,
  versions,
  deployedVersion,
  selectedVersion,
  onSelectVersion,
}: {
  organizationId: string;
  name: string;
  versions: readonly AutomationVersionSummary[];
  deployedVersion: number | undefined;
  selectedVersion: number | undefined;
  onSelectVersion: (version: number) => void;
}) {
  const { t } = useT('automations');
  const { formatDate } = useFormatDate();
  const headingId = useId();
  const deploy = useDeployAutomation();
  const [refusal, setRefusal] = useState<string | null>(null);

  const ordered = [...versions].sort((a, b) => b.version - a.version);

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h3 id={headingId} className="text-sm font-semibold">
        {t('versions.title')}
      </h3>

      {refusal !== null && (
        <Alert
          variant="destructive"
          icon={XCircle}
          title={t('versions.deployRefused')}
          description={refusal}
        />
      )}

      {ordered.length === 0 ? (
        <Text as="p" variant="muted" className="text-sm">
          {t('versions.empty')}
        </Text>
      ) : (
        <ul className="flex flex-col gap-2">
          {ordered.map((entry) => {
            const isDeployed = entry.version === deployedVersion;
            const isSelected = entry.version === selectedVersion;
            return (
              <li
                key={entry.version}
                className="border-border bg-card flex flex-wrap items-center gap-2 rounded-md border p-3"
              >
                <Button
                  variant="ghost"
                  size="sm"
                  aria-current={isSelected ? 'true' : undefined}
                  onClick={() => {
                    onSelectVersion(entry.version);
                  }}
                >
                  {t('versions.versionLabel', { version: entry.version })}
                </Button>
                {isDeployed && (
                  <Badge variant="green" icon={CheckCircle2}>
                    {t('versions.deployed')}
                  </Badge>
                )}
                {entry.testsPassed === false && (
                  <Badge variant="destructive" icon={XCircle}>
                    {t('versions.testsFailed')}
                  </Badge>
                )}
                {entry.testsPassed === true && (
                  <Badge variant="green">{t('versions.testsPassed')}</Badge>
                )}
                <span className="min-w-0 flex-1 truncate text-sm">
                  {entry.message ?? t('versions.noMessage')}
                </span>
                <Text as="span" variant="muted" className="text-xs">
                  {formatDate(new Date(entry.createdAt), 'long')}
                </Text>
                {!isDeployed && (
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={Rocket}
                    isLoading={
                      deploy.isPending &&
                      deploy.variables?.version === entry.version
                    }
                    onClick={() => {
                      setRefusal(null);
                      deploy.mutate(
                        {
                          organizationId,
                          name,
                          version: entry.version,
                        },
                        {
                          onError: (error) => {
                            setRefusal(automationErrorMessage(error));
                          },
                        },
                      );
                    }}
                  >
                    {t('versions.deploy')}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
