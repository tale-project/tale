import type {
  ProductScreenshotLocale,
  ProductScreenshotPage,
} from '../../app/content/product-screenshots';

export interface MotionCapture {
  page: ProductScreenshotPage;
  locale: ProductScreenshotLocale;
  variant: 'desktop' | 'mobile';
  sourceShot: string;
  route: string;
  viewport: { width: number; height: number };
  dpr: number;
  width: number;
  height: number;
  durationMs: number;
  fps: number;
  recordedFrameCount: number;
  action: {
    id: string;
    beforeAssertion: string;
    afterAssertion: string;
    beforeFrameHash: string;
    afterFrameHash: string;
    completedAtMs: number;
    beforeAtMs: number;
    afterAtMs: number;
    inkRegion: { left: number; top: number; width: number; height: number };
  };
  webm: { bytes: number; sha256: string; durationMs: number };
  mp4: { bytes: number; sha256: string; durationMs: number };
}
