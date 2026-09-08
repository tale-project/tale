import type { NodePlopAPI } from 'plop';

import { registerMigration } from './generators/migration';
import { registerPackage } from './generators/package';
import { registerService } from './generators/service';
import { registerSkill } from './generators/skill';
import { registerTool } from './generators/tool';
import { registerVideoEpisode } from './generators/video-episode';
import { registerHelpers } from './helpers';

export default function (plop: NodePlopAPI): void {
  registerHelpers(plop);
  registerPackage(plop);
  registerService(plop);
  registerTool(plop);
  registerSkill(plop);
  registerMigration(plop);
  registerVideoEpisode(plop);
}
