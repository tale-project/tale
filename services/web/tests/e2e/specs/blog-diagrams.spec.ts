import { expect, test } from '@playwright/test';

import { BLOG_DIAGRAM_MANIFEST } from '../../../app/generated/blog-diagram-manifest';

for (const diagram of BLOG_DIAGRAM_MANIFEST) {
  test(`${diagram.locale} ${diagram.id} diagram keeps text inside padded boxes`, async ({
    page,
  }) => {
    await page.goto(diagram.path);
    const problems = await page.locator('svg').evaluate((svg) => {
      const boxes = [...svg.querySelectorAll('rect[rx]')].map((rect) => ({
        x: Number(rect.getAttribute('x')),
        y: Number(rect.getAttribute('y')),
        width: Number(rect.getAttribute('width')),
        height: Number(rect.getAttribute('height')),
      }));
      const issues: string[] = [];
      const texts = [...svg.querySelectorAll('text')];
      for (const text of texts) {
        const x = Number(text.getAttribute('x'));
        const y = Number(text.getAttribute('y'));
        // Nested infrastructure and label boxes belong to the smallest
        // containing surface, not the larger background behind them.
        const box = boxes
          .filter(
            (candidate) =>
              x >= candidate.x &&
              x < candidate.x + candidate.width &&
              y >= candidate.y &&
              y < candidate.y + candidate.height,
          )
          .sort((a, b) => a.width * a.height - b.width * b.height)[0];
        if (!box) continue;
        const bounds = text.getBBox();
        const insets = [
          bounds.x - box.x,
          bounds.y - box.y,
          box.x + box.width - bounds.x - bounds.width,
          box.y + box.height - bounds.y - bounds.height,
        ];
        // SVG transforms can round an exact 16-unit inset down by a fraction.
        if (insets.some((inset) => inset < 15.9)) {
          issues.push(
            `${text.textContent}: left/top/right/bottom ${insets.map((n) => n.toFixed(1)).join('/')}`,
          );
        }
        for (const other of texts) {
          if (other === text) continue;
          const adjacent = other.getBBox();
          const overlapX =
            Math.min(bounds.x + bounds.width, adjacent.x + adjacent.width) -
            Math.max(bounds.x, adjacent.x);
          const overlapY =
            Math.min(bounds.y + bounds.height, adjacent.y + adjacent.height) -
            Math.max(bounds.y, adjacent.y);
          if (overlapX > 0 && overlapY > 0) {
            issues.push(`${text.textContent} overlaps ${other.textContent}`);
          }
        }
      }
      for (const path of svg.querySelectorAll<SVGPathElement>(
        'path[marker-end]',
      )) {
        const start = path.getPointAtLength(0);
        const end = path.getPointAtLength(path.getTotalLength());
        if (Math.abs(start.y - end.y) > 0.1 || end.x <= start.x) continue;
        const markerId = path
          .getAttribute('marker-end')
          ?.match(/#([^)]*)/)?.[1];
        const marker = svg.querySelector(`marker[id="${markerId}"]`);
        if (!marker) continue;
        const scale =
          marker.getAttribute('markerUnits') === 'userSpaceOnUse'
            ? 1
            : Number(path.getAttribute('stroke-width') ?? 1);
        const headStart = end.x - Number(marker.getAttribute('refX')) * scale;
        const headEnd =
          headStart + Number(marker.getAttribute('markerWidth')) * scale;
        if (
          boxes.some(
            (box) =>
              end.y > box.y &&
              end.y < box.y + box.height &&
              headStart < box.x + box.width &&
              headEnd > box.x,
          )
        ) {
          issues.push(`Arrowhead overlaps a box: ${path.getAttribute('d')}`);
        }
      }
      return issues;
    });
    expect(problems).toEqual([]);
  });
}
