import { type Plugin } from 'vite';

interface EnvConfig {
  SITE_URL: string;
  MICROSOFT_AUTH_ENABLED: boolean;
  SENTRY_DSN?: string;
}

function getEnvConfig(): EnvConfig {
  if (!process.env.SITE_URL) {
    throw new Error('Missing required environment variable: SITE_URL');
  }
  return {
    SITE_URL: process.env.SITE_URL,
    MICROSOFT_AUTH_ENABLED: process.env.MICROSOFT_AUTH_ENABLED === 'true',
    SENTRY_DSN: process.env.SENTRY_DSN,
  };
}

export function injectEnv(): Plugin {
  let envConfig: EnvConfig;
  let isProduction = false;

  return {
    name: 'inject-env',
    configResolved(config) {
      isProduction = config.command === 'build';
      if (!isProduction) {
        envConfig = getEnvConfig();
      }
    },
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        if (isProduction) {
          return html;
        }
        const envScript = `window.__ENV__ = ${JSON.stringify(envConfig)};`;
        return html.replace(
          'window.__ENV__ = "__ENV_PLACEHOLDER__";',
          envScript,
        );
      },
    },
  };
}
