import type { NodePlopAPI } from 'plop';

import { registerMigration } from './tools/plop/generators/migration';
import { registerPackage } from './tools/plop/generators/package';
import { registerService } from './tools/plop/generators/service';
import { registerSkill } from './tools/plop/generators/skill';
import { registerTool } from './tools/plop/generators/tool';
import { registerHelpers } from './tools/plop/helpers';

export default function (plop: NodePlopAPI): void {
  registerHelpers(plop);
  registerPackage(plop);
  registerService(plop);
  registerTool(plop);
  registerSkill(plop);
  registerMigration(plop);
}
