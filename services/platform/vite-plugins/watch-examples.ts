import path from 'node:path';
import { type Plugin } from 'vite';

export function watchExamples(): Plugin {
  const examplesDir = path.resolve(__dirname, '..', '..', '..', 'examples');

  return {
    name: 'watch-examples',
    apply: 'serve',
    configureServer(server) {
      server.watcher.add(examplesDir);
      server.watcher.on('change', (filePath) => {
        if (filePath.startsWith(examplesDir) && filePath.endsWith('.json')) {
          server.ws.send({ type: 'full-reload' });
        }
      });
    },
  };
}
