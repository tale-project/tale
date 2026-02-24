export const MAX_ICON_SIZE = 256 * 1024; // 256KB

export const ICON_FILE_NAMES = [
  'icon.png',
  'icon.svg',
  'icon.jpg',
  'icon.jpeg',
  'icon.webp',
];

export const ICON_MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

export const ACCEPTED_ICON_TYPES = new Set([
  'image/png',
  'image/svg+xml',
  'image/jpeg',
  'image/webp',
]);
