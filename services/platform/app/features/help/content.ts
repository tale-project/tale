import {
  BookOpen,
  GraduationCap,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';

/**
 * Curriculum for the in-app Help & learning center (`/dashboard/help`).
 *
 * Only the *structure* lives here — ids, ordering, icons, reading time, and the
 * optional self-hosted video source. All human-facing text (category titles,
 * lesson titles/summaries, and the markdown body) is resolved at render time
 * from the `help` i18n namespace so the curriculum stays fully localized:
 *
 *   help.categories.<categoryId>.{title,description}
 *   help.lessons.<lessonId>.{title,summary,body}
 *
 * Those keys are looked up dynamically, so the `help.categories` and
 * `help.lessons` prefixes are listed in `lib/i18n/keys-dynamic.txt` for the
 * orphan-key scanner.
 *
 * Video posture: the platform ships a strict CSP (`media-src 'self'`,
 * `frame-src 'self'`) for its offline / self-hosted deployments, so external
 * embeds (YouTube, Vimeo, …) are intentionally blocked. A lesson's `videoSrc`
 * must therefore be a **same-origin** path to a self-hosted clip (e.g. a file
 * under `services/platform/public/`). Lessons without a `videoSrc` render a
 * "coming soon" placeholder instead — see `LessonVideo`.
 */
export interface HelpLesson {
  /** Stable id; the i18n key segment under `help.lessons.<id>`. */
  id: string;
  /**
   * Optional same-origin URL of a self-hosted walkthrough clip. Omit until a
   * clip has been produced; the lesson then renders a placeholder. Must be
   * served from the app's own origin to satisfy the `media-src 'self'` CSP.
   */
  videoSrc?: string;
  /** Estimated minutes to read / watch — shown as a hint next to the title. */
  durationMinutes: number;
}

export interface HelpCategory {
  /** Stable id; the i18n key segment under `help.categories.<id>`. */
  id: string;
  icon: LucideIcon;
  lessons: HelpLesson[];
}

/**
 * The three pillars from issue #1922: LLM fundamentals, platform how-tos, and
 * the opportunities & risks of AI (responsible-use guidance).
 */
export const HELP_CATEGORIES: readonly HelpCategory[] = [
  {
    id: 'fundamentals',
    icon: GraduationCap,
    lessons: [
      { id: 'whatAreLlms', durationMinutes: 5 },
      { id: 'howLlmsWork', durationMinutes: 6 },
      { id: 'limitations', durationMinutes: 5 },
    ],
  },
  {
    id: 'platform',
    icon: BookOpen,
    lessons: [
      { id: 'gettingStarted', durationMinutes: 4 },
      { id: 'chattingWithAgents', durationMinutes: 5 },
      { id: 'knowledgeBase', durationMinutes: 5 },
      { id: 'automations', durationMinutes: 6 },
    ],
  },
  {
    id: 'responsibleAi',
    icon: ShieldCheck,
    lessons: [
      { id: 'opportunities', durationMinutes: 5 },
      { id: 'risks', durationMinutes: 6 },
      { id: 'bestPractices', durationMinutes: 5 },
    ],
  },
];

/** Flat, ordered list of every lesson id — handy for default selection. */
export const ALL_LESSON_IDS: readonly string[] = HELP_CATEGORIES.flatMap((c) =>
  c.lessons.map((l) => l.id),
);

/** Look up the `{ category, lesson }` pair for a lesson id, or `null`. */
export function findLesson(
  lessonId: string,
): { category: HelpCategory; lesson: HelpLesson } | null {
  for (const category of HELP_CATEGORIES) {
    const lesson = category.lessons.find((l) => l.id === lessonId);
    if (lesson) return { category, lesson };
  }
  return null;
}
