import { z } from 'zod';

import { TASK_COMMENT_MAX } from '../../../backend/core/tasks/helpers';

/** Reader languages one comment may carry, en/de/fr included. */
export const TASK_COMMENT_LOCALES_MAX = 16;

/** One write-time snapshot for all reader languages. */
export const taskCommentBodiesSchema = z
  .object({
    en: z.string().trim().min(1).max(TASK_COMMENT_MAX),
    de: z.string().trim().min(1).max(TASK_COMMENT_MAX),
    fr: z.string().trim().min(1).max(TASK_COMMENT_MAX),
  })
  .catchall(z.string().trim().min(1).max(TASK_COMMENT_MAX))
  .refine(
    (bodies) => Object.keys(bodies).length <= TASK_COMMENT_LOCALES_MAX,
    `At most ${TASK_COMMENT_LOCALES_MAX} locale translations are allowed`,
  )
  .refine(
    (bodies) =>
      Object.keys(bodies).every((locale) =>
        /^[a-z]{2}(?:-[A-Z]{2})?$/.test(locale),
      ),
    'Expected language or language-region locale keys',
  );

export type TaskCommentBodies = z.infer<typeof taskCommentBodiesSchema>;
