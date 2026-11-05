import { yamlImports } from '@tale/ui/vite/yaml';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import viteReact from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

// In development the backend (`backend/main.ts`) runs on its own port, as the
// built server does (the dev port + 200), and the dev server forwards the API,
// the live view's WebSocket and the MCP endpoint to it. `scripts/dev.ts` starts
// both.
const backend =
  process.env.SESSION_MANAGER_BACKEND_URL ?? 'http://127.0.0.1:3204';

const BOOT_SHELL_MODULE = '/app/components/layout/boot-shell.tsx';

/**
 * The boot shell in the page the dev server serves, as the build bakes it into
 * `dist/index.html` (`scripts/prerender-boot-shell.ts`): the frame of the app
 * is the first paint, not a blank page. Rendered through the dev server's
 * module graph, so an edit to the placeholder shows at the next reload, as the
 * platform's `vite-plugins/inject-boot-shell.ts` does. A shell that fails to
 * render leaves the page as it was: blank until the app draws.
 */
function bootShell(): Plugin {
  return {
    name: 'session-manager-boot-shell',
    apply: 'serve',
    async transformIndexHtml(html, { server }) {
      if (server === undefined) return html;
      try {
        // ssrLoadModule returns an untyped record; the module's own exports are its type.
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see above
        const shell = (await server.ssrLoadModule(
          BOOT_SHELL_MODULE,
        )) as typeof import('./app/components/layout/boot-shell');
        return shell.withBootShell(html);
      } catch (error) {
        console.warn('[boot-shell] the dev server could not render it', error);
        return html;
      }
    },
  };
}

export default defineConfig({
  // Absolute, unlike the service template's './': the server answers a nested
  // address (`/settings/general`) with the shell too, and a relative
  // './assets/' would resolve against that path and 404. As on the platform
  // and the web site.
  base: '/',
  resolve: {
    dedupe: ['react', 'react-dom'],
    tsconfigPaths: true,
  },
  server: {
    port: 3004,
    // Fail loudly if 3004 is taken instead of silently moving to the next free
    // port: the backend of the dev fleet (`scripts/dev.ts`) only answers a page
    // opened through this port, so a silent shift just looks like an app that
    // refuses its own address. As on the platform and the web site.
    strictPort: true,
    proxy: {
      '/api': { target: backend, ws: true },
      '/mcp': { target: backend },
    },
    watch: {
      // What other processes write into the service's folder while the dev
      // server runs is output, not source: the Playwright report is an
      // `index.html`, which Vite answers with a full page reload of every open
      // tab, and a database being written or a build being emptied is no change
      // of the app. (Vite ignores `.git`, `node_modules`, `test-results` and
      // its own cache by default; this adds to those.) The messages, the
      // sources of the page's words, are watched as ever.
      ignored: [
        '**/playwright-report/**',
        '**/test-results/**',
        '**/dist/**',
        '**/.camoufox-tests/**',
        '**/data/**',
      ],
    },
  },
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react/jsx-runtime',
      '@tanstack/react-router',
      '@tanstack/react-query',
      'framer-motion',
      'lucide-react',
      'zod',
    ],
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  ssr: {
    noExternal: [
      '@tale/ui',
      '@tanstack/react-router',
      'framer-motion',
      'lucide-react',
      'react-i18next',
      'i18next',
      'i18next-icu',
    ],
  },
  // Every route's page loads with its route, as on the platform and the web
  // site (`autoCodeSplitting`), instead of one chunk for the whole app.
  plugins: [
    tanstackRouter({ autoCodeSplitting: true }),
    viteReact(),
    yamlImports(),
    bootShell(),
  ],
});
