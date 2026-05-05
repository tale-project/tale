import type { NodePlopAPI } from 'plop';

export function registerHelpers(plop: NodePlopAPI): void {
  plop.setHelper('year', () => new Date().getFullYear());
  plop.setHelper('upperFirst', (s: string) =>
    s ? s[0].toUpperCase() + s.slice(1) : '',
  );
  plop.setHelper('snakeCase', (s: string) =>
    (s ?? '')
      .replace(/[-\s]+/g, '_')
      .replace(/([a-z])([A-Z])/g, '$1_$2')
      .toLowerCase(),
  );
  plop.setHelper('kebabCase', (s: string) =>
    (s ?? '')
      .replace(/[_\s]+/g, '-')
      .replace(/([a-z])([A-Z])/g, '$1-$2')
      .toLowerCase(),
  );
  plop.setHelper('eq', (a: unknown, b: unknown) => a === b);
}
