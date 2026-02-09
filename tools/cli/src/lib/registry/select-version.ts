import * as logger from '../../utils/logger';
import {
  type VersionInfo,
  getAvailableVersions,
} from './get-available-versions';

const isTTY = process.stdin.isTTY && process.stdout.isTTY;

async function promptForManualVersion(): Promise<string> {
  const { input } = await import('@inquirer/prompts');
  const version = await input({
    message: 'Enter version to deploy:',
    validate: (value) => {
      if (!value.trim()) {
        return 'Version cannot be empty';
      }
      return true;
    },
  });
  return version.replace(/^v/, '');
}

function formatVersionChoice(version: VersionInfo): {
  name: string;
  value: string;
} {
  const aliases =
    version.aliases.length > 0 ? ` → ${version.aliases.join(', ')}` : '';

  // For "latest", use the semantic version alias if available
  let value = version.tag;
  if (version.tag === 'latest') {
    const semanticAlias = version.aliases.find((a) =>
      /^v?\d+\.\d+\.\d+/.test(a),
    );
    if (semanticAlias) {
      value = semanticAlias;
    }
  }

  return {
    name: `${version.tag}${aliases}`,
    value,
  };
}

export async function selectVersion(registry: string): Promise<string | null> {
  if (!isTTY) {
    logger.error('No version specified');
    logger.blank();
    logger.info('Usage: tale deploy <version>');
    logger.info('Example: tale deploy v1.0.0');
    return null;
  }

  logger.info('Fetching available versions...');
  const result = await getAvailableVersions(registry, 10);

  if (result.versions.length === 0) {
    if (result.error === 'network') {
      logger.warn('Network error. Please check your connection.');
    } else {
      logger.warn('Could not fetch available versions from registry.');
    }
    logger.blank();
    return promptForManualVersion();
  }

  const { select } = await import('@inquirer/prompts');
  const recentVersions = result.versions.slice(0, 5);

  const choice = await select({
    message: 'Select version to deploy:',
    choices: [
      ...recentVersions.map(formatVersionChoice),
      {
        name: 'Enter custom version...',
        value: '__custom__',
      },
    ],
  });

  if (choice === '__custom__') {
    return promptForManualVersion();
  }

  return choice.replace(/^v/, '');
}
