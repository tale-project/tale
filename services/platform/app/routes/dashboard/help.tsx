'use client';

import { Row, Stack, VStack } from '@tale/ui/layout';
import { Markdown } from '@tale/ui/markdown';
import { Text } from '@tale/ui/text';
import { Link, createFileRoute } from '@tanstack/react-router';
import { ArrowUpRight, Clock } from 'lucide-react';
import { useMemo } from 'react';
import { z } from 'zod';

import { LessonVideo } from '@/app/features/help/components/lesson-video';
import {
  ALL_LESSON_IDS,
  HELP_CATEGORIES,
  findLesson,
} from '@/app/features/help/content';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';
import { seo } from '@/lib/utils/seo';

// External feedback channel — the learning center is the in-app surface, but
// the "Contact us" link still hands off to the marketing-site contact form for
// anything the curriculum doesn't cover.
const CONTACT_URL = 'https://tale.dev/contact';

const searchSchema = z.object({
  lesson: z.string().optional(),
});

export const Route = createFileRoute('/dashboard/help')({
  validateSearch: searchSchema,
  head: () => ({ meta: seo('help') }),
  component: HelpPage,
});

function HelpPage() {
  const { t } = useT('help');
  const { lesson: lessonParam } = Route.useSearch();

  // Resolve the active lesson: the `?lesson=` param when it points at a real
  // lesson, otherwise the first lesson of the curriculum.
  const activeId =
    lessonParam && findLesson(lessonParam) ? lessonParam : ALL_LESSON_IDS[0];
  const active = useMemo(() => findLesson(activeId), [activeId]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl px-4 py-10">
        <VStack gap={2} className="mb-8">
          <h1 className="text-fg-base text-2xl font-semibold">{t('title')}</h1>
          <Text variant="muted">{t('subtitle')}</Text>
        </VStack>

        <div className="flex flex-col gap-8 md:flex-row md:items-start">
          <HelpNav activeId={activeId} />

          <main className="min-w-0 flex-1">
            {active ? (
              <LessonContent lessonId={active.lesson.id} />
            ) : (
              <Text variant="muted">{t('empty')}</Text>
            )}

            <ContactCallout />
          </main>
        </div>
      </div>
    </div>
  );
}

/**
 * The table-of-contents sidebar: every category and its lessons, each lesson a
 * deep link that swaps the `?lesson=` search param (client-side, no reload).
 */
function HelpNav({ activeId }: { activeId: string }) {
  const { t } = useT('help');

  return (
    <nav
      aria-label={t('navLabel')}
      className="md:bg-bg-elevated/30 md:border-border-base shrink-0 md:w-72 md:rounded-lg md:border md:p-4"
    >
      <Stack gap={6}>
        {HELP_CATEGORIES.map((category) => {
          const Icon = category.icon;
          return (
            <VStack key={category.id} gap={2}>
              <Row gap={2} align="center">
                <Icon aria-hidden className="text-fg-muted size-4 shrink-0" />
                <Text className="text-fg-base text-sm font-semibold">
                  {t(`categories.${category.id}.title`)}
                </Text>
              </Row>
              <ul className="border-border-base ml-2 flex flex-col border-l pl-3">
                {category.lessons.map((lesson) => {
                  const isActive = lesson.id === activeId;
                  return (
                    <li key={lesson.id}>
                      <Link
                        to="/dashboard/help"
                        search={{ lesson: lesson.id }}
                        aria-current={isActive ? 'page' : undefined}
                        className={cn(
                          'block rounded-md px-2 py-1.5 text-sm transition-colors',
                          isActive
                            ? 'bg-accent text-fg-base font-medium'
                            : 'text-fg-muted hover:text-fg-base hover:bg-accent/50',
                        )}
                      >
                        {t(`lessons.${lesson.id}.title`)}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </VStack>
          );
        })}
      </Stack>
    </nav>
  );
}

/** The selected lesson: title, reading time, video walkthrough, and body. */
function LessonContent({ lessonId }: { lessonId: string }) {
  const { t } = useT('help');
  const entry = findLesson(lessonId);
  if (!entry) return <Text variant="muted">{t('empty')}</Text>;

  const { lesson } = entry;
  const title = t(`lessons.${lessonId}.title`);

  return (
    <article className="min-w-0">
      <VStack gap={2} className="mb-5">
        <h2 className="text-fg-base text-xl font-semibold">{title}</h2>
        <Row gap={2} align="center">
          <Clock aria-hidden className="text-fg-muted size-3.5 shrink-0" />
          <Text variant="muted" className="text-xs">
            {t('minutes', { count: lesson.durationMinutes })}
          </Text>
        </Row>
      </VStack>

      <div className="mb-6">
        <LessonVideo videoSrc={lesson.videoSrc} lessonTitle={title} />
      </div>

      <Markdown>{t(`lessons.${lessonId}.body`)}</Markdown>
    </article>
  );
}

/** A persistent hand-off card for questions the curriculum doesn't answer. */
function ContactCallout() {
  const { t } = useT('help');
  return (
    <div className="border-border-base bg-bg-elevated/40 mt-10 rounded-lg border p-5">
      <VStack gap={2} align="start">
        <Text className="text-fg-base text-sm font-semibold">
          {t('contact.title')}
        </Text>
        <Text variant="muted" className="text-sm">
          {t('contact.description')}
        </Text>
        <a
          href={CONTACT_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-fg-base hover:text-fg-muted mt-1 inline-flex items-center gap-1 text-sm font-medium underline underline-offset-2"
        >
          {t('contact.action')}
          <ArrowUpRight aria-hidden className="size-3.5" />
        </a>
      </VStack>
    </div>
  );
}
