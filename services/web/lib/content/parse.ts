import { localizedPath } from '@tale/ui/i18n/locales';
import { parse } from 'yaml';
import { z } from 'zod';

import {
  MARKETING_CONTENT_CATEGORIES,
  marketingContentPath,
  type MarketingContentDocument,
} from './model';

const identitySchema = z.object({
  category: z.enum(MARKETING_CONTENT_CATEGORIES),
  locale: z.enum(['en', 'de', 'fr']),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
});

const frontmatterSchema = z.strictObject({
  title: z.string().min(30).max(60),
  description: z.string().min(110).max(160),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  reviewed: z.iso.date(),
  draft: z.boolean().default(false),
  topicId: z
    .string()
    .regex(/^T[0-9]{2}$/)
    .optional(),
  coverAlt: z.string().min(1).optional(),
  competitor: z.string().min(1).optional(),
  relationship: z
    .enum(['direct', 'adjacent', 'framework', 'runtime'])
    .optional(),
});

/** Parse at the file boundary, in tooling only. Neither YAML nor Zod is
 * needed to read a page's already-validated metadata/body in the browser. */
export function parseMarketingContent(
  raw: string,
  sourcePath: string,
): MarketingContentDocument {
  const source = /\/(comparisons|use-cases|blog)\/([^/]+)\/([^/]+)\.md$/.exec(
    sourcePath.replaceAll('\\', '/'),
  );
  if (!source) throw new Error(`Invalid marketing content path: ${sourcePath}`);
  const identity = identitySchema.parse({
    category: source[1],
    locale: source[2],
    slug: source[3],
  });
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  if (!match) throw new Error(`Missing marketing frontmatter: ${sourcePath}`);
  const frontmatter = frontmatterSchema.parse(parse(match[1]));
  const path = marketingContentPath(identity.category, identity.slug);
  const expectedSlug =
    identity.slug === 'index' ? path.slice(1) : identity.slug;
  if (frontmatter.slug !== expectedSlug)
    throw new Error(`Frontmatter slug does not match ${sourcePath}`);
  if (
    identity.category === 'comparisons' &&
    identity.slug !== 'index' &&
    (!frontmatter.competitor || !frontmatter.relationship)
  ) {
    throw new Error(
      `Comparison needs competitor and relationship: ${sourcePath}`,
    );
  }
  if (
    identity.category === 'blog' &&
    identity.slug !== 'index' &&
    (!frontmatter.topicId || !frontmatter.coverAlt)
  ) {
    throw new Error(`Blog article needs topicId and coverAlt: ${sourcePath}`);
  }
  const content = match[2].trim();
  if (!content || /^#\s/m.test(content))
    throw new Error(
      `Marketing body needs content with headings below H1: ${sourcePath}`,
    );
  return {
    ...identity,
    path,
    url: localizedPath(identity.locale, path),
    frontmatter,
    content,
  };
}
