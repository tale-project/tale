import type { NodePlopAPI } from 'plop';

import { registerDockerService } from './tools/plop/generators/docker-service';
import { registerPythonPackage } from './tools/plop/generators/python-package';
import { registerPythonService } from './tools/plop/generators/python-service';
import { registerReactPackage } from './tools/plop/generators/react-package';
import { registerReactService } from './tools/plop/generators/react-service';
import { registerTypescriptPackage } from './tools/plop/generators/typescript-package';
import { registerHelpers } from './tools/plop/helpers';

export default function (plop: NodePlopAPI): void {
  registerHelpers(plop);
  registerReactService(plop);
  registerReactPackage(plop);
  registerTypescriptPackage(plop);
  registerPythonService(plop);
  registerPythonPackage(plop);
  registerDockerService(plop);
}
