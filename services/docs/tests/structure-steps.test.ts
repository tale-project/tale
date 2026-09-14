import fs from 'node:fs';
import path from 'node:path';

import { Markdown } from '@tale/ui/markdown';
import { markdownComponents } from '@tale/ui/markdown/components/registry';
import { Step, Steps } from '@tale/ui/markdown/components/steps';
import {
  Children,
  createElement,
  isValidElement,
  type ComponentProps,
} from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { jsx } from 'react/jsx-runtime';
import { describe, expect, it } from 'vitest';

import { assertNoFindings, type Finding } from './lib/findings';
import { extractComponentTags, parseFrontmatter } from './lib/markdown';
import { CONTENT_ROOT } from './lib/paths';
import { walkDocs } from './lib/walk';

/** Use the site's parser and component map: raw headings and paragraphs are
 * React elements too, so Steps otherwise silently treats each as its own step. */
function inspectSteps(body: string, file = 'fixture.md') {
  const findings: Finding[] = [];
  const components = {
    ...markdownComponents,
    steps: ({
      children,
      node,
    }: ComponentProps<typeof Steps> & {
      node?: { position?: { start?: { line: number } } };
    }) => {
      for (const child of Children.toArray(children)) {
        if (typeof child === 'string' && child.trim() === '') continue;
        if (
          !isValidElement<ComponentProps<typeof Step>>(child) ||
          child.type !== Step
        ) {
          findings.push({
            file,
            line: node?.position?.start?.line ?? 0,
            rule: 'steps-child',
            detail:
              'wrap every direct child of <Steps> in <Step title="…">; keep its prose, headings and images inside that step',
          });
        } else if (
          typeof child.props.title !== 'string' ||
          !child.props.title.trim()
        ) {
          findings.push({
            file,
            line: node?.position?.start?.line ?? 0,
            rule: 'step-title',
            detail: 'give each <Step> a nonempty title',
          });
        }
      }
      return createElement(Steps, null, children);
    },
  };
  const html = renderToStaticMarkup(
    jsx(Markdown, { children: body, components }),
  );
  return { findings, html };
}

describe('Steps structure', () => {
  it.each([
    '### Select the files\n\nChoose the package.',
    'A paragraph without a Step wrapper.',
    '- A list without a Step wrapper.',
    '<Frame caption="Package picker">\n\n![Package picker](/images/picker.webp)\n\n</Frame>',
    '<Step title="First">\n\nFirst action.\n\n</Step>\n\nA stray paragraph.',
  ])('rejects content directly inside Steps: %s', (body) => {
    const { findings } = inspectSteps(`<Steps>\n\n${body}\n\n</Steps>`);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.every((finding) => finding.rule === 'steps-child')).toBe(
      true,
    );
    expect(findings[0].line).toBe(1);
  });

  it.each(['<Step>', '<Step title="   ">'])(
    'rejects an untitled step: %s',
    (opening) => {
      expect(
        inspectSteps(`<Steps>\n\n${opening}\n\nAction.\n\n</Step>\n\n</Steps>`)
          .findings,
      ).toEqual([expect.objectContaining({ rule: 'step-title' })]);
    },
  );

  it('accepts steps containing rich content and renders one list item per step', () => {
    const { findings, html } = inspectSteps(`
<Steps>

<!-- Invisible author note. -->

<Step title="Select the files">

Choose the package.

<Frame caption="Package picker">

![Package picker](/images/picker.webp)

</Frame>

\`\`\`markdown
<Steps>
### This is an example, not a real procedure
</Steps>
\`\`\`

</Step>

<Step title="Save">

Save the validated package.

</Step>

</Steps>
`);
    expect(findings, html).toEqual([]);
    expect(html.match(/<li\b/g)).toHaveLength(2);
    expect(html).toContain('Select the files</h3>');
    expect(html).toContain('Save</h3>');
    expect(html).toContain('Package picker');
  });

  it('ignores Steps markup inside code examples and HTML comments', () => {
    expect(
      inspectSteps(
        '`<Steps>`\n\n<!-- <Steps>invalid</Steps> -->\n\n```md\n<Steps>\n\n### Example\n\n</Steps>\n```',
      ).findings,
    ).toEqual([]);
  });

  it('every procedure uses titled Step children', () => {
    const findings: Finding[] = [];
    for (const rel of walkDocs()) {
      const { body } = parseFrontmatter(
        fs
          .readFileSync(path.join(CONTENT_ROOT, rel), 'utf8')
          .replaceAll('\r\n', '\n'),
      );
      if (!extractComponentTags(body).some((tag) => tag.name === 'Steps'))
        continue;
      findings.push(...inspectSteps(body, rel).findings);
    }
    assertNoFindings(findings, 'Steps-structure issues');
  });
});
