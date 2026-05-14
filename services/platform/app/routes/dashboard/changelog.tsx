'use client';

import { Accordion } from '@tale/ui/markdown/components/accordion';
import { Spinner } from '@tale/ui/spinner';
import { createFileRoute } from '@tanstack/react-router';
import { useAction } from 'convex/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { z } from 'zod';

import { VStack } from '@/app/components/ui/layout/layout';
import { Text } from '@/app/components/ui/typography/text';
import { ReleaseBody } from '@/app/features/changelog/components/release-body';
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
  const { currentVersion, lastSeenVersion, stateLoaded, markSeen } =
    useChangelogNotification();
  const { locale } = useLocale();
  const listReleases = useAction(api.changelog.actions.listReleases);

  const [releases, setReleases] = useState<Release[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const ranRef = useRef(false);
  const markSeenRef = useRef(false);

  const fromForFetch = from ?? lastSeenVersion;

  useEffect(() => {
    if (ranRef.current) return;
    // Wait until the notification-state query has resolved so we know
    // whether there's a real `lastSeenVersion` to chase before paging the
    // feed. Skip the wait when `currentVersion` is undefined (env unset)
    // since the hook's query is `skip`-ed and `stateLoaded` will never
    // flip — without this guard the page would spin forever in dev. If
    // the route was visited with `?from=` we can fetch right away.
    if (currentVersion !== undefined && from === undefined && !stateLoaded) {
      return;
    }
    ranRef.current = true;
    void (async () => {
      try {
        const data = await listReleases(
          fromForFetch ? { from: fromForFetch } : {},
        );
        setReleases(data);
      } catch (err) {
        console.error('Failed to load releases:', err);
        setError(err);
      }
    })();
  }, [listReleases, fromForFetch, from, stateLoaded, currentVersion]);

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

  // The HTML feed is paginated 10 per page and we cap at 3 pages (30 most
  // recent). Compare the feed's OLDEST entry against `from` — if even the
  // oldest is newer than `from`, the user is more than 30 releases behind
  // and we can't fully cover the range. Falls back to "see on GitHub".
  const isTruncated = useMemo(() => {
    if (!effectiveFrom || !releases || releases.length === 0) return false;
    let oldestInFeed = releases[0].version;
    for (const r of releases) {
      try {
        if (compareVersions(r.version, oldestInFeed) < 0) {
          oldestInFeed = r.version;
        }
      } catch (err) {
        console.warn(`changelog: unparseable version ${r.version}`, err);
      }
    }
    try {
      return compareVersions(oldestInFeed, effectiveFrom) > 0;
    } catch (err) {
      console.warn(
        `changelog: isTruncated compare failed (oldest=${oldestInFeed}, from=${effectiveFrom})`,
        err,
      );
      return false;
    }
  }, [releases, effectiveFrom]);

  // The viewer was opened with a `to` (either explicit `?to=` or the
  // deployment's `currentVersion`) that does not appear in the fetched
  // feed. Typical cause: tag for the just-deployed version hasn't been
  // pushed to GitHub yet, or the URL has a typo. We render a dedicated
  // card instead of the misleading "up to date" message.
  const toMissing = useMemo(() => {
    if (!effectiveTo || !releases || releases.length === 0) return false;
    try {
      return !releases.some(
        (r) => compareVersions(r.version, effectiveTo) === 0,
      );
    } catch (err) {
      console.warn(
        `changelog: toMissing check failed (to=${effectiveTo})`,
        err,
      );
      return false;
    }
  }, [releases, effectiveTo]);

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
  // tooOld = the entire requested range falls before our 30-release window.
  // Almost never hits in production but possible for very stale deployments.
  const tooOld = isTruncated && count === 0;
  // toUnpublished = the requested `to` version isn't in the feed and we
  // rendered nothing — distinct UX from "up to date".
  const toUnpublished = toMissing && count === 0 && !tooOld;
  const subheading = tooOld
    ? t('viewer.subheadingTooOld', {
        from: effectiveFrom ?? '',
        to: effectiveTo ?? '',
      })
    : toUnpublished
      ? t('viewer.subheadingToUnpublished', { to: effectiveTo ?? '' })
      : isTruncated
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

        {tooOld ? (
          <div className="border-border-base bg-bg-elevated/40 rounded-lg border p-6">
            <VStack gap={3} align="start">
              <Text variant="muted" className="text-sm">
                {t('viewer.tooOldExplain')}
              </Text>
              <a
                href={GITHUB_RELEASES_LIST_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="bg-foreground text-background inline-flex items-center rounded-md px-3 py-2 text-sm font-medium transition-colors hover:opacity-90"
              >
                {t('viewer.openOnGitHub')}
              </a>
            </VStack>
          </div>
        ) : toUnpublished ? (
          <div className="border-border-base bg-bg-elevated/40 rounded-lg border p-6">
            <VStack gap={3} align="start">
              <Text variant="muted" className="text-sm">
                {t('viewer.toUnpublishedExplain')}
              </Text>
              <a
                href={GITHUB_RELEASES_LIST_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="bg-foreground text-background inline-flex items-center rounded-md px-3 py-2 text-sm font-medium transition-colors hover:opacity-90"
              >
                {t('viewer.openOnGitHub')}
              </a>
            </VStack>
          </div>
        ) : count === 0 ? (
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
                      <ReleaseBody html={release.body} />
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
