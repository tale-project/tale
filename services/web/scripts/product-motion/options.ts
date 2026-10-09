import { parseCaptureArgs } from '../../../platform/tests/docs-screenshots/capture-options';
import {
  PRODUCT_SCREENSHOT_LOCALES,
  PRODUCT_SCREENSHOTS,
} from '../../app/content/product-screenshots';

/** Motion uses every shipped native locale by default; docs retain English. */
export function productMotionArgs(argv: readonly string[]) {
  const args = parseCaptureArgs(argv);
  if (!argv.includes('--locales'))
    args.locales = [...PRODUCT_SCREENSHOT_LOCALES];
  const unknown = args.only.filter((page) => !(page in PRODUCT_SCREENSHOTS));
  if (unknown.length)
    throw new Error(`Unknown product motion page(s): ${unknown.join(', ')}`);
  return args;
}
