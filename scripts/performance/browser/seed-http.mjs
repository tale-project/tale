// Synthetic accounts through the real local API; no saved credentials.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';

import { z } from 'zod';

import { browserOrigins } from './origins.mjs';
const ROUND = process.argv[2] ?? 'r1';
const BASE = process.env.BENCH_URL;
const OUT = process.env.BENCH_OUTPUT;
assert(BASE && OUT, 'Diagnostic URL and output directory are required');
assert.equal(BASE, browserOrigins[0], 'Synthetic seeding is loopback-only');
assert.match(ROUND, /^[a-z0-9-]+$/);
mkdirSync(OUT, { recursive: true });
const id = z.string().regex(/^[A-Za-z0-9_-]+$/);
const password = process.env.BENCH_PASSWORD;
if (!password || !BASE || !OUT)
  throw new Error('missing diagnostic environment');

function cookieJar() {
  const jar = new Map();
  return {
    header: () => [...jar].map(([k, v]) => `${k}=${v}`).join('; '),
    take(res) {
      for (const line of res.headers.getSetCookie?.() ?? []) {
        const [pair] = line.split(';');
        const eq = pair.indexOf('=');
        jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
      }
    },
  };
}

async function call(jar, method, path, body, origin = BASE) {
  assert(browserOrigins.includes(origin), 'Unowned synthetic auth origin');
  const res = await fetch(origin + path, {
    method,
    signal: AbortSignal.timeout(30000),
    headers: {
      origin,
      'content-type': 'application/json',
      ...(jar ? { cookie: jar.header() } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  jar?.take(res);
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}`);
  return json;
}

const people = [
  { name: 'Mara Perf', email: `mara.${ROUND}@perf.invalid` },
  { name: 'Jonas Keller', email: `jonas.${ROUND}@perf.invalid` },
  { name: 'Aiko Tanaka', email: `aiko.${ROUND}@perf.invalid` },
  { name: 'Lucas Moreau', email: `lucas.${ROUND}@perf.invalid` },
  { name: 'Priya Raman', email: `priya.${ROUND}@perf.invalid` },
];
const jars = [];
const userIds = [];
for (const person of people) {
  const jar = cookieJar();
  const out = await call(jar, 'POST', '/api/auth/sign-up/email', {
    ...person,
    password,
  });
  jars.push(jar);
  userIds.push(z.object({ user: z.object({ id }) }).parse(out).user.id);
}
const owner = jars[0];
const org = z.object({ id, slug: id }).parse(
  await call(owner, 'POST', '/api/auth/organization/create', {
    name: 'Perf Synthetic Co',
    slug: `perf-${ROUND}`,
    metadata: { creatorId: userIds[0], defaultLocale: 'en' },
  }),
);
await call(owner, 'POST', '/api/auth/organization/set-active', {
  organizationId: org.id,
});
const projects = {};
for (const [size, key, name] of [
  ['small', 'SML', 'Website relaunch'],
  ['large', 'LRG', 'Support operations'],
]) {
  const out = await call(owner, 'POST', `/api/app/projects?orgId=${org.id}`, {
    name,
    key,
  });
  projects[size] = z.object({ projectId: id }).parse(out).projectId;
}
const ids = {
  round: ROUND,
  orgId: org.id,
  orgSlug: org.slug,
  ownerEmail: people[0].email,
  userIds,
  emails: people.map((p) => p.email),
  names: people.map((p) => p.name),
  projectNames: { small: 'Website relaunch', large: 'Support operations' },
  projects,
};
writeFileSync(`${OUT}/seed-ids.json`, JSON.stringify(ids, null, 2));
const verifiedOrigins = [];
for (const origin of browserOrigins) {
  const jar = cookieJar();
  const signedIn = z.object({ user: z.object({ id }) }).parse(
    await call(
      jar,
      'POST',
      '/api/auth/sign-in/email',
      {
        email: people[0].email,
        password,
      },
      origin,
    ),
  );
  assert.equal(signedIn.user.id, userIds[0]);
  const session = z
    .object({ user: z.object({ id }) })
    .parse(await call(jar, 'GET', '/api/auth/get-session', undefined, origin));
  assert.equal(session.user.id, userIds[0]);
  verifiedOrigins.push({
    origin,
    userId: session.user.id,
    signIn: true,
    session: true,
  });
  writeFileSync(
    `${OUT}/auth-origins.json`,
    JSON.stringify(
      {
        complete: verifiedOrigins.length === browserOrigins.length,
        origins: verifiedOrigins,
      },
      null,
      2,
    ),
  );
}
// Synthetic login secret stays in process environment; never write it.
