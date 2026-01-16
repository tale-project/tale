import type { Plugin } from 'vite';

/**
 * Vite plugin to stub out SSR-only imports for SPA builds.
 * Some dependencies (like better-auth) import TanStack Start SSR modules
 * that aren't needed in pure client-side builds.
 */
export function stubSSRImports(): Plugin {
  const ssrModules = [
    '@tanstack/start-server-core',
    '@tanstack/react-start-server',
    '@tanstack/start-plugin-core',
  ];

  const ssrSpecifiers = [
    '#tanstack-router-entry',
    '#tanstack-start-entry',
    'tanstack-start-manifest:v',
    'tanstack-start-injected-head-scripts:v',
  ];

  return {
    name: 'stub-ssr-imports',
    enforce: 'pre',
    resolveId(id) {
      if (ssrModules.includes(id) || ssrSpecifiers.some((s) => id.includes(s))) {
        return '\0stub:' + id;
      }
    },
    load(id) {
      if (id.startsWith('\0stub:')) {
        return 'export default {};';
      }
    },
  };
}
