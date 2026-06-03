import type { CSSProperties } from 'react';

/** Shared recharts `<Tooltip contentStyle>` so the automation metric charts
 *  keep one tooltip appearance. */
export const CHART_TOOLTIP_CONTENT_STYLE: CSSProperties = {
  fontSize: 12,
  borderRadius: 6,
  border: '1px solid var(--border)',
  background: 'var(--popover)',
};
