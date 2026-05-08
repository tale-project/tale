import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineMessagesParityTests } from '@tale/ui/i18n-tests';

const HERE = path.dirname(fileURLToPath(import.meta.url));

defineMessagesParityTests({
  messagesDir: path.resolve(HERE, '../../messages'),
});
