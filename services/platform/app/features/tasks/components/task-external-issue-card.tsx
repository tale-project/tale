'use client';

import {
  isPullRequestUrl,
  taskExternalIssueSchema,
} from '@tale/shared/schemas/task-external-issue';
import { Alert } from '@tale/ui/alert';
import { Badge } from '@tale/ui/badge';
import { Card } from '@tale/ui/card';
import { ExternalLink } from '@tale/ui/external-link';
import { Text } from '@tale/ui/text';
import { useFormatDate } from '@tale/ui/use-format-date';

import { useT } from '@/lib/i18n/client';
import { isHttpUrl } from '@/lib/utils/url';

/** The tracker each issue-sync system is shown as — a brand name, the same
 * in every language. */
const PROVIDERS: Record<string, string> = {
  github: 'GitHub',
  'github-security': 'GitHub',
  forgejo: 'Forgejo',
  glitchtip: 'GlitchTip',
};

/** The external snapshot has its own identity and state. It is evidence for
 * the task, never an instruction to replace a person's title or status. */
export function TaskExternalIssueCard({
  externalSystem,
  externalId,
  externalUrl,
  externalIssue,
}: {
  externalSystem?: string;
  externalId?: string;
  externalUrl?: string;
  externalIssue?: unknown;
}) {
  const { t } = useT('tasks');
  const { formatDate } = useFormatDate();
  const provider =
    externalSystem !== undefined && Object.hasOwn(PROVIDERS, externalSystem)
      ? PROVIDERS[externalSystem]
      : undefined;
  if (provider === undefined) return null;
  const parsed = taskExternalIssueSchema.safeParse(externalIssue);
  const issue = parsed.success ? parsed.data : null;
  const url = issue?.url ?? externalUrl;
  if (url === undefined || !isHttpUrl(url)) return null;
  const title = issue?.title ?? externalId ?? provider;
  // What the source is: a security alert, a pull request, or an issue.
  const heading =
    externalSystem === 'github-security'
      ? t('sourceIssue.headingAlert', { provider })
      : isPullRequestUrl(url)
        ? t('sourceIssue.headingPull', { provider })
        : t('sourceIssue.heading', { provider });
  return (
    <Card asChild padding="md">
      <section aria-label={heading} className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Text as="h3" variant="label">
            {heading}
          </Text>
          {issue && (
            <Badge variant={issue.state === 'open' ? 'blue' : 'slate'}>
              {t(`sourceIssue.state.${issue.state}`)}
            </Badge>
          )}
        </div>
        <ExternalLink
          href={url}
          className="text-primary max-w-full text-sm font-medium break-words whitespace-normal!"
        >
          {title}
        </ExternalLink>
        {externalId && externalId !== title && (
          <Text as="p" variant="muted" className="text-xs break-all">
            {externalId}
          </Text>
        )}
        {issue?.unavailable && (
          <Alert variant="warning" description={t('sourceIssue.unavailable')} />
        )}
        {issue && (
          <>
            <Text as="p" variant="muted" className="text-xs">
              {t('sourceIssue.synced', {
                date: formatDate(new Date(issue.syncedAt), 'long'),
              })}
            </Text>
            <Text as="p" variant="muted" className="text-xs">
              {t('sourceIssue.independentStatus')}
            </Text>
            {issue.description && (
              <details className="text-sm">
                <summary className="cursor-pointer rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2">
                  {t('sourceIssue.description')}
                </summary>
                <p className="mt-2 max-h-64 overflow-y-auto break-words whitespace-pre-wrap">
                  {issue.description}
                </p>
              </details>
            )}
          </>
        )}
      </section>
    </Card>
  );
}
