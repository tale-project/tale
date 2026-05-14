'use client';

import { Accordion } from '@tale/ui/markdown/components/accordion';
import { Spinner } from '@tale/ui/spinner';
import { createFileRoute } from '@tanstack/react-router';
import { useAction } from 'convex/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { z } from 'zod';

import { VStack } from '@/app/components/ui/layout/layout';
import { Text } from '@/app/components/ui/typography/text';
import { useChangelogNotification } from '@/app/hooks/use-changelog-notification';
import { useLocale } from '@/app/hooks/use-locale';
import { api } from '@/convex/_generated/api';
import { compareVersions, filterReleasesInRange } from '@/lib/compare-versions';
import { useT } from '@/lib/i18n/client';
import { seo } from '@/lib/utils/seo';

const GITHUB_RELEASES_LIST_URL =
  'https://github.com/tale-project/tale/releases';

const searchSchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
});

export const Route = createFileRoute('/dashboard/changelog')({
  validateSearch: searchSchema,
  head: () => ({ meta: seo('changelog') }),
  component: ChangelogPage,
});

interface Release {
  tag: string;
  version: string;
  name: string | null;
  body: string | null;
  htmlUrl: string;
  publishedAt: string | null;
}

function ChangelogPage() {
  const { t } = useT('changelog');
  const { from, to } = Route.useSearch();
  const { currentVersion, lastSeenVersion, markSeen } =
    useChangelogNotification();
  const { locale } = useLocale();
  const listReleases = useAction(api.changelog.actions.listReleases);

  const [releases, setReleases] = useState<Release[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const ranRef = useRef(false);
  const markSeenRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;
    void (async () => {
      try {
        const data = await listReleases({});
        setReleases(data);
      } catch (err) {
        console.error('Failed to load releases:', err);
        setError(err);
      }
    })();
  }, [listReleases]);

  // markSeen as soon as we know the load resolved (success or failure) and
  // currentVersion is known — reaching this page is acknowledgement.
  useEffect(() => {
    if (markSeenRef.current) return;
    if (!currentVersion) return;
    if (releases === null && !error) return;
    markSeenRef.current = true;
    markSeen();
  }, [releases, error, currentVersion, markSeen]);

  const effectiveFrom = from ?? lastSeenVersion;
  const effectiveTo = to ?? currentVersion;

  const visibleReleases = useMemo(() => {
    if (!releases || !effectiveTo) return [];
    return filterReleasesInRange(releases, effectiveFrom, effectiveTo);
  }, [releases, effectiveFrom, effectiveTo]);

  // The atom feed caps at the 10 most recent releases. Compare the feed's
  // OLDEST entry (not the filtered subset's) against `from` — if even the
  // oldest in the feed is newer than `from`, there are missing versions
  // older than the feed window. Filtering can shave the result down to
  // `from+1..to`, so checking the filtered min would false-positive.
  const isTruncated = useMemo(() => {
    if (!effectiveFrom || !releases || releases.length === 0) return false;
    let oldestInFeed = releases[0].version;
    for (const r of releases) {
      try {
        if (compareVersions(r.version, oldestInFeed) < 0) {
          oldestInFeed = r.version;
        }
      } catch {
        // skip unparseable
      }
    }
    try {
      return compareVersions(oldestInFeed, effectiveFrom) > 0;
    } catch {
      return false;
    }
  }, [releases, effectiveFrom]);

  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      }),
    [locale],
  );

  if (releases === null && !error) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <VStack gap={4}>
          <h1 className="text-fg-base text-2xl font-semibold">
            {t('viewer.heading')}
          </h1>
          <Text variant="muted">{t('viewer.error')}</Text>
          <a
            href={GITHUB_RELEASES_LIST_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-fg-base hover:text-fg-muted text-sm underline underline-offset-2"
          >
            {t('viewer.githubLink')}
          </a>
        </VStack>
      </div>
    );
  }

  const count = visibleReleases.length;
  const showRange = effectiveFrom && count > 0;
  const subheading = isTruncated
    ? t('viewer.subheadingTruncated', { count, from: effectiveFrom })
    : showRange
      ? t('viewer.subheading', { count, from: effectiveFrom })
      : effectiveTo
        ? t('viewer.subheadingNew', { to: effectiveTo })
        : null;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-4 py-10">
        <VStack gap={2} className="mb-6">
          <h1 className="text-fg-base text-2xl font-semibold">
            {t('viewer.heading')}
          </h1>
          <Text variant="muted">{subheading}</Text>
        </VStack>

        {count === 0 ? (
          <Text variant="muted">{t('viewer.upToDate')}</Text>
        ) : (
          <div className="flex flex-col gap-2">
            {visibleReleases.map((release, i) => {
              const formattedDate = release.publishedAt
                ? dateFormatter.format(new Date(release.publishedAt))
                : '';
              const title = formattedDate
                ? `${release.tag} — ${formattedDate}`
                : release.tag;
              return (
                <Accordion
                  key={release.tag}
                  title={title}
                  defaultOpen={i === 0}
                >
                  <VStack gap={3}>
                    {release.body ? (
                      <div
                        className="prose prose-sm dark:prose-invert max-w-none"
                        // Atom `<content type="html">` is pre-rendered & sanitized
                        // by GitHub. Trust their output for release notes.
                        // eslint-disable-next-line react/no-danger
                        dangerouslySetInnerHTML={{ __html: release.body }}
                      />
                    ) : (
                      <Text variant="muted">{t('viewer.empty')}</Text>
                    )}
                    <a
                      href={release.htmlUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-fg-base hover:text-fg-muted text-xs underline underline-offset-2"
                    >
                      {t('viewer.viewOnGitHub')}
                    </a>
                  </VStack>
                </Accordion>
              );
            })}
          </div>
        )}

        <div className="border-border-base mt-8 border-t pt-4">
          <a
            href={GITHUB_RELEASES_LIST_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-fg-muted hover:text-fg-base text-sm underline underline-offset-2"
          >
            {t('viewer.viewAllOnGitHub')}
          </a>
        </div>
      </div>
    </div>
  );
}
