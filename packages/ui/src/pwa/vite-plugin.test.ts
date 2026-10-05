import { execFile } from 'node:child_process';
import {
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
  mkdir,
  symlink,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { expect, it } from 'vitest';

const run = promisify(execFile);

it('changes the built worker for a code-only release and keeps builds deterministic', async () => {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'tale-pwa-build-')),
  );
  try {
    await mkdir(join(directory, 'public'));
    await symlink(
      join(process.cwd(), '../../node_modules'),
      join(directory, 'node_modules'),
      'dir',
    );
    await writeFile(join(directory, 'public', 'icon.png'), 'fixture');
    await writeFile(
      join(directory, 'public', 'offline.html'),
      '<!doctype html>offline',
    );
    await writeFile(
      join(directory, 'index.html'),
      '<!doctype html><script type="module" src="/main.js"></script>',
    );
    const plugin = join(process.cwd(), 'src/pwa/vite-plugin.ts');
    const script = `
      import { build } from ${JSON.stringify(import.meta.resolve('vite'))};
      import { createPwaPlugin } from ${JSON.stringify(plugin)};
      import { readFile, writeFile } from 'node:fs/promises';
      const root = ${JSON.stringify(directory)};
      const result = [];
      for (const version of [1, 1, 2]) {
        await writeFile(root + '/main.js', 'import { registerSW } from "virtual:pwa-register"; registerSW({immediate:true}); document.title = "release ' + version + '"');
        await build({ configFile: false, root, base: './', logLevel: 'silent', plugins: createPwaPlugin({
          name: 'Fixture', shortName: 'Fixture', description: 'Fixture', themeColor: '#fff', backgroundColor: '#fff',
          projectDir: root, icons: [{src:'icon.png',sizes:'192x192',type:'image/png'}], includeAssets: ['offline.html'],
        }) });
        const manifest = JSON.parse(await readFile(root + '/dist/pwa-build.json', 'utf8'));
        const chunks = await Promise.all(manifest.assets.filter(name=>name.endsWith('.js')).map(name=>readFile(root+'/dist/'+name,'utf8')));
        result.push({ sw: await readFile(root + '/dist/sw.js', 'utf8'), manifest, chunks: chunks.join(' '), webmanifest: JSON.parse(await readFile(root+'/dist/manifest.webmanifest','utf8')) });
      }
      await writeFile(root + '/results.json', JSON.stringify(result));
    `;
    await run('bun', ['--eval', script], {
      timeout: 45_000,
      maxBuffer: 1024 * 1024,
    });
    const result = JSON.parse(
      await readFile(join(directory, 'results.json'), 'utf8'),
    ) as Array<{
      sw: string;
      manifest: { revision: string; assets: string[] };
      chunks: string;
      webmanifest: {
        scope: string;
        start_url: string;
        icons: Array<{ src: string }>;
      };
    }>;
    expect(result[0]?.sw).toBe(result[1]?.sw);
    expect(result[0]?.manifest.revision).toBe(result[1]?.manifest.revision);
    expect(result[2]?.manifest.revision).not.toBe(result[0]?.manifest.revision);
    expect(result[2]?.sw).not.toBe(result[0]?.sw);
    expect(
      result[2]?.manifest.assets.some((name) => /^assets\/.*\.js$/.test(name)),
    ).toBe(true);
    expect(result[2]?.sw).toContain('pwa-recovery.js');
    expect(result[2]?.sw).toContain('pwa-build.json');
    expect(result[2]?.sw).not.toContain('importScripts(');
    expect(result[2]?.chunks).not.toMatch(/["'`]\/sw\.js["'`]/);
    expect(result[2]?.chunks).toMatch(/["'`](?:\.\/)?sw\.js["'`]/);
    expect(result[2]?.webmanifest).toMatchObject({
      scope: './',
      start_url: './',
      icons: [{ src: 'icon.png' }],
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 50_000);
