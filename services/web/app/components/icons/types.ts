import type { ComponentType, SVGProps } from 'react';

/** Shared prop shape for marketing brand SVG marks. */
export type BrandIcon = ComponentType<
  SVGProps<SVGSVGElement> & { className?: string }
>;
