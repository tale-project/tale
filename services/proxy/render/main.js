// Renders the edge's configuration at boot (config.js, pki.js). tale-proxy
// runs it with the njs that ships in the image:
//
//   njs -n QuickJS -m main.js
//
// It writes Traefik's static configuration, the edge's dynamic files and
// the responder's nginx configuration under TALE_PROXY_RUN_DIR, and `ready`
// last. A refusal prints its lines to stderr and writes no `ready`, which
// tale-proxy turns into exit 1: njs has no process.exit. On an install
// upgraded from the Caddy edge it first takes over that edge's certificates
// (caddy.js).
import fs from 'fs';

import { caddyAcme, caddyRoot } from './caddy.js';
import {
  ConfigError,
  describe,
  leafHosts,
  readSettings,
  renderAcmeHosts,
  renderEdge,
  renderResponder,
  renderStatic,
  renderTls,
  RESOLVER,
} from './config.js';
import { ensureCertificates } from './pki.js';

const env = process.env;
const run = env.TALE_PROXY_RUN_DIR || '/run/tale-proxy';
const paths = {
  run,
  dynamic: `${run}/dynamic`,
  data: env.TALE_PROXY_DATA_DIR || '/data',
  // The Caddy edge's data volume, mounted read-only (compose.yml).
  caddy: '/caddy-data',
  share: env.TALE_PROXY_SHARE_DIR || '/usr/share/tale-proxy',
};

const stderr = (text) => fs.appendFileSync('/dev/stderr', `${text}\n`);

function read(path) {
  try {
    return fs.readFileSync(path, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

/** Reads a file of the Caddy volume; one it cannot read counts as absent. */
function readCaddy(path) {
  try {
    return read(path);
  } catch (error) {
    stderr(`TLS: ${path} cannot be read (${error.message}), left out.`);
    return null;
  }
}

/** Writes through a temporary file, so Traefik never reads half a file. */
function write(path, text, mode) {
  const temporary = `${path}.tmp`;
  try {
    fs.unlinkSync(temporary);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  fs.writeFileSync(temporary, text, { mode: mode || 0o644 });
  fs.renameSync(temporary, path);
}

const yaml = (value) => `${JSON.stringify(value, null, 2)}\n`;

async function main() {
  let settings;
  try {
    settings = readSettings(env);
  } catch (error) {
    if (error instanceof ConfigError) {
      stderr(error.lines.join('\n'));
      return;
    }
    throw error;
  }
  console.log(describe(settings).join('\n'));

  let leaf = null;
  if (settings.mode === 'selfsigned') {
    leaf = await ensureCertificates({
      dir: `${paths.data}/pki`,
      hosts: leafHosts(settings),
      now: Date.now(),
      io: { read, write },
      crypto,
      adopt: caddyRoot({ dir: paths.caddy, io: { read: readCaddy } }),
    });
    for (const action of leaf.actions) console.log(`TLS: ${action}`);
    console.log(
      `TLS: the leaf is valid until ${new Date(leaf.notAfter).toISOString()}`,
    );
  }

  // acme.json is absent until Traefik first starts on this volume and
  // writes it: what the Caddy edge kept is taken over once, before that.
  const acme = `${paths.data}/acme.json`;
  if (settings.mode === 'letsencrypt' && read(acme) === null) {
    const carried = await caddyAcme({
      dir: paths.caddy,
      hosts: settings.hostnames,
      resolver: RESOLVER,
      now: Date.now(),
      io: { read: readCaddy },
      crypto,
    });
    for (const action of carried.actions) console.log(`TLS: ${action}`);
    if (carried.storage) {
      write(acme, `${JSON.stringify(carried.storage, null, 2)}\n`, 0o600);
    }
  }

  write(`${paths.run}/traefik.yml`, yaml(renderStatic(settings, paths)));
  write(`${paths.run}/responder.conf`, renderResponder(settings, paths));
  write(`${paths.run}/acme-hosts`, renderAcmeHosts(settings));
  write(`${paths.dynamic}/edge.yml`, yaml(renderEdge(settings)));
  write(`${paths.dynamic}/tls.yml`, yaml(renderTls(settings, leaf)), 0o600);
  write(`${paths.run}/ready`, '');
}

main().catch((error) => {
  stderr(
    `Error: the proxy could not render its configuration: ${error.message}`,
  );
});
