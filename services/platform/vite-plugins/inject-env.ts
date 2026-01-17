import type { Plugin } from 'vite';

interface EnvConfig {
  SITE_URL: string;
  MICROSOFT_AUTH_ENABLED: boolean;
}

function getEnvConfig(): EnvConfig {
  return {
    SITE_URL: process.env.SITE_URL || 'http://localhost:3000',
    MICROSOFT_AUTH_ENABLED: process.env.MICROSOFT_AUTH_ENABLED === 'true',
  };
}

export function injectEnv(): Plugin {
  return {
    name: 'inject-env',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        const envConfig = getEnvConfig();
        const envScript = `window.__ENV__ = ${JSON.stringify(envConfig)};`;
        return html.replace(
          'window.__ENV__ = "__ENV_PLACEHOLDER__";',
          envScript,
        );
      },
    },
  };
}
