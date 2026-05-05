import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineMessagesUsageTests } from '@tale/ui/i18n-tests';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVICE_ROOT = path.resolve(HERE, '../..');

defineMessagesUsageTests({
  serviceRoot: SERVICE_ROOT,
  allowlistDisplayPath: 'services/web/lib/i18n/keys-dynamic.txt',
});
