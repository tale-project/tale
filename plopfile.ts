import type { NodePlopAPI } from 'plop';

import { registerDockerService } from './tools/plop/generators/docker-service';
import { registerReactPackage } from './tools/plop/generators/react-package';
import { registerReactService } from './tools/plop/generators/react-service';
import { registerTool } from './tools/plop/generators/tool';
import { registerTypescriptPackage } from './tools/plop/generators/typescript-package';
import { registerHelpers } from './tools/plop/helpers';

export default function (plop: NodePlopAPI): void {
  registerHelpers(plop);
  registerReactService(plop);
  registerReactPackage(plop);
  registerTypescriptPackage(plop);
  registerDockerService(plop);
  registerTool(plop);
}
