// The launch options the image's mmdc wrapper hands Mermaid's CLI
// (mmdc-puppeteer.json, baked as /opt/tale/puppeteer/mmdc.json), and the
// image settings that point puppeteer at the Playwright headless shell.
// Puppeteer launches that shell as a session needs it and no wider: the
// container is the boundary, so Chromium runs without its own sandbox, but it
// opens no debugging port, keeps web security and never downloads a browser
// of its own. The image test renders through all of it as uid 65534 on a
// read-only root; this test holds the settings themselves.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const RUNTIME = resolve(import.meta.dir, '../..');
const config: unknown = JSON.parse(
  readFileSync(join(RUNTIME, 'mmdc-puppeteer.json'), 'utf8'),
);
const wrapper = readFileSync(join(RUNTIME, 'mmdc'), 'utf8');
const dockerfile = readFileSync(join(RUNTIME, 'Dockerfile'), 'utf8');

/** The text of the Dockerfile's stage `name`, from its FROM to the next. */
function stage(name: string): string {
  const text = dockerfile
    .split(/^(?=FROM )/m)
    .find((part) => part.split('\n', 1)[0]?.endsWith(` AS ${name}`));
  if (text === undefined) throw new Error(`the Dockerfile has no ${name}`);
  return text;
}

describe("the puppeteer launch options of the image's mmdc", () => {
  test("launch the headless shell over a pipe, without Chromium's own sandbox or /dev/shm", () => {
    // A session has no user namespaces for Chromium's sandbox and a 64 MB
    // /dev/shm; the pipe replaces the DevTools port.
    expect(config).toEqual({
      headless: 'shell',
      pipe: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
  });

  test('open no debugging port, keep web security and name no browser of their own', () => {
    expect(config).toMatchObject({
      args: expect.not.arrayContaining([
        expect.stringMatching(
          /^--(remote-debugging-(address|port)|disable-web-security)(=|$)/,
        ),
      ]),
    });
    // The browser comes from PUPPETEER_EXECUTABLE_PATH alone, so mmdc and a
    // script's own require('puppeteer') launch the same baked shell.
    expect(config).not.toHaveProperty('executablePath');
  });

  test('the wrapper on PATH passes them to the baked mmdc ahead of the caller', () => {
    // A -p of the caller's own comes later and replaces them.
    expect(wrapper.trimEnd().split('\n').at(-1)).toBe(
      'exec /opt/tale/document-node/node_modules/.bin/mmdc -p /opt/tale/puppeteer/mmdc.json "$@"',
    );
    expect(stage('runtime')).toMatch(
      /^COPY services\/sandbox-runtime\/mmdc-puppeteer\.json \/opt\/tale\/puppeteer\/mmdc\.json$/m,
    );
    expect(stage('runtime')).toMatch(
      /^COPY --chmod=755 services\/sandbox-runtime\/mmdc \/usr\/local\/bin\/mmdc$/m,
    );
  });
});

describe('puppeteer in the runtime image', () => {
  test("launches the Playwright headless shell through a link to its manifest's executable", () => {
    expect(stage('playwright-build')).toContain(
      "fs.symlinkSync(manifest.executablePath, '/opt/tale/puppeteer/headless-shell')",
    );
    expect(stage('runtime')).toMatch(
      /^COPY --link --from=playwright-build \/opt\/tale\/puppeteer\/ \/opt\/tale\/puppeteer\/$/m,
    );
    expect(stage('runtime')).toMatch(
      /^ENV PUPPETEER_EXECUTABLE_PATH=\/opt\/tale\/puppeteer\/headless-shell$/m,
    );
  });

  test('downloads no browser of its own, at the install or in a session', () => {
    // puppeteer's install script is the download; --ignore-scripts skips it,
    // and the setting holds should a script run anyway.
    expect(stage('document-node-build')).toMatch(
      /^RUN npm ci --prefix \/opt\/tale\/document-node --ignore-scripts /m,
    );
    for (const name of ['document-node-build', 'runtime']) {
      expect(stage(name)).toMatch(/^ENV PUPPETEER_SKIP_DOWNLOAD=true$/m);
    }
  });
});
