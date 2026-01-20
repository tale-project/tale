import { type Plugin, loadEnv } from 'vite';

interface EnvConfig {
  SITE_URL: string;
  MICROSOFT_AUTH_ENABLED: boolean;
}

function getEnvConfig(env: Record<string, string>): EnvConfig {
  return {
    SITE_URL: env.SITE_URL || 'http://localhost:3000',
    MICROSOFT_AUTH_ENABLED: env.MICROSOFT_AUTH_ENABLED === 'true',
  };
}

export function injectEnv(): Plugin {
  let envConfig: EnvConfig;

  return {
    name: 'inject-env',
    configResolved(config) {
      const env = loadEnv(config.mode, process.cwd(), '');
      envConfig = getEnvConfig(env);
    },
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        const envScript = `window.__ENV__ = ${JSON.stringify(envConfig)};`;
        return html.replace(
          'window.__ENV__ = "__ENV_PLACEHOLDER__";',
          envScript,
        );
      },
    },
  };
}
