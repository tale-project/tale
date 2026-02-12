import JSZip from 'jszip';

import type { IntegrationConfig } from './validate-config';

import { validateConfig } from './validate-config';

const MAX_FILE_SIZE = 1024 * 1024; // 1MB
const MAX_CONNECTOR_SIZE = 512 * 1024; // 512KB
const MAX_ICON_SIZE = 256 * 1024; // 256KB

const ICON_FILE_NAMES = [
  'icon.png',
  'icon.svg',
  'icon.jpg',
  'icon.jpeg',
  'icon.webp',
];
const ICON_MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

export interface ParsedPackage {
  config: IntegrationConfig;
  connectorCode: string;
  iconFile?: File;
}

export interface ParseResult {
  success: boolean;
  data?: ParsedPackage;
  error?: string;
}

/**
 * Parse uploaded files — either a single .zip package or individual config.json + connector.js files.
 */
export async function parseIntegrationFiles(
  files: File[],
): Promise<ParseResult> {
  if (files.length === 1 && files[0].name.endsWith('.zip')) {
    return parseZipPackage(files[0]);
  }
  return parseIndividualFiles(files);
}

async function parseZipPackage(file: File): Promise<ParseResult> {
  if (file.size > MAX_FILE_SIZE) {
    return {
      success: false,
      error: `File size exceeds maximum of ${MAX_FILE_SIZE / 1024}KB`,
    };
  }

  let zip: JSZip;
  try {
    const buffer = await file.arrayBuffer();
    zip = await JSZip.loadAsync(buffer);
  } catch {
    return {
      success: false,
      error: 'Failed to read zip file. Ensure it is a valid zip archive.',
    };
  }

  // Find config.json (may be at root or inside a single folder)
  const configEntry = findFile(zip, 'config.json');
  if (!configEntry) {
    return {
      success: false,
      error:
        'Missing config.json in package. The zip must contain a config.json file.',
    };
  }

  let configRaw: unknown;
  try {
    const configText = await configEntry.async('string');
    configRaw = JSON.parse(configText);
  } catch {
    return { success: false, error: 'config.json is not valid JSON' };
  }

  // Determine type early to decide if connector.js is required
  const isSql =
    typeof configRaw === 'object' &&
    configRaw !== null &&
    'type' in configRaw &&
    (configRaw as Record<string, unknown>).type === 'sql';

  const connectorEntry = findFile(zip, 'connector.js');
  if (!connectorEntry && !isSql) {
    return {
      success: false,
      error:
        'Missing connector.js in package. REST API integrations require a connector.js file.',
    };
  }

  const connectorCode = connectorEntry
    ? await connectorEntry.async('string')
    : '';

  // Look for an icon file in the zip
  const iconFile = await extractIconFromZip(zip);

  return validateAndBuild(configRaw, connectorCode, iconFile);
}

async function extractIconFromZip(zip: JSZip): Promise<File | undefined> {
  for (const iconName of ICON_FILE_NAMES) {
    const entry = findFile(zip, iconName);
    if (!entry) continue;

    const blob = await entry.async('blob');
    if (blob.size > MAX_ICON_SIZE) continue;

    const ext = iconName.slice(iconName.lastIndexOf('.'));
    const mimeType = ICON_MIME_TYPES[ext] ?? 'application/octet-stream';
    return new File([blob], iconName, { type: mimeType });
  }
  return undefined;
}

async function parseIndividualFiles(files: File[]): Promise<ParseResult> {
  const configFile = files.find((f) => f.name === 'config.json');
  const connectorFile = files.find((f) => f.name === 'connector.js');

  if (!configFile) {
    return {
      success: false,
      error: 'Missing config.json. Please upload config.json.',
    };
  }

  const totalSize = files.reduce((sum, f) => sum + f.size, 0);
  if (totalSize > MAX_FILE_SIZE) {
    return {
      success: false,
      error: `Total file size exceeds maximum of ${MAX_FILE_SIZE / 1024}KB`,
    };
  }

  let configRaw: unknown;
  try {
    const configText = await configFile.text();
    configRaw = JSON.parse(configText);
  } catch {
    return { success: false, error: 'config.json is not valid JSON' };
  }

  // Determine type early to decide if connector.js is required
  const isSql =
    typeof configRaw === 'object' &&
    configRaw !== null &&
    'type' in configRaw &&
    (configRaw as Record<string, unknown>).type === 'sql';

  if (!connectorFile && !isSql) {
    return {
      success: false,
      error:
        'Missing connector.js. REST API integrations require a connector.js file.',
    };
  }

  // Check for icon file in individual uploads
  const iconFile = files.find((f) => {
    const name = f.name.toLowerCase();
    return ICON_FILE_NAMES.includes(name) && f.size <= MAX_ICON_SIZE;
  });

  const connectorCode = connectorFile ? await connectorFile.text() : '';
  return validateAndBuild(configRaw, connectorCode, iconFile);
}

function validateAndBuild(
  configRaw: unknown,
  connectorCode: string,
  iconFile?: File,
): ParseResult {
  if (connectorCode.length > MAX_CONNECTOR_SIZE) {
    return {
      success: false,
      error: `connector.js exceeds maximum size of ${MAX_CONNECTOR_SIZE / 1024}KB`,
    };
  }

  const validation = validateConfig(configRaw);
  if (!validation.success) {
    return {
      success: false,
      error: `Invalid config.json:\n${validation.errors?.join('\n')}`,
    };
  }

  if (!validation.config) {
    return { success: false, error: 'Failed to parse config' };
  }

  if (connectorCode.trim().length === 0 && validation.config.type !== 'sql') {
    return {
      success: false,
      error:
        'connector.js is empty. REST API integrations require connector code.',
    };
  }

  if (validation.config.type !== 'sql' && connectorCode.trim().length > 0) {
    if (!/testConnection\s*[:(]/.test(connectorCode)) {
      return {
        success: false,
        error:
          'connector.js must define a testConnection method on the connector object. ' +
          'This method is called when users click "Test connection".',
      };
    }
  }

  return {
    success: true,
    data: {
      config: validation.config,
      connectorCode,
      iconFile,
    },
  };
}

function findFile(zip: JSZip, fileName: string): JSZip.JSZipObject | null {
  // Try root level
  const rootFile = zip.file(fileName);
  if (rootFile) return rootFile;

  // Try inside a single top-level folder
  const entries = Object.keys(zip.files).filter((name) => !name.endsWith('/'));
  const match = entries.find(
    (name) => name.endsWith(`/${fileName}`) && name.split('/').length === 2,
  );
  if (match) return zip.file(match);

  return null;
}
