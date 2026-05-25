'use client';

import { Skeleton } from '@tale/ui/skeleton';
import { Text } from '@tale/ui/text';
import { Link } from '@tanstack/react-router';
import { Sparkles } from 'lucide-react';

import { useT } from '@/lib/i18n/client';

import { useListSkills } from '../hooks/queries';

interface SkillDetailSidebarProps {
  organizationId: string;
  /** Slug of the currently-open skill, highlighted in the list. */
  currentSlug: string;
}

interface RawSkill {
  slug: string;
  name?: string;
  description?: string;
  status?: string;
}

/**
 * Left rail of the three-pane skill detail view. Mirrors the Claude
 * skills UX where the operator can navigate between skills without
 * bouncing back to the index route. Pulls from `useListSkills` so the
 * list stays in lockstep with the table on the index page.
 *
 * Broken-load skills (those that came back with a `status` field
 * instead of name/description) render as muted entries with the slug
 * only — surfacing them here, rather than silently filtering, matches
 * the table's behavior and lets the user click in to fix the parse
 * error.
 */
export function SkillDetailSidebar({
  organizationId,
  currentSlug,
}: SkillDetailSidebarProps) {
  const { t } = useT('settings');
  const { skills: raw, isLoading } = useListSkills(organizationId);

  if (isLoading) {
    return (
      <aside
        className="border-border w-64 shrink-0 overflow-y-auto border-r p-3"
        aria-label={t('skills.detail.sidebar.heading', {
          defaultValue: 'Skills',
        })}
      >
        <Skeleton className="mb-2 ml-1 h-3 w-16" />
        <ul className="space-y-0.5">
          {Array.from({ length: 7 }).map((_, idx) => (
            <li key={idx}>
              <div className="flex items-center gap-1.5 rounded-md px-2 py-1.5">
                <Skeleton className="size-3.5 shrink-0 rounded" />
                <Skeleton
                  className="h-3.5"
                  style={{ width: `${55 + ((idx * 13) % 35)}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      </aside>
    );
  }

  const list: RawSkill[] = Array.isArray(raw) ? (raw as RawSkill[]) : [];

  return (
    <aside className="border-border w-64 shrink-0 overflow-y-auto border-r p-3">
      <Text variant="caption" className="mb-2 block px-1">
        {t('skills.detail.sidebar.heading', { defaultValue: 'Skills' })}
      </Text>
      {list.length === 0 ? (
        <Text variant="muted" className="px-1">
          {t('skills.detail.sidebar.empty', {
            defaultValue: 'No other skills',
          })}
        </Text>
      ) : (
        <ul className="space-y-0.5">
          {list.map((s) => {
            const isActive = s.slug === currentSlug;
            const brokenLabel = s.status !== undefined && s.name === undefined;
            return (
              <li key={s.slug}>
                <Link
                  to="/dashboard/$id/settings/skills/$skillSlug"
                  params={{ id: organizationId, skillSlug: s.slug }}
                  className={
                    isActive
                      ? 'bg-muted text-foreground block rounded-md px-2 py-1.5 text-sm'
                      : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground block rounded-md px-2 py-1.5 text-sm'
                  }
                >
                  <div className="flex items-center gap-1.5">
                    <Sparkles className="size-3.5 shrink-0" aria-hidden />
                    <span className="truncate font-medium">
                      {s.name ?? s.slug}
                    </span>
                  </div>
                  {brokenLabel ? (
                    <span className="text-destructive ml-5 block text-xs">
                      {t('skills.detail.sidebar.brokenTag', {
                        defaultValue: '(load error)',
                      })}
                    </span>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
