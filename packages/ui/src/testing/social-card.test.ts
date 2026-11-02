import { describe, expect, it } from 'vitest';

import { SOCIAL_CARD_TAGS, socialCardTagMismatches } from './social-card';

const shell = (tags: Readonly<Record<string, string>>) =>
  `<head>${Object.entries(tags)
    .map(([key, content]) =>
      key.startsWith('twitter:')
        ? `<meta name="${key}" content="${content}" />`
        : `<meta\n  property="${key}"\n  content="${content}"\n/>`,
    )
    .join('\n')}</head>`;

describe('socialCardTagMismatches', () => {
  it('accepts a shell that names the documented card', () => {
    expect(socialCardTagMismatches(shell(SOCIAL_CARD_TAGS))).toEqual([]);
  });

  it('reports a card of another size, a missing tag and a repeated one', () => {
    const { 'twitter:image': _twitter, ...tags } = SOCIAL_CARD_TAGS;
    const html = shell({ ...tags, 'og:image:width': '1280' }).replace(
      '</head>',
      `<meta property="og:image" content="https://example.com/card.png" /></head>`,
    );
    expect(socialCardTagMismatches(html)).toEqual([
      `og:image: expected "${SOCIAL_CARD_TAGS['og:image']}", found "${SOCIAL_CARD_TAGS['og:image']}", "https://example.com/card.png"`,
      `og:image:width: expected "${SOCIAL_CARD_TAGS['og:image:width']}", found "1280"`,
      `twitter:image: expected "${SOCIAL_CARD_TAGS['twitter:image']}", found no tag`,
    ]);
  });
});
