import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

import {
  backendApiLabels,
  objectStoreLabels,
  platformLabels,
} from '../../../tools/cli/src/lib/compose/services/traefik-labels';
import { INGRESS_CLASS } from './config.js';

// The Kubernetes install guide gives each route the edge serves its own
// Ingress object, the counterpart of the router a Compose install declares in
// container labels, and gives the proxy the Role its Ingress provider reads
// them with. This suite holds every locale's manifests to those labels, and
// that Role to listing and watching its own namespace.
//
// The sandbox's device tunnel has no Ingress: the device hub runs only with
// the Docker backend (services/sandbox/src/config.ts).

const LOCALES = ['en', 'de', 'fr'];
const GUIDES = '$TURBO_ROOT$/docs/*/self-hosted/install/kubernetes.md';
const CLASS = 'kubernetes.io/ingress.class';
const ROUTER = 'traefik.ingress.kubernetes.io/router.';

interface IngressPath {
  path: string;
  pathType: string;
  backend: { service: { name: string; port: { name?: string } } };
}

interface EnvVar {
  name: string;
  valueFrom?: { fieldRef?: { fieldPath: string } };
}

interface Manifest {
  /** The file the guide saves it in, named on its block's first line. */
  file: string;
  apiVersion: string;
  kind: string;
  metadata: {
    name: string;
    namespace?: string;
    annotations?: Record<string, string>;
  };
  stringData?: Record<string, string>;
  spec?: {
    ingressClassName?: string;
    rules?: { host?: string; http: { paths: IngressPath[] } }[];
    ports?: { name: string; port: number }[];
    template?: {
      spec: {
        serviceAccountName?: string;
        containers: { name: string; env?: EnvVar[] }[];
      };
    };
  };
  rules?: { apiGroups: string[]; resources: string[]; verbs: string[] }[];
  roleRef?: { apiGroup: string; kind: string; name: string };
  subjects?: { kind: string; name: string; namespace?: string }[];
}

/** Every object of the blocks the guide saves as files (`# 30-proxy.yaml`). */
function manifests(locale: string): Manifest[] {
  const page = readFileSync(
    new URL(
      `../../../docs/${locale}/self-hosted/install/kubernetes.md`,
      import.meta.url,
    ),
    'utf8',
  ).replaceAll('\r\n', '\n');
  return [...page.matchAll(/```yaml\n# (\S+\.yaml)\n([\s\S]*?)```/g)].flatMap(
    ([, file, block]) =>
      block.split(/^---$/m).map((document) => ({
        ...(Bun.YAML.parse(document) as Omit<Manifest, 'file'>),
        file,
      })),
  );
}

/** A label as Compose hands it to Traefik: `$$` is a literal `$`, and
 *  `${NAME:-default}` reads the deployment's environment. */
function interpolate(value: string, env: Record<string, string>): string {
  return value.replace(
    /\$\$|\$\{(\w+):-([^}]*)\}/g,
    (_, name?: string, fallback?: string) =>
      name === undefined ? '$' : env[name] || (fallback ?? ''),
  );
}

interface Route {
  rule: string;
  priority: string;
  url: string;
  middlewares?: string;
  accesslogs?: string;
}

/** The routers of the platform, the backend and the object store. A router's
 *  health check has no Ingress counterpart: Traefik sends a request on
 *  Kubernetes only to a ready Pod. */
function routes(env: Record<string, string>): Map<string, Route> {
  const labels: Record<string, string> = {
    ...platformLabels(),
    ...backendApiLabels(),
    ...objectStoreLabels(),
  };
  const label = (key: string) => interpolate(labels[key] ?? '', env);
  const out = new Map<string, Route>();
  for (const key of Object.keys(labels)) {
    const name = /^traefik\.http\.routers\.([^.]+)\.rule$/.exec(key)?.[1];
    if (name === undefined) continue;
    const router = `traefik.http.routers.${name}`;
    out.set(name, {
      rule: label(`${router}.rule`),
      priority: label(`${router}.priority`),
      url: label(
        `traefik.http.services.${label(`${router}.service`)}.loadbalancer.server.url`,
      ),
      middlewares: labels[`${router}.middlewares`],
      accesslogs: labels[`${router}.observability.accesslogs`],
    });
  }
  return out;
}

/** The path from which Traefik's Ingress provider builds the router's rule.
 *  A regular expression needs ImplementationSpecific and the PathRegexp
 *  matcher, behind `/{0}`: Kubernetes requires the path to start with `/`,
 *  and `/{0}` matches the empty string, so the label's expression still
 *  starts the match. */
function ingressPath(rule: string): {
  path: string;
  pathType: string;
  matcher?: string;
} {
  const [, matcher, path] =
    /^(PathPrefix|Path|PathRegexp)\(`([^`]+)`\)$/.exec(rule) ?? [];
  if (matcher === 'PathPrefix' && path) return { path, pathType: 'Prefix' };
  if (matcher === 'Path' && path) return { path, pathType: 'Exact' };
  if (matcher === 'PathRegexp' && path)
    return {
      path: `/{0}${path}`,
      pathType: 'ImplementationSpecific',
      matcher,
    };
  throw new Error(`No Ingress path gives the rule ${rule}`);
}

/** What the API server refuses in an Ingress path (validateHTTPIngressPath in
 *  Kubernetes' networking validation). */
function pathRefusals({ path, pathType }: IngressPath): string[] {
  if (!path.startsWith('/')) return ['not an absolute path'];
  if (pathType === 'ImplementationSpecific') return [];
  return [
    ...['//', '/./', '/../', '%2f', '%2F'].filter((part) =>
      path.includes(part),
    ),
    ...['/..', '/.'].filter((suffix) => path.endsWith(suffix)),
  ];
}

describe.each(LOCALES)('the %s Kubernetes guide', (locale) => {
  const objects = manifests(locale);
  const named = (kind: string, name: string | undefined) =>
    objects.find(
      (object) => object.kind === kind && object.metadata.name === name,
    );
  const namespace = objects.find((object) => object.kind === 'Namespace')
    ?.metadata.name;
  const env = named('Secret', 'tale-env')?.stringData ?? {};
  const ingresses = objects.filter((object) => object.kind === 'Ingress');
  // An Ingress that names a class in spec.ingressClassName belongs to the
  // cluster's own controller: the proxy reads no IngressClass, so it skips it.
  const served = ingresses.filter(
    (ingress) => ingress.spec?.ingressClassName === undefined,
  );

  it('gives each router a Compose install declares its own Ingress', () => {
    const expected = routes(env);
    expect(served.map((ingress) => ingress.metadata.name).sort()).toEqual(
      [...expected.keys()].sort(),
    );
    for (const ingress of served) {
      const route = expected.get(ingress.metadata.name);
      if (!route) continue;
      const { path, pathType, matcher } = ingressPath(route.rule);
      const url = new URL(route.url);
      const service = named('Service', url.hostname);
      const port = service?.spec?.ports?.find(
        (entry) => entry.port === Number(url.port),
      );
      expect(ingress).toEqual({
        // Next to the Service it reaches, as a label sits on its container.
        file: service?.file ?? '',
        apiVersion: 'networking.k8s.io/v1',
        kind: 'Ingress',
        metadata: {
          name: ingress.metadata.name,
          namespace: namespace ?? '',
          annotations: {
            [CLASS]: INGRESS_CLASS,
            [`${ROUTER}priority`]: route.priority,
            ...(matcher && { [`${ROUTER}pathmatcher`]: matcher }),
            ...(route.middlewares && {
              [`${ROUTER}middlewares`]: route.middlewares,
            }),
            ...(route.accesslogs && {
              [`${ROUTER}observability.accesslogs`]: route.accesslogs,
            }),
          },
        },
        spec: {
          rules: [
            {
              http: {
                paths: [
                  {
                    path,
                    pathType,
                    backend: {
                      service: {
                        name: url.hostname,
                        port: { name: port?.name },
                      },
                    },
                  },
                ],
              },
            },
          ],
        },
      });
    }
  });

  it('writes every Ingress path the API server accepts', () => {
    const paths = ingresses.flatMap(
      (ingress) =>
        ingress.spec?.rules?.flatMap((rule) => rule.http.paths) ?? [],
    );
    expect(
      paths.flatMap((path) =>
        pathRefusals(path).map((refusal) => `${path.path}: ${refusal}`),
      ),
    ).toEqual([]);
  });

  it("leaves the outer controller's Ingress to that controller", () => {
    // The proxy would otherwise route every request back to itself.
    const outer = ingresses.filter(
      (ingress) => ingress.spec?.ingressClassName !== undefined,
    );
    expect(outer.map((ingress) => ingress.metadata.name)).toEqual([
      'tale-edge',
    ]);
    for (const ingress of outer)
      expect(ingress.metadata.annotations?.[CLASS]).toBeUndefined();
  });

  it('lets the proxy list and watch its own namespace, and nothing more', () => {
    const pod = named('Deployment', 'proxy')?.spec?.template?.spec;
    expect(pod?.containers[0]?.env).toContainEqual({
      name: 'TALE_PROXY_NAMESPACE',
      valueFrom: { fieldRef: { fieldPath: 'metadata.namespace' } },
    });
    const account = pod?.serviceAccountName;
    const bindings = objects.filter((object) =>
      object.subjects?.some(
        (subject) =>
          subject.kind === 'ServiceAccount' && subject.name === account,
      ),
    );
    expect(
      bindings.map((binding) => ({
        kind: binding.kind,
        namespace: binding.metadata.namespace,
        roleRef: binding.roleRef,
        subjects: binding.subjects,
      })),
    ).toEqual([
      {
        kind: 'RoleBinding',
        namespace: namespace ?? '',
        roleRef: {
          apiGroup: 'rbac.authorization.k8s.io',
          kind: 'Role',
          name: 'tale-proxy',
        },
        subjects: [{ kind: 'ServiceAccount', name: account ?? '', namespace }],
      },
    ]);
    const role = named('Role', 'tale-proxy');
    expect(role?.metadata.namespace).toBe(namespace ?? '');
    // Traefik's Ingress provider starts an informer for each of these four in
    // every namespace it watches, and serves no route until all four synced
    // (pkg/provider/kubernetes/ingress/client.go in Traefik v3.7).
    expect(
      role?.rules
        ?.flatMap(({ apiGroups, resources, verbs }) =>
          apiGroups.flatMap((group) =>
            resources.map(
              (resource) => `${verbs.join(',')} ${group || 'core'}/${resource}`,
            ),
          ),
        )
        .sort(),
    ).toEqual([
      'list,watch core/secrets',
      'list,watch core/services',
      'list,watch discovery.k8s.io/endpointslices',
      'list,watch networking.k8s.io/ingresses',
    ]);
  });
});

it('is run again by turbo when a file it reads outside the workspace changes', () => {
  const turbo = JSON.parse(
    readFileSync(new URL('../turbo.json', import.meta.url), 'utf8'),
  ) as { tasks: { test: { inputs: string[] } } };
  const { inputs } = turbo.tasks.test;
  expect(inputs.slice(0, 2)).toEqual(['$TURBO_EXTENDS$', '$TURBO_DEFAULT$']);
  expect(inputs).toContain(
    '$TURBO_ROOT$/tools/cli/src/lib/compose/services/traefik-labels.ts',
  );
  expect(inputs).toContain(GUIDES);
  const guides = new Bun.Glob(GUIDES.replace('$TURBO_ROOT$/', ''));
  for (const locale of LOCALES)
    expect(
      guides.match(`docs/${locale}/self-hosted/install/kubernetes.md`),
    ).toBe(true);
});
