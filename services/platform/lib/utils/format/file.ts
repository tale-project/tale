import { formatBytes } from './number';

/**
 * A file's size in the app's default locale — the byte formatter for the
 * attachment surfaces that render outside a locale-aware context. Same
 * units and rounding as `formatBytes`, so a size never reads differently
 * in a chat attachment than in the documents list.
 */
export function formatFileSize(bytes: number): string {
  return formatBytes(bytes);
}

export function middleEllipsis(name: string, maxLength: number): string {
  if (name.length <= maxLength) return name;
  const extIndex = name.lastIndexOf('.');
  const ext = extIndex > 0 ? name.slice(extIndex) : '';
  const base = extIndex > 0 ? name.slice(0, extIndex) : name;
  const available = maxLength - ext.length - 1; // 1 for the ellipsis char
  if (available < 4) return name.slice(0, maxLength - 1) + '\u2026';
  const front = Math.ceil(available / 2);
  const back = Math.floor(available / 2);
  return base.slice(0, front) + '\u2026' + base.slice(-back) + ext;
}
