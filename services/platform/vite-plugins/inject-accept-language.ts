import type { Plugin } from 'vite';

/**
 * Vite plugin to inject the Accept-Language request header into the HTML
 * during dev. In production, server.js handles this replacement instead.
 *
 * Registers pre-middleware that patches res.end before Vite's internal HTML
 * middleware sends the response. When Vite calls res.end(html), the patched
 * version replaces the placeholder with the actual Accept-Language value.
 */
export function injectAcceptLanguage(): Plugin {
  return {
    name: 'inject-accept-language',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const acceptLanguage = req.headers['accept-language'] ?? '';
        const originalEnd = res.end.bind(res);

        // Monkey-patch res.end to replace the placeholder in HTML responses.
        // This is a Vite-internal interception pattern — the type narrowing
        // is unavoidable since res.end has multiple overload signatures.
        res.end = (chunk: unknown, ...rest: unknown[]) => {
          if (
            typeof chunk === 'string' &&
            chunk.includes('__ACCEPT_LANGUAGE_PLACEHOLDER__')
          ) {
            const injected = chunk.replace(
              "'__ACCEPT_LANGUAGE_PLACEHOLDER__'",
              JSON.stringify(acceptLanguage),
            );
            // @ts-expect-error — forwarding rest args to overloaded res.end signature
            return originalEnd(injected, ...rest);
          }
          // @ts-expect-error — forwarding rest args to overloaded res.end signature
          return originalEnd(chunk, ...rest);
        };

        next();
      });
    },
  };
}
