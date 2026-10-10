/**
 * Documents people upload to the knowledge hub: plain text, Markdown, CSV
 * and JSON of realistic size (1–200 KB, most of them a few KB), each built
 * around a handful of distinctive keywords so a later search can ask about
 * what was actually uploaded.
 *
 * Only formats the hub accepts: its allowlist is keyed on the extension
 * (`UNSUPPORTED_FILE_TYPE` otherwise) and the upload dialog's picker offers
 * nothing else, so an `.html` page is not something a person can upload.
 */

import type { Faker } from '@faker-js/faker';

import type { UserFaker } from './faker.ts';
import { type Random, intBetween, logNormal, pick } from './random.ts';

export type DocumentKind = 'text' | 'markdown' | 'csv' | 'json';

export interface GeneratedDocument {
  kind: DocumentKind;
  fileName: string;
  contentType: string;
  body: string;
  /** Distinctive terms the body mentions repeatedly. */
  keywords: string[];
}

export const MIN_DOCUMENT_BYTES = 1_024;
export const MAX_DOCUMENT_BYTES = 200 * 1_024;

const KINDS: Record<DocumentKind, { ext: string; contentType: string }> = {
  text: { ext: 'txt', contentType: 'text/plain' },
  markdown: { ext: 'md', contentType: 'text/markdown' },
  csv: { ext: 'csv', contentType: 'text/csv' },
  json: { ext: 'json', contentType: 'application/json' },
};

/** Document size: log-normal around 8 KB, clamped to 1–200 KB. */
export function documentSize(random: Random): number {
  const size = Math.round(logNormal(random, 8 * 1_024, 1.1));
  return Math.min(MAX_DOCUMENT_BYTES, Math.max(MIN_DOCUMENT_BYTES, size));
}

function keywordsFor(faker: Faker): string[] {
  return [
    faker.company.name(),
    faker.commerce.productName(),
    faker.hacker.noun(),
    faker.location.city(),
  ].map((word) => word.replace(/[^\p{L}\p{N} '-]/gu, '').trim());
}

function sentenceWith(
  faker: Faker,
  random: Random,
  keywords: string[],
): string {
  const sentence = faker.lorem.sentence({ min: 6, max: 16 });
  const keyword = pick(random, keywords) ?? '';
  return random() < 0.35
    ? `${sentence.slice(0, -1)} for ${keyword}.`
    : sentence;
}

/** Generated content up to `bytes` (UTF-8 is close to chars for this text). */
function fill(target: number, next: () => string, separator: string): string {
  const parts: string[] = [];
  let length = 0;
  while (length < target) {
    const part = next();
    parts.push(part);
    length += part.length + separator.length;
  }
  return parts.join(separator);
}

/** One document for the user to upload. */
export function generateDocument(
  data: UserFaker,
  random: Random,
): GeneratedDocument {
  const kind =
    pick(random, ['text', 'markdown', 'markdown', 'csv', 'json'] as const) ??
    'text';
  const faker = data.get();
  const keywords = keywordsFor(faker);
  const size = documentSize(random);
  const title = `${keywords[0] ?? 'Company'} ${pick(random, ['handbook', 'report', 'policy', 'price list', 'meeting notes', 'runbook']) ?? 'notes'}`;
  let body: string;
  switch (kind) {
    case 'text':
      body = `${title}\n\n${fill(size, () => sentenceWith(faker, random, keywords), ' ')}`;
      break;
    case 'markdown': {
      let section = 0;
      body = `# ${title}\n\n${fill(
        size,
        () => {
          section += 1;
          const heading = `## ${section}. ${faker.company.buzzPhrase()}`;
          const bullets = Array.from(
            { length: intBetween(random, 2, 5) },
            () => `- ${sentenceWith(faker, random, keywords)}`,
          ).join('\n');
          return `${heading}\n\n${faker.lorem.paragraph()} ${sentenceWith(faker, random, keywords)}\n\n${bullets}`;
        },
        '\n\n',
      )}\n`;
      break;
    }
    case 'csv':
      body = `sku,product,customer,city,quantity,unit_price\n${fill(
        size,
        () =>
          [
            faker.string.alphanumeric(8).toUpperCase(),
            (pick(random, keywords) ?? faker.commerce.productName()).replace(
              /,/g,
              ' ',
            ),
            faker.company.name().replace(/,/g, ' '),
            faker.location.city().replace(/,/g, ' '),
            intBetween(random, 1, 500),
            faker.commerce.price(),
          ].join(','),
        '\n',
      )}\n`;
      break;
    case 'json': {
      let serial = 0;
      // Kept clear of the cap so the final slice never cuts the JSON.
      body = `{\n  "title": ${JSON.stringify(title)},\n  "records": [\n${fill(
        Math.min(size, MAX_DOCUMENT_BYTES - 2_048),
        () => {
          serial += 1;
          return `    ${JSON.stringify({
            id: serial,
            customer: faker.company.name(),
            product: pick(random, keywords) ?? faker.commerce.productName(),
            city: faker.location.city(),
            quantity: intBetween(random, 1, 500),
            note: sentenceWith(faker, random, keywords),
          })}`;
        },
        ',\n',
      )}\n  ]\n}\n`;
      break;
    }
  }
  const spec = KINDS[kind];
  const slug = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
  return {
    kind,
    fileName: `${slug || 'document'}-${faker.string.alphanumeric(6)}.${spec.ext}`,
    contentType: spec.contentType,
    body: body.slice(0, MAX_DOCUMENT_BYTES),
    keywords: keywords.filter((word) => word.length >= 3),
  };
}

/** A question about uploaded content, built from its keywords. */
export function knowledgeQuery(
  random: Random,
  keywords: readonly string[],
  fallback: string,
): string {
  const keyword = pick(random, keywords);
  if (keyword === undefined) return fallback;
  return (
    pick(random, [
      `What does the document say about ${keyword}?`,
      `${keyword} pricing`,
      `Who is responsible for ${keyword}?`,
      keyword,
      `summary of ${keyword}`,
    ]) ?? keyword
  );
}
