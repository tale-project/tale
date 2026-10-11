'use client';

import { Button } from '@tale/ui/button';
import { Dialog } from '@tale/ui/dialog/dialog';
import { useLocale } from '@tale/ui/i18n/locale-provider';
import { type IssueItem, IssueList } from '@tale/ui/issue-list';
import { Text } from '@tale/ui/text';
import { Link } from '@tanstack/react-router';
import { useMemo } from 'react';

import { useT } from '@/lib/i18n/client';
import type { WireAutomationIssue } from '@/lib/shared/schemas/automation-issues';

import type { DeployRefusal } from '../../hooks/use-deploy-version';
import { editorVersionLink } from '../../lib/detail-paths';
import { type IssueTextContext, issueText } from '../../lib/issue-text';
import { withIssueIds } from '../../lib/issues';

/** A refusal's problems as the issue list reads them: the localized
 * sentences, the code, and the engine's own words as technical detail. */
export function refusalIssueItems(
  issues: readonly WireAutomationIssue[],
  ctx: IssueTextContext,
): IssueItem[] {
  return withIssueIds(issues).map((issue) => {
    const text = issueText(issue, ctx);
    const item: IssueItem = {
      id: issue.id,
      severity: issue.level,
      title: text.title,
      explanation: text.explanation,
      code: issue.code,
    };
    if (text.cause !== '') item.cause = text.cause;
    if (text.fix !== '') item.fix = text.fix;
    if (issue.message !== '') item.technical = issue.message;
    return item;
  });
}

/**
 * Says why a version cannot go live: it no longer passes today's checks —
 * with the problems they found — or its tests fail. **Open vN in the
 * editor** is where either is fixed; the version itself never changes.
 */
export function DeployRefusedDialog({
  organizationId,
  automationSlug,
  projectId,
  refusal,
  onClose,
}: {
  organizationId: string;
  automationSlug: string;
  projectId?: string | undefined;
  refusal: DeployRefusal | null;
  onClose: () => void;
}) {
  const { t } = useT('automations');
  const { t: tCommon } = useT('common');
  const { locale } = useLocale();
  const items = useMemo(
    () =>
      refusal?.kind === 'invalid'
        ? refusalIssueItems(refusal.issues, { locale, t })
        : [],
    [refusal, locale, t],
  );
  if (refusal === null) return null;
  const version = refusal.version;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t('deploy.refused.title', { version })}
      size="md"
      {...(refusal.returnFocus !== undefined && {
        restoreFocusRef: refusal.returnFocus,
      })}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {tCommon('actions.close')}
          </Button>
          <Button asChild>
            <Link
              {...editorVersionLink({
                organizationId,
                automationSlug,
                projectId,
                version,
              })}
            >
              {t('deploy.refused.openInEditor', { version })}
            </Link>
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Text>
          {refusal.kind === 'invalid'
            ? t('deploy.refused.invalid', { version })
            : t('deploy.refused.testsFailing', { version })}
        </Text>
        {items.length > 0 && (
          <IssueList
            issues={items}
            density="compact"
            aria-label={t('deploy.refused.title', { version })}
          />
        )}
      </div>
    </Dialog>
  );
}
