import {
  buildBreadcrumbListJsonLd,
  buildItemListJsonLd,
} from '@tale/ui/seo/builders/json-ld';
import { useEffect, useMemo, useRef, useState } from 'react';

import { ReleaseBody } from '@/app/components/blocks/changelog/release-body';
import { useActiveRelease } from '@/app/components/blocks/changelog/use-active-release';
import { useLiveReleases } from '@/app/components/blocks/changelog/use-live-releases';
import { FeatureCta } from '@/app/components/blocks/feature';
import { SiteContainer } from '@/app/components/layout/site-container';
import {
  MarketingExternalLink,
  MarketingStack,
  PageSection,
  Reveal,
  SectionHeading,
} from '@/app/components/marketing';
import {
  RELEASES,
  RELEASES_FETCHED_AT,
} from '@/app/generated/releases-manifest';
import { EXTERNAL_LINKS } from '@/lib/external-links';
import { useT } from '@/lib/i18n/client';
import { useCurrentLocale } from '@/lib/i18n/use-current-locale';
import {
  formatReleaseDate,
  groupReleasesByMonth,
  releaseDayOfMonth,
} from '@/lib/releases/group-by-month';
import type { Release } from '@/lib/releases/types';
import { absoluteLocalizedUrl } from '@/lib/seo/absolute-url';
import { useDocumentMeta } from '@/lib/seo/use-document-meta';

const DISPLAY_LIMIT = 40;

/**
 * How many release bodies the prerendered HTML carries. Rendering all 40
 * put ~250 KB of GitHub release notes into `dist/changelog/index.html`,
 * and it grew with every release; Ahrefs flags the page as slow. The rest
 * mount on hydration from `RELEASES`, which the JS bundle already ships,
 * so a visitor sees the same page.
 */
const PRERENDERED_BODY_COUNT = 12;

/** True when the GitHub release name is more than a version restatement. */
function distinctiveReleaseName(release: Release): string | null {
  const name = release.name?.trim();
  if (!name) return null;
  const normalized = name.toLowerCase();
  const version = release.version.toLowerCase();
  if (
    normalized === version ||
    normalized === `v${version}` ||
    normalized === `tale v${version}` ||
    normalized === `tale ${version}`
  ) {
    return null;
  }
  return name;
}

/**
 * Public changelog — Multica-style sticky month timeline + release stream.
 * Renders the build-time snapshot of GitHub Releases (same source as the
 * platform `/dashboard/changelog` viewer), then swaps in the server's live
 * feed once it arrives — see `use-live-releases`.
 */
export function ChangelogPage() {
  const { t } = useT('changelogPage');
  const { t: tSeo } = useT('seo');
  const locale = useCurrentLocale();
  const desktopNavRef = useRef<HTMLElement>(null);
  const mobileNavRef = useRef<HTMLElement>(null);

  const feed = useLiveReleases({
    releases: RELEASES,
    fetchedAt: RELEASES_FETCHED_AT,
  });
  const releases = useMemo(
    () => feed.releases.slice(0, DISPLAY_LIMIT) as Release[],
    [feed.releases],
  );

  // False for the prerendered HTML and for the first client render (so
  // hydration matches), then true for every render after mount.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setHydrated(true);
  }, []);

  const tags = useMemo(() => releases.map((r) => r.tag), [releases]);
  const activeTag = useActiveRelease(tags);

  const groups = useMemo(
    () =>
      groupReleasesByMonth(releases, (year, monthIndex0) =>
        new Intl.DateTimeFormat(locale, {
          month: 'long',
          year: 'numeric',
          timeZone: 'UTC',
        }).format(new Date(Date.UTC(year, monthIndex0, 1))),
      ),
    [locale, releases],
  );

  // Keep the active timeline row visible inside the scrollable sticky nav.
  useEffect(() => {
    if (!activeTag) return;
    const selector = `a[href="#${CSS.escape(activeTag)}"]`;
    for (const nav of [desktopNavRef.current, mobileNavRef.current]) {
      nav?.querySelector<HTMLAnchorElement>(selector)?.scrollIntoView({
        block: 'nearest',
        inline: 'nearest',
        behavior: 'smooth',
      });
    }
  }, [activeTag]);

  const jsonLd = useMemo(
    () => [
      buildBreadcrumbListJsonLd([
        { name: 'Tale', url: absoluteLocalizedUrl(locale, '/') },
        { name: t('title'), url: absoluteLocalizedUrl(locale, '/changelog') },
      ]),
      buildItemListJsonLd(
        releases.map((release) => ({
          name: release.name ?? `v${release.version}`,
          url: release.htmlUrl,
          datePublished: release.publishedAt ?? undefined,
        })),
        { name: t('title') },
      ),
    ],
    [locale, releases, t],
  );

  useDocumentMeta({
    title: tSeo('changelog.title'),
    description: tSeo('changelog.description'),
    path: '/changelog',
    jsonLd,
  });

  const releaseStream = (
    <div className="flex min-w-0 flex-col">
      {releases.map((release, index) => {
        const title = distinctiveReleaseName(release);
        const article = (
          <article
            id={release.tag}
            className="border-border-base/70 scroll-mt-28 border-b py-10 last:border-b-0 md:scroll-mt-32 md:py-12"
          >
            {title ? (
              <>
                <div className="text-fg-subtle mb-3 flex flex-wrap items-center gap-2 text-sm">
                  <span className="border-border-base/80 bg-surface-site-inset text-fg-base inline-flex items-center rounded-full border px-2.5 py-0.5 font-medium tabular-nums">
                    v{release.version}
                  </span>
                  <time dateTime={release.publishedAt ?? undefined}>
                    {formatReleaseDate(release.publishedAt, locale)}
                  </time>
                </div>
                <h2
                  className="text-fg-base text-2xl font-normal tracking-[-0.03em] md:text-3xl"
                  style={{ lineHeight: 1.2 }}
                >
                  {title}
                </h2>
              </>
            ) : (
              <h2 className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="text-fg-base text-2xl font-normal tracking-[-0.03em] tabular-nums md:text-3xl">
                  v{release.version}
                </span>
                <time
                  className="text-fg-subtle text-sm font-normal"
                  dateTime={release.publishedAt ?? undefined}
                >
                  {formatReleaseDate(release.publishedAt, locale)}
                </time>
              </h2>
            )}
            {release.body ? (
              hydrated || index < PRERENDERED_BODY_COUNT ? (
                <div className="mt-5">
                  <ReleaseBody markdown={release.body} />
                </div>
              ) : null
            ) : (
              <p className="text-fg-muted mt-4 text-sm">{t('emptyBody')}</p>
            )}
            <p className="mt-6">
              <MarketingExternalLink href={release.htmlUrl} tone="subtle">
                {t('viewOnGithub')}
              </MarketingExternalLink>
            </p>
          </article>
        );

        if (index < 5) {
          return (
            <Reveal key={release.tag} delay={Math.min(index, 4) * 0.03}>
              {article}
            </Reveal>
          );
        }
        return <div key={release.tag}>{article}</div>;
      })}

      <p className="text-fg-subtle pt-6 text-xs">
        {t('fetchedAt', {
          date: formatReleaseDate(feed.fetchedAt, locale),
        })}
      </p>
    </div>
  );

  return (
    <>
      <PageSection pad="xl" border="b" className="relative overflow-hidden">
        <MarketingStack max="md" gap="md" className="relative">
          <SectionHeading
            size="display"
            eyebrow={t('eyebrow')}
            title={t('title')}
            description={t('description')}
          />
          <p className="text-fg-subtle text-center text-sm">
            {t('sourceNote')}{' '}
            <MarketingExternalLink
              href={EXTERNAL_LINKS.githubReleases}
              tone="subtle"
            >
              {t('githubLink')}
            </MarketingExternalLink>
            .
          </p>
        </MarketingStack>
      </PageSection>

      {/* Mobile: compact sticky chip scroller (not a tall vertical timeline). */}
      <div className="border-border-base/70 bg-surface-site/95 sticky top-14 z-20 border-b backdrop-blur-sm lg:hidden">
        <SiteContainer>
          <nav
            ref={mobileNavRef}
            aria-label={t('allReleases')}
            className="-mx-1 overflow-x-auto overscroll-x-contain px-1 py-3"
          >
            <ul role="list" className="flex w-max items-center gap-1.5">
              {releases.map((release) => {
                const isActive = release.tag === activeTag;
                return (
                  <li key={release.tag}>
                    <a
                      href={`#${release.tag}`}
                      aria-current={isActive ? 'true' : undefined}
                      className={
                        isActive
                          ? 'bg-surface-site-inset text-fg-base border-border-base inline-flex items-center rounded-full border px-3 py-1.5 text-sm font-medium tabular-nums'
                          : 'text-fg-muted hover:text-fg-base hover:bg-surface-site-inset/60 border-border-base/0 inline-flex items-center rounded-full border px-3 py-1.5 text-sm tabular-nums transition-colors'
                      }
                    >
                      v{release.version}
                    </a>
                  </li>
                );
              })}
            </ul>
          </nav>
        </SiteContainer>
      </div>

      <PageSection pad="lg" border="none" surface="site">
        <div className="mx-auto grid w-full max-w-6xl gap-10 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-16">
          {/* Desktop sticky timeline — quiet rail, no raised card. */}
          <aside className="hidden lg:sticky lg:top-24 lg:block lg:max-h-[calc(100dvh-7rem)] lg:self-start lg:overflow-y-auto lg:overscroll-contain">
            <p className="text-fg-subtle mb-4 text-[11px] font-medium tracking-[0.08em] uppercase">
              {t('allReleases')}
            </p>
            <nav
              ref={desktopNavRef}
              aria-label={t('allReleases')}
              className="relative"
            >
              <div
                aria-hidden
                className="bg-border-base absolute top-1 bottom-1 left-[5px] w-px"
              />
              <ul role="list" className="flex flex-col gap-5">
                {groups.map((group) => (
                  <li key={group.key}>
                    {group.label ? (
                      <p className="text-fg-subtle mb-2 pl-5 text-[11px] font-medium tracking-[0.06em] uppercase">
                        {group.label}
                      </p>
                    ) : null}
                    <ul role="list" className="flex flex-col gap-1.5">
                      {group.releases.map((release) => {
                        const isActive = release.tag === activeTag;
                        return (
                          <li key={release.tag}>
                            <a
                              href={`#${release.tag}`}
                              aria-current={isActive ? 'true' : undefined}
                              className={
                                isActive
                                  ? 'bg-surface-site-inset text-fg-base relative flex items-baseline gap-2 rounded-lg py-1.5 pr-2 pl-5 text-sm font-medium'
                                  : 'text-fg-muted hover:bg-surface-site-inset/60 hover:text-fg-base relative flex items-baseline gap-2 rounded-lg py-1.5 pr-2 pl-5 text-sm transition-colors'
                              }
                            >
                              <span
                                aria-hidden
                                className={
                                  isActive
                                    ? 'bg-fg-base absolute top-2.5 left-0 size-2.5 rounded-full'
                                    : 'border-border-strong bg-surface-site absolute top-2.5 left-0.5 size-2 rounded-full border'
                                }
                              />
                              <span className="text-fg-subtle tabular-nums">
                                {releaseDayOfMonth(release.publishedAt)}
                              </span>
                              <span>v{release.version}</span>
                            </a>
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                ))}
              </ul>
            </nav>
          </aside>

          {releaseStream}
        </div>
      </PageSection>

      <FeatureCta />
    </>
  );
}
