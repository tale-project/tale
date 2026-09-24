---
title: Auf Kubernetes bereitstellen
description: Wende einen vollständigen Satz Kubernetes-Manifeste für Tale an, betreibe den Sandbox-Spawner mit seinem nativen Backend und prüfe Isolation, Sitzungslebenszyklus und Rollouts, bevor du Nutzer zulässt.
---

Tale läuft auf Kubernetes, wenn du den [Dienstvertrag](/de/self-hosted/install/own-compose) in Deployments, Services und Volumes überträgst und den Sandbox-Spawner auf `SANDBOX_BACKEND=kubernetes` umstellst. Ein offizielles Helm-Chart gibt es nicht. Diese Anleitung enthält einen vollständigen Manifestsatz für einen Namespace, der mit Tale 0.5.31 auf einem Cluster mit einem Node von Anfang bis Ende durchgespielt wurde, zusammen mit den Prüfungen, die das Ergebnis belegen. Cluster, Speicher, öffentlicher Zugang und Rollout-Ablauf bleiben in deiner Verantwortung.

## Voraussetzungen prüfen

| Voraussetzung | Grund |
| --- | --- |
| Ein CNI, das NetworkPolicy durchsetzt, etwa Calico, Cilium oder kube-network-policies | Die Egress-Sperre der Sandbox und die Sperre des Backends sind NetworkPolicy-Objekte. Jeder API-Server nimmt sie an; erst das CNI blockiert damit Verkehr. |
| Eine Standard-StorageClass, deren `ReadWriteOnce`-Volumes dort wieder eingebunden werden, wo ein Pod eingeplant wird | Datenbank, Objektspeicher, Proxy-Zertifikate, Gateway-Zustand und jeder Sandbox-Workspace liegen auf PersistentVolumeClaims. |
| `ReadWriteMany`-Speicher oder ein einzelner Node für die Organisationskonfiguration | Die Backend-Rollen schreiben `config-data`; Web-Ebene und Spawner lesen es. Auf einem Node genügt `ReadWriteOnce`. Mehrere Nodes brauchen `ReadWriteMany` oder eine Node-Bindung für diese Pods. |
| Nodes, die `NET_ADMIN` gewähren und ip6tables bereitstellen oder die IPv6-Sysctls erlauben | Der Egress-Proxy installiert beim Start seine Firewall und verweigert den Start ohne sie. |
| Ports 80 und 443 unter der öffentlichen Adresse erreichbar | Caddy besorgt sich im Modus `selfsigned` und `letsencrypt` die Zertifikate selbst. Hinter einem Ingress, der TLS terminiert, setzt du `TLS_MODE=external`. |
| Pull-Zugriff auf `ghcr.io/tale-project/tale/*` auf jedem Node, einschließlich des Sandbox-Runtime-Images | Sitzungs-Pods starten aus `SANDBOX_RUNTIME_IMAGE`. Ein Node, der es nicht laden kann, lässt die erste dort eingeplante Sitzung scheitern. |
| Eine sysbox- oder kata-RuntimeClass, wenn Agenten Docker in ihrer Sandbox brauchen | Ohne sie bleibt `SANDBOX_DOCKER_IN_CONTAINER=false`. Die Stufe `runc` bräuchte privilegierte Pods. |
| `kubectl` und `envsubst` auf dem Rechner, der die Manifeste anwendet | Die Manifeste enthalten eine Variable `${VERSION}`, die kubectl nicht expandiert. |

Reserviere Arbeitsspeicher für die Anwendungsrollen plus eine Agentensitzung je gleichzeitiger Aufgabe; `SANDBOX_AGENT_MEMORY` und die übrigen Sitzungslimits stehen in der [Umgebungsreferenz](/de/self-hosted/configuration/environment-reference#sandbox-infrastructure).

## Den Namespace aufteilen

Alle Dienste laufen in einem Namespace, `tale`. Sitzungs-Pods müssen `backend-api` und `sandbox-llm-gateway` direkt erreichen, und die Egress-Sperre, die der Spawner anlegt, erlaubt nur den Namespace, in dem er läuft. Deshalb gehören auch die Anwendungsrollen dorthin. Die Service-Namen entsprechen den Compose-Dienstnamen: Die Images lösen `db`, `knowledge-db`, `object-store`, `backend-api`, `platform`, `sandbox`, `sandbox-egress`, `sandbox-llm-gateway` samt Alias `llm-gateway` und `bgutil-provider` über den Namen auf.

<Warning>

Jeder Pod unten setzt `enableServiceLinks: false`. Andernfalls injiziert Kubernetes für jeden Service im Namespace Variablen im Docker-Stil, etwa `SANDBOX_PORT=tcp://10.96.6.49:8003` und `DB_PORT=tcp://10.96.150.113:5432`. Der Spawner liest `SANDBOX_PORT` als seinen Listen-Port und beendet sich beim Start, und das Platform-Image leitet seine Datenbank-URL aus `DB_PORT` ab.

</Warning>

| Compose-Dienst | Kubernetes-Objekte | Hinweise |
| --- | --- | --- |
| `db` mit Alias `knowledge-db` | StatefulSet `db`; Services `db` und `knowledge-db` auf denselben Pod | `TALE_DB_ROLE` bleibt ungesetzt: Das Image legt beide Datenbanken an und wendet die Wissensmigrationen an; das Backend migriert das Anwendungsschema beim Start. Ein `emptyDir` im Arbeitsspeicher mit 256 MiB dient als `/dev/shm`. Das Image stoppt mit `SIGINT` innerhalb von 60 Sekunden Frist. |
| `object-store` | Deployment mit Strategie `Recreate`, PVC unter `/data`, Service auf 9000 | Das Backend legt den Bucket beim Start an. |
| `platform` | Deployment; Service auf 3000 | `config-data` nur lesend, `TALE_BACKEND_URL=http://backend-api:3005`. |
| `backend-api` | Deployment mit zwei Replikaten; Service auf 3005 | `config-data` lesend und schreibend. Zwei Replikate ermöglichen einen Rollout ohne Lücke. |
| `backend-worker` | Deployment | Kein Service und keine HTTP-Prüfung. |
| `proxy` | Deployment mit Strategie `Recreate`; `hostPort` 80 und 443; PVC für `/data` | Der Zertifikatspeicher überlebt Neustarts auf dem PVC. |
| `sandbox` | ServiceAccount, Role, RoleBinding, Deployment; Service auf 8003 | `SANDBOX_BACKEND=kubernetes`; `config-data` nur lesend unter `/app/platform-config`. Kein Docker-Socket. |
| `sandbox-egress` | Deployment; Service auf 3128 | Der ausgelieferte Capability-Satz, keine Sysctls. |
| `sandbox-llm-gateway` | Deployment mit Strategie `Recreate`, PVC unter `/app/data`; Services `sandbox-llm-gateway` und `llm-gateway` auf 8080 | Das Image läuft als uid 1000; `fsGroup: 1000` lässt es seinen Zustand schreiben. |
| `bgutil-provider` | Deployment; Service auf 4416 | Optionaler Token-Anbieter für Videos. |

Die Prüfungen übertragen die Compose-Healthchecks:

| Dienst | Startprüfung | Bereitschaftsprüfung | Lebendigkeitsprüfung |
| --- | --- | --- | --- |
| `backend-api` | `GET /ping` auf 3005, bis zu fünf Minuten für Migrationen | `GET /ready` auf 3005 | `GET /ping` auf 3005 |
| `platform` | `curl -sf http://localhost:3000/api/health && [ -f /tmp/platform-ready ]`, bis zu drei Minuten | derselbe Befehl | keine |
| `db` | `pg_isready -U tale -d tale && [ -f /tmp/.db_ready ]`, bis zu drei Minuten | derselbe Befehl | `pg_isready -U tale -d tale` |
| `object-store` | keine | `mc ready local` | keine |
| `proxy` | keine | `GET /health` auf 2020 | keine |
| `sandbox` | `GET /health` auf 8003 | `GET /health` auf 8003 | keine |
| `sandbox-egress` | keine | `curl -sS -o /dev/null --max-time 3 --noproxy '*' http://127.0.0.1:3128/` | keine |
| `sandbox-llm-gateway` | keine | `GET /health` auf 8080 | keine |

Kubernetes kennt kein `depends_on`. Eine Backend-Rolle, die startet, bevor Postgres antwortet, beendet sich einmal mit `ECONNREFUSED`; die Neustartrichtlinie heilt das.

## Die Manifeste vorbereiten

Speichere jeden YAML-Block der folgenden Abschnitte unter dem Dateinamen aus seiner ersten Zeile in einem Verzeichnis. Bearbeite das Secret: Ersetze jeden Platzhalter `<...>` und setze `HOST`, `SITE_URL`, `TLS_MODE` und `OBJECT_STORE_PUBLIC_ENDPOINT` für deine Adresse. Enthält diese Adresse einen abweichenden Port, trage ihn auch als `containerPort` und `hostPort` des Proxys in `30-proxy.yaml` ein; Caddy lauscht auf dem Port aus `SITE_URL`. Lege dann eine Version für alle Tale-Images fest, zum Zeitpunkt dieser Anleitung `0.5.31`, und wende die Dateien der Reihe nach an:

```bash
export VERSION=0.5.31
for f in 00-namespace.yaml 10-stores.yaml 20-application.yaml 30-proxy.yaml 40-sandbox.yaml; do
  envsubst '${VERSION}' < "$f" | kubectl apply -f -
done
```

`envsubst` ersetzt nur `${VERSION}`; jeder andere Wert in den Dateien ist wörtlich gemeint. Dieselbe Schleife führt ein Upgrade aus: Ändere `VERSION`, starte sie erneut, und die Deployments rollen auf das neue Image.

## Die gemeinsame Umgebung anlegen

Die erste Datei enthält den Namespace, die deploymentweiten Werte aus der Compose-`.env` und den gemeinsamen Konfigurations-Claim. Erzeuge jedes Geheimnis einmal und bewahre es auf; besonders `ENCRYPTION_SECRET_HEX` muss für vorhandene verschlüsselte Werte stabil bleiben. Die [Umgebungsreferenz](/de/self-hosted/configuration/environment-reference) erklärt jede Variable.

```yaml
# 00-namespace.yaml
apiVersion: v1
kind: Namespace
metadata: { name: tale }
---
apiVersion: v1
kind: Secret
metadata: { name: tale-env, namespace: tale }
type: Opaque
stringData:
  HOST: tale.example.com
  SITE_URL: https://tale.example.com
  TLS_MODE: letsencrypt
  POSTGRES_USER: tale
  POSTGRES_DB: tale
  DB_PASSWORD: <generated>
  DATABASE_URL: postgresql://tale:<DB_PASSWORD>@db:5432/tale_app
  KNOWLEDGE_DB_NAME: tale_knowledge
  INSTANCE_SECRET: <openssl rand -hex 32>
  BETTER_AUTH_SECRET: <openssl rand -hex 32>
  ENCRYPTION_SECRET_HEX: <openssl rand -hex 32>
  TALE_AUDIT_SIGNING_KEY: <openssl rand -hex 32>
  TALE_AUDIT_PEPPER: <openssl rand -hex 32>
  SANDBOX_TOKEN: <openssl rand -hex 32>
  SANDBOX_LLM_GATEWAY_ADMIN_PASSWORD: <generated>
  OBJECT_STORE_ACCESS_KEY: tale
  OBJECT_STORE_SECRET_KEY: <generated>
  OBJECT_STORE_BUCKET: tale-blobs
  OBJECT_STORE_ENDPOINT: http://object-store:9000
  OBJECT_STORE_REGION: us-east-1
  OBJECT_STORE_PUBLIC_ENDPOINT: https://tale.example.com
---
# Organisationskonfiguration: Backend-Rollen schreiben, Platform und Spawner lesen.
# Auf einem Node genügt ReadWriteOnce; mehrere Nodes brauchen ReadWriteMany.
apiVersion: v1
kind: PersistentVolumeClaim
metadata: { name: config-data, namespace: tale }
spec:
  accessModes: [ReadWriteOnce]
  resources: { requests: { storage: 2Gi } }
```

`DATABASE_URL` enthält dasselbe Passwort wie `DB_PASSWORD`; die Wissensverbindung verwendet standardmäßig `knowledge-db:5432/tale_knowledge` mit diesem Passwort. `SITE_URL` muss der Adresse im Browser entsprechen, einschließlich eines abweichenden Ports.

## Die Speicher betreiben

Das StatefulSet behält das Datenvolume über Pod-Ersetzungen hinweg und gibt dem Image das Herunterfahren, das es erwartet. MinIO läuft als einzelnes Deployment auf einem eigenen Claim.

```yaml
# 10-stores.yaml
apiVersion: v1
kind: Service
metadata: { name: db, namespace: tale }
spec:
  selector: { app: db }
  ports: [{ name: pg, port: 5432, targetPort: 5432 }]
---
apiVersion: v1
kind: Service
metadata: { name: knowledge-db, namespace: tale }
spec:
  selector: { app: db }
  ports: [{ name: pg, port: 5432, targetPort: 5432 }]
---
apiVersion: apps/v1
kind: StatefulSet
metadata: { name: db, namespace: tale }
spec:
  serviceName: db
  replicas: 1
  selector: { matchLabels: { app: db } }
  template:
    metadata: { labels: { app: db } }
    spec:
      enableServiceLinks: false
      terminationGracePeriodSeconds: 60
      containers:
        - name: postgres
          image: ghcr.io/tale-project/tale/tale-db:${VERSION}
          envFrom: [{ secretRef: { name: tale-env } }]
          ports: [{ name: pg, containerPort: 5432 }]
          volumeMounts:
            - { name: data, mountPath: /var/lib/postgresql/data }
            - { name: shm, mountPath: /dev/shm }
          startupProbe:
            exec: { command: [sh, -c, 'pg_isready -U tale -d tale && [ -f /tmp/.db_ready ]'] }
            periodSeconds: 5
            failureThreshold: 36
          readinessProbe:
            exec: { command: [sh, -c, 'pg_isready -U tale -d tale && [ -f /tmp/.db_ready ]'] }
            periodSeconds: 5
          livenessProbe:
            exec: { command: [sh, -c, 'pg_isready -U tale -d tale'] }
            periodSeconds: 15
          resources:
            requests: { cpu: 250m, memory: 512Mi }
      volumes:
        - name: shm
          emptyDir: { medium: Memory, sizeLimit: 256Mi }
  volumeClaimTemplates:
    - metadata: { name: data }
      spec:
        accessModes: [ReadWriteOnce]
        resources: { requests: { storage: 20Gi } }
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata: { name: object-store-data, namespace: tale }
spec:
  accessModes: [ReadWriteOnce]
  resources: { requests: { storage: 20Gi } }
---
apiVersion: v1
kind: Service
metadata: { name: object-store, namespace: tale }
spec:
  selector: { app: object-store }
  ports: [{ name: s3, port: 9000, targetPort: 9000 }]
---
apiVersion: apps/v1
kind: Deployment
metadata: { name: object-store, namespace: tale }
spec:
  replicas: 1
  strategy: { type: Recreate }
  selector: { matchLabels: { app: object-store } }
  template:
    metadata: { labels: { app: object-store } }
    spec:
      enableServiceLinks: false
      terminationGracePeriodSeconds: 30
      containers:
        - name: minio
          image: ghcr.io/tale-project/ops/minio:RELEASE.2025-04-22T22-12-26Z
          args: ['server', '/data', '--address', ':9000', '--console-address', ':9001']
          env:
            - name: MINIO_ROOT_USER
              valueFrom: { secretKeyRef: { name: tale-env, key: OBJECT_STORE_ACCESS_KEY } }
            - name: MINIO_ROOT_PASSWORD
              valueFrom: { secretKeyRef: { name: tale-env, key: OBJECT_STORE_SECRET_KEY } }
            - { name: MINIO_BROWSER, value: 'off' }
          ports: [{ name: s3, containerPort: 9000 }]
          volumeMounts: [{ name: data, mountPath: /data }]
          readinessProbe:
            exec: { command: [sh, -c, 'mc ready local'] }
            periodSeconds: 10
          resources:
            requests: { cpu: 100m, memory: 256Mi }
      volumes:
        - name: data
          persistentVolumeClaim: { claimName: object-store-data }
```

Für ein externes Postgres setzt du `DATABASE_URL` und `KNOWLEDGE_DATABASE_URL` wie unter [Externe Speicher verbinden](/de/self-hosted/install/own-compose#externe-speicher-verbinden) beschrieben und lässt StatefulSet und Services weg; für einen externen Bucket setzt du die `OBJECT_STORE_*`-Werte und lässt die MinIO-Objekte weg.

## Die Anwendungsrollen betreiben

Die drei Rollen teilen sich das Platform-Image: API und Worker schreiben `config-data`, die Web-Ebene liest es. Die Datei enthält außerdem den optionalen Token-Anbieter für Videos, den der Worker nutzt; entferne seine beiden Objekte, wenn du keine Videos aufnimmst.

<Warning>

Die Backend-Rollen laufen ohne `NET_ADMIN` und mit `TALE_SKIP_SSRF_FIREWALL=1`. Mit dieser Capability installiert das Image seine iptables-Egress-Sperre, die nur die direkt angebundenen Subnetze des Pods erlaubt und den übrigen privaten Adressraum abweist. In einem Pod-Netz trifft das auch den Cluster-DNS und jede Service-Adresse: Die Rolle scheitert mit `getaddrinfo EAI_AGAIN db` und startet neu, bis du die Capability entfernst. Die NetworkPolicy am Ende der Datei übernimmt die Sperre: Die Rollen erreichen jeden Nachbarn im Namespace, den Cluster-DNS und das öffentliche Internet, aber nie den Cloud-Metadatendienst, die Nodes oder private Netze. Erweitere ihre letzte Regel, wenn deine Modellanbieter oder Konnektoren in einem privaten Bereich liegen.

</Warning>

```yaml
# 20-application.yaml
apiVersion: v1
kind: Service
metadata: { name: backend-api, namespace: tale }
spec:
  selector: { app: backend-api }
  ports: [{ name: http, port: 3005, targetPort: 3005 }]
---
apiVersion: apps/v1
kind: Deployment
metadata: { name: backend-api, namespace: tale }
spec:
  replicas: 2
  selector: { matchLabels: { app: backend-api } }
  template:
    metadata: { labels: { app: backend-api, tale.tier: backend } }
    spec:
      enableServiceLinks: false
      terminationGracePeriodSeconds: 45
      containers:
        - name: backend-api
          image: ghcr.io/tale-project/tale/tale-platform:${VERSION}
          envFrom: [{ secretRef: { name: tale-env } }]
          env:
            - { name: TALE_ROLE, value: api }
            - { name: PORT, value: '3005' }
            - { name: TALE_CONFIG_DIR, value: /app/data }
            - { name: SANDBOX_URL, value: http://sandbox:8003 }
            - { name: SANDBOX_HTTP_API_BASE_URL, value: http://backend-api:3005 }
            - { name: TALE_SKIP_SSRF_FIREWALL, value: '1' }
          ports: [{ name: http, containerPort: 3005 }]
          volumeMounts: [{ name: config-data, mountPath: /app/data }]
          startupProbe:
            httpGet: { path: /ping, port: 3005 }
            periodSeconds: 5
            failureThreshold: 60
          readinessProbe:
            httpGet: { path: /ready, port: 3005 }
            periodSeconds: 5
          livenessProbe:
            httpGet: { path: /ping, port: 3005 }
            periodSeconds: 10
          resources:
            requests: { cpu: 500m, memory: 1Gi }
      volumes:
        - name: config-data
          persistentVolumeClaim: { claimName: config-data }
---
apiVersion: apps/v1
kind: Deployment
metadata: { name: backend-worker, namespace: tale }
spec:
  replicas: 1
  selector: { matchLabels: { app: backend-worker } }
  template:
    metadata: { labels: { app: backend-worker, tale.tier: backend } }
    spec:
      enableServiceLinks: false
      terminationGracePeriodSeconds: 45
      containers:
        - name: backend-worker
          image: ghcr.io/tale-project/tale/tale-platform:${VERSION}
          envFrom: [{ secretRef: { name: tale-env } }]
          env:
            - { name: TALE_ROLE, value: worker }
            - { name: TALE_CONFIG_DIR, value: /app/data }
            - { name: SANDBOX_URL, value: http://sandbox:8003 }
            - { name: SANDBOX_HTTP_API_BASE_URL, value: http://backend-api:3005 }
            - { name: TALE_SKIP_SSRF_FIREWALL, value: '1' }
          volumeMounts: [{ name: config-data, mountPath: /app/data }]
          resources:
            requests: { cpu: 500m, memory: 1Gi }
      volumes:
        - name: config-data
          persistentVolumeClaim: { claimName: config-data }
---
apiVersion: v1
kind: Service
metadata: { name: platform, namespace: tale }
spec:
  selector: { app: platform }
  ports: [{ name: http, port: 3000, targetPort: 3000 }]
---
apiVersion: apps/v1
kind: Deployment
metadata: { name: platform, namespace: tale }
spec:
  replicas: 1
  selector: { matchLabels: { app: platform } }
  template:
    metadata: { labels: { app: platform } }
    spec:
      enableServiceLinks: false
      terminationGracePeriodSeconds: 45
      containers:
        - name: platform
          image: ghcr.io/tale-project/tale/tale-platform:${VERSION}
          envFrom: [{ secretRef: { name: tale-env } }]
          env:
            - { name: TALE_BACKEND_URL, value: http://backend-api:3005 }
            - { name: TALE_CONFIG_DIR, value: /app/data }
          ports: [{ name: http, containerPort: 3000 }]
          volumeMounts: [{ name: config-data, mountPath: /app/data, readOnly: true }]
          startupProbe:
            exec: { command: [sh, -c, 'curl -sf http://localhost:3000/api/health && [ -f /tmp/platform-ready ]'] }
            periodSeconds: 5
            failureThreshold: 36
          readinessProbe:
            exec: { command: [sh, -c, 'curl -sf http://localhost:3000/api/health && [ -f /tmp/platform-ready ]'] }
            periodSeconds: 5
          resources:
            requests: { cpu: 250m, memory: 512Mi }
      volumes:
        - name: config-data
          persistentVolumeClaim: { claimName: config-data }
---
apiVersion: v1
kind: Service
metadata: { name: bgutil-provider, namespace: tale }
spec:
  selector: { app: bgutil-provider }
  ports: [{ name: http, port: 4416, targetPort: 4416 }]
---
apiVersion: apps/v1
kind: Deployment
metadata: { name: bgutil-provider, namespace: tale }
spec:
  replicas: 1
  selector: { matchLabels: { app: bgutil-provider } }
  template:
    metadata: { labels: { app: bgutil-provider } }
    spec:
      enableServiceLinks: false
      automountServiceAccountToken: false
      containers:
        - name: provider
          image: brainicism/bgutil-ytdlp-pot-provider:1.3.1
          ports: [{ name: http, containerPort: 4416 }]
          readinessProbe:
            tcpSocket: { port: 4416 }
            periodSeconds: 30
          resources:
            requests: { cpu: 50m, memory: 128Mi }
            limits: { memory: 512Mi }
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: tale-backend-egress, namespace: tale }
spec:
  podSelector:
    matchLabels: { tale.tier: backend }
  policyTypes: [Egress]
  egress:
    - to:
        - podSelector: {}
    - to:
        - namespaceSelector: {}
      ports:
        - { protocol: UDP, port: 53 }
        - { protocol: TCP, port: 53 }
    - to:
        - ipBlock:
            cidr: 0.0.0.0/0
            except:
              - 169.254.0.0/16
              - 10.0.0.0/8
              - 172.16.0.0/12
              - 192.168.0.0/16
```

Die Platform-Container starten als root, korrigieren die Besitzrechte von `/app/data` und wechseln dann zum Anwendungsbenutzer; setze auf ihnen kein `runAsNonRoot`.

## Den Proxy veröffentlichen

Der Proxy ist der einzige öffentliche Dienst. Er bindet `hostPort` 80 und 443 auf dem Node, auf dem er läuft; richte den öffentlichen Namen auf die Adresse dieses Nodes. Caddy lauscht auf dem Port, den `SITE_URL` nennt: Mit `https://tale.example.com:8443` muss der Pod 8443 statt 443 freigeben, während Port 80 weiter die Umleitung auf HTTPS bedient. Die Strategie ist `Recreate`: Zwei Proxy-Pods können sich weder einen `hostPort` noch ein `ReadWriteOnce`-Volume teilen.

```yaml
# 30-proxy.yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata: { name: caddy-data, namespace: tale }
spec:
  accessModes: [ReadWriteOnce]
  resources: { requests: { storage: 1Gi } }
---
apiVersion: apps/v1
kind: Deployment
metadata: { name: proxy, namespace: tale }
spec:
  replicas: 1
  strategy: { type: Recreate }
  selector: { matchLabels: { app: proxy } }
  template:
    metadata: { labels: { app: proxy } }
    spec:
      enableServiceLinks: false
      containers:
        - name: caddy
          image: ghcr.io/tale-project/tale/tale-proxy:${VERSION}
          envFrom: [{ secretRef: { name: tale-env } }]
          env:
            - { name: BACKEND_UPSTREAM, value: 'backend-api:3005' }
            - { name: OBJECT_STORE_UPSTREAM, value: 'object-store:9000' }
          ports:
            - { name: http, containerPort: 80, hostPort: 80 }
            - { name: https, containerPort: 443, hostPort: 443 }
          volumeMounts:
            - { name: caddy-data, mountPath: /data }
            - { name: caddy-config, mountPath: /config }
          readinessProbe:
            httpGet: { path: /health, port: 2020 }
            periodSeconds: 10
          resources:
            requests: { cpu: 50m, memory: 64Mi }
      volumes:
        - name: caddy-data
          persistentVolumeClaim: { claimName: caddy-data }
        - name: caddy-config
          emptyDir: {}
```

Zwei Alternativen behalten denselben Pod:

- Ein LoadBalancer-Service auf 80 und 443 vor dem Proxy statt der `hostPort`-Einträge. `TLS_MODE=selfsigned` und `letsencrypt` funktionieren unverändert; der Proxy bedient auch `docs.<HOST>` und besorgt dafür ein Zertifikat.
- Ein Ingress, der TLS terminiert. Setze `TLS_MODE=external` und `TRUSTED_PROXIES` auf den Adressbereich des Ingress, damit weitergeleitete Header akzeptiert werden, wie in [TLS und Domains](/de/self-hosted/configuration/tls-and-domains) beschrieben.

## Die Sandbox-Ebene betreiben

Der Egress-Proxy braucht den Capability-Satz aus dem Compose-Vertrag und keine Sysctls: Der Entrypoint installiert die IPv6-Firewall mit ip6tables, wenn der Node-Kernel sie anbietet, und deaktiviert IPv6 andernfalls im eigenen Netzwerk-Namespace. Ein Cluster, der beides verweigert, blockiert den Pod beim Start; erlaube in dem Fall die Sysctls `net.ipv6.conf.*` auf dem Kubelet. Der Spawner legt Sitzungs-Pods, Secrets und Workspace-Claims über die Kubernetes-API an und läuft deshalb mit einer namespacegebundenen Role und ohne Docker-Socket.

```yaml
# 40-sandbox.yaml
apiVersion: v1
kind: Service
metadata: { name: sandbox-egress, namespace: tale }
spec:
  selector: { app: sandbox-egress }
  ports: [{ name: proxy, port: 3128, targetPort: 3128 }]
---
apiVersion: apps/v1
kind: Deployment
metadata: { name: sandbox-egress, namespace: tale }
spec:
  replicas: 1
  selector: { matchLabels: { app: sandbox-egress } }
  template:
    metadata: { labels: { app: sandbox-egress } }
    spec:
      enableServiceLinks: false
      automountServiceAccountToken: false
      containers:
        - name: egress
          image: ghcr.io/tale-project/tale/tale-sandbox-egress:${VERSION}
          securityContext:
            runAsUser: 0
            capabilities:
              drop: ['ALL']
              add: ['NET_ADMIN', 'DAC_OVERRIDE', 'CHOWN', 'SETUID', 'SETGID', 'NET_BIND_SERVICE', 'KILL']
          ports: [{ name: proxy, containerPort: 3128 }]
          readinessProbe:
            exec: { command: [sh, -c, "curl -sS -o /dev/null --max-time 3 --noproxy '*' http://127.0.0.1:3128/"] }
            periodSeconds: 10
          resources:
            requests: { cpu: 50m, memory: 64Mi }
            limits: { memory: 512Mi }
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata: { name: llm-gateway-data, namespace: tale }
spec:
  accessModes: [ReadWriteOnce]
  resources: { requests: { storage: 1Gi } }
---
apiVersion: v1
kind: Service
metadata: { name: sandbox-llm-gateway, namespace: tale }
spec:
  selector: { app: sandbox-llm-gateway }
  ports: [{ name: http, port: 8080, targetPort: 8080 }]
---
apiVersion: v1
kind: Service
metadata: { name: llm-gateway, namespace: tale }
spec:
  selector: { app: sandbox-llm-gateway }
  ports: [{ name: http, port: 8080, targetPort: 8080 }]
---
apiVersion: apps/v1
kind: Deployment
metadata: { name: sandbox-llm-gateway, namespace: tale }
spec:
  replicas: 1
  strategy: { type: Recreate }
  selector: { matchLabels: { app: sandbox-llm-gateway } }
  template:
    metadata: { labels: { app: sandbox-llm-gateway } }
    spec:
      enableServiceLinks: false
      automountServiceAccountToken: false
      securityContext: { fsGroup: 1000 }
      containers:
        - name: gateway
          image: ghcr.io/tale-project/tale/tale-sandbox-llm-gateway:${VERSION}
          envFrom: [{ secretRef: { name: tale-env } }]
          ports: [{ name: http, containerPort: 8080 }]
          volumeMounts: [{ name: data, mountPath: /app/data }]
          readinessProbe:
            httpGet: { path: /health, port: 8080 }
            periodSeconds: 10
          resources:
            requests: { cpu: 50m, memory: 128Mi }
            limits: { memory: 512Mi }
      volumes:
        - name: data
          persistentVolumeClaim: { claimName: llm-gateway-data }
---
apiVersion: v1
kind: ServiceAccount
metadata: { name: tale-sandbox-spawner, namespace: tale }
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata: { name: tale-sandbox-spawner, namespace: tale }
rules:
  - apiGroups: ['']
    resources: ['pods']
    verbs: ['create', 'get', 'list', 'delete', 'patch']
  - apiGroups: ['']
    resources: ['secrets']
    verbs: ['create', 'delete', 'list']
  - apiGroups: ['']
    resources: ['persistentvolumeclaims']
    verbs: ['get', 'create', 'delete']
  - apiGroups: ['networking.k8s.io']
    resources: ['networkpolicies']
    verbs: ['create', 'update']
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata: { name: tale-sandbox-spawner, namespace: tale }
roleRef: { apiGroup: rbac.authorization.k8s.io, kind: Role, name: tale-sandbox-spawner }
subjects: [{ kind: ServiceAccount, name: tale-sandbox-spawner, namespace: tale }]
---
apiVersion: v1
kind: Service
metadata: { name: sandbox, namespace: tale }
spec:
  selector: { app: sandbox }
  ports: [{ name: http, port: 8003, targetPort: 8003 }]
---
apiVersion: apps/v1
kind: Deployment
metadata: { name: sandbox, namespace: tale }
spec:
  replicas: 1
  selector: { matchLabels: { app: sandbox } }
  template:
    metadata: { labels: { app: sandbox } }
    spec:
      enableServiceLinks: false
      serviceAccountName: tale-sandbox-spawner
      terminationGracePeriodSeconds: 30
      containers:
        - name: spawner
          image: ghcr.io/tale-project/tale/tale-sandbox:${VERSION}
          envFrom: [{ secretRef: { name: tale-env } }]
          env:
            - { name: SANDBOX_BACKEND, value: kubernetes }
            - { name: SANDBOX_K8S_NAMESPACE, value: tale }
            - { name: SANDBOX_RUNTIME_IMAGE, value: 'ghcr.io/tale-project/tale/tale-sandbox-runtime:${VERSION}' }
            - { name: NODE_EXTRA_CA_CERTS, value: /var/run/secrets/kubernetes.io/serviceaccount/ca.crt }
            - { name: SANDBOX_RUNTIME, value: runc }
            - { name: SANDBOX_DOCKER_IN_CONTAINER, value: 'false' }
            - { name: SANDBOX_EGRESS_PROXY, value: 'http://sandbox-egress:3128' }
          ports: [{ name: http, containerPort: 8003 }]
          volumeMounts: [{ name: config-data, mountPath: /app/platform-config, readOnly: true }]
          startupProbe:
            httpGet: { path: /health, port: 8003 }
            periodSeconds: 5
            failureThreshold: 24
          readinessProbe:
            httpGet: { path: /health, port: 8003 }
            periodSeconds: 10
          resources:
            requests: { cpu: 100m, memory: 256Mi }
            limits: { memory: 512Mi }
      volumes:
        - name: config-data
          persistentVolumeClaim: { claimName: config-data }
```

| Einstellung | Anforderung |
| --- | --- |
| `SANDBOX_BACKEND` | `kubernetes`. Docker-Hostpfade und Bridge-Namen konfigurieren dieses Backend nicht. |
| `SANDBOX_K8S_NAMESPACE` | Der Namespace, in dem Sitzungs-Pods, Secrets und Workspace-Claims entstehen; in dieser Aufteilung der Namespace des Spawners selbst. Standard `tale-sandbox`. |
| `SANDBOX_RUNTIME_IMAGE` | Das passende Tale-Sandbox-Runtime-Image, für jeden Node verfügbar. |
| `NODE_EXTRA_CA_CERTS` | Die CA-Datei des Clusters, im Spawner normalerweise `/var/run/secrets/kubernetes.io/serviceaccount/ca.crt`. Sie ist der einzige CA-Vertrauensweg, den der Spawner beachtet; lass die TLS-Prüfung eingeschaltet. |
| `SANDBOX_K8S_WORKSPACE_SIZE_LIMIT` | Die Größe jedes `/agent`-Workspace-Claims, Standard `4Gi`; begrenzt bei aktiviertem innerem Docker auch dessen temporären Speicher. |
| `SANDBOX_K8S_CACHE_STORAGECLASS` | Die StorageClass der Workspace-Claims; ohne Wert gilt der Cluster-Standard. |
| `SANDBOX_RUNTIME` / `SANDBOX_RUNTIME_CLASS` | Eine unterstützte Laufzeitstufe und bei Bedarf der Name der installierten RuntimeClass. |
| `SANDBOX_EGRESS_PROXY` | Der Egress-Service, den die Sitzungen nutzen, Standard `http://sandbox-egress:3128`. |

Der Spawner skaliert horizontal. Jedes Replikat findet eine Sitzung, die es nicht selbst angelegt hat, über den deterministischen Pod-Namen und übernimmt sie; exec, Stopp und Zerstören funktionieren daher über jedes Replikat, das der Service auswählt. `SANDBOX_MAX_SESSIONS` zählt den Namespace, gleichzeitige Aufnahmen auf mehreren Replikaten können den Wert aber kurz überschreiten; eine ResourceQuota liefert die harte Grenze. Der [Kubernetes-Vertrag der Sandbox](https://github.com/tale-project/tale/blob/main/services/sandbox/docs/kubernetes.md) dokumentiert die Pod-Form und die Laufzeitdetails.

### Was der Spawner durchsetzt

Beim Start legt der Spawner die NetworkPolicy `tale-sandbox-session-egress` an: Sitzungs-Pods erreichen DNS und die Pods ihres eigenen Namespace und sonst nichts. Der Cloud-Metadatendienst, die Nodes und andere Namespaces bleiben damit auch für einen Prozess unerreichbar, der `HTTP_PROXY` ignoriert. Öffentliche Ziele laufen über `sandbox-egress`. Eine fehlende Berechtigung für `networkpolicies` wird protokolliert und stoppt den Spawner nicht; prüfe, dass die Richtlinie existiert, bevor du Arbeit zulässt.

Sitzungs-Pods führen den Runner als uid 65534 aus, mit allen Capabilities entfernt, einem schreibgeschützten Root-Dateisystem, ohne ServiceAccount-Token und mit dem Sitzungs-Secret nur als Umgebung eingebunden. Der Workspace `/agent` ist ein Claim, der einen Leerlaufstopp überlebt; erst ein ausdrückliches Zerstören löscht ihn. Sitzungsaktionen laufen per HTTP zu runnerd auf der Pod-IP an Port 8200; `pods/exec` kommt nicht vor.

<Note>

Die namespaceweite Freigabe ist weiter als das Compose-Netz. Aus einem Sitzungs-Pod antworten Postgres und der Objektspeicher auf ihren Service-Ports, obwohl die Sitzung keine Zugangsdaten für sie besitzt. Diese Speicher in einem anderen Namespace zu halten, würde das einschränken; diese Aufteilung wurde nicht geprüft und braucht eine eigene Richtlinie für die Backend-Rollen.

</Note>

Für Docker in Sitzungen wählst du einen ausdrücklichen `SANDBOX_DIND_INNER_POOL` außerhalb der Pod-, Service- und VPC-Bereiche und liest die [Netzwerkvoraussetzungen für inneres Docker](/de/self-hosted/configuration/environment-reference#sandbox-infrastructure); ein Pod kann nicht jedes Cluster-Netz erkennen.

## Ausrollen und prüfen

Warte nach der Apply-Schleife, bis jeder Pod bereit ist, und prüfe die Signale, auf die es ankommt:

```bash
kubectl -n tale get pods
kubectl -n tale logs -l 'app in (backend-api,backend-worker)' --tail=-1 | grep -c 'applying app migration'
kubectl -n tale get networkpolicy tale-sandbox-session-egress tale-backend-egress
curl -s https://tale.example.com/api/health
```

Die Backend-Rolle, die zuerst startet, wendet die Migrationen unter einer Advisory-Sperre an; die Zahl stammt deshalb aus beiden Rollen zusammen, und das API-Protokoll endet mit `api listening on :3005`; der Health-Endpunkt antwortet mit `{"status":"ok","version":"0.5.31"}`. Öffne dann die Site, [erstelle den ersten Inhaber](/de/self-hosted/install/first-admin) und verbinde einen Anbieter.

Unter **Einstellungen > Sandboxes** trägt die Deployment-Karte den Namespace als Geltungsbereich im Titel und zeigt keine CPU- und Speicherwerte des Hosts; auf diesem Backend ist das erwartet. Weise einem Agenten eine Aufgabe zu und warte auf sein Ergebnis: Der Lauf erzeugt im Namespace einen Sitzungs-Pod namens `tale-sbx-ses-<hash>` zusammen mit einem `-spec`-Secret und einem `-ws`-Claim.

Belege die Sperre aus einem laufenden Sitzungs-Pod heraus:

```bash
POD=$(kubectl -n tale get pods -l tale.sandbox/role=session -o name | head -1)
kubectl -n tale exec $POD -c runner -- curl -m 5 http://169.254.169.254/
kubectl -n tale exec $POD -c runner -- curl -m 20 -s -o /dev/null -w '%{http_code}\n' https://example.com/
```

Der erste Befehl läuft in einen Timeout; der zweite gibt `200` aus, erreicht über den Egress-Proxy. Teste danach den Lebenszyklus so, wie du dich im Betrieb darauf verlässt: Ein Runner-Neustart behält Pod und Workspace, eine leerlaufende Sitzung stoppt nach `SANDBOX_SESSION_MAX_IDLE_MS` und lässt ihren Claim zurück, die nächste Aufgabe setzt sie mit erhaltenen Dateien fort, und Zerstören entfernt Pod, Secret und Claim. Wiederhole eine Aufgabe mit zwei Spawner-Replikaten nach dem Skalieren und bestätige, dass das zweite Replikat sie bedient.

Rolle die API ohne Lücke aus, indem du zwei Replikate behältst und das Deployment neu startest:

```bash
kubectl -n tale rollout restart deploy/backend-api
kubectl -n tale rollout status deploy/backend-api
```

Migrationen laufen beim Start unter einer Advisory-Sperre, während das vorherige Image weiter bedient; der Health-Endpunkt bleibt während des Rollouts grün. Halte eine `VERSION` über alle Tale-Images hinweg fest und folge [Bereitstellung aktualisieren und wiederherstellen](/de/self-hosted/operate/upgrades), bevor du sie änderst; eine Version, die das Proxy-Image ändert, braucht auch einen neu erstellten Proxy-Pod.

Snapshots, Blue-Green-Wechsel und Rollback-Prüfungen der CLI laufen auf Kubernetes nicht. Sichere die Claims mit den Snapshots deines Speicheranbieters und bewahre Secret, Verschlüsselungsschlüssel und Organisationskonfiguration zusammen damit auf; [Backups und Wiederherstellung](/de/self-hosted/operate/backups-and-restore) nennt, was eine Wiederherstellung braucht.

## Geprüfter Umfang

Diese fünf Dateien wurden bis auf die Secret-Werte unverändert auf einem frischen kind-Cluster mit einem Node, Kubernetes 1.36, kube-network-policies, der StorageClass local-path und Tale 0.5.31 angewendet: Start und Migrationen, der öffentliche Zugang, die Einrichtung des ersten Inhabers samt Sandboxes-Karte, eine Agentenaufgabe mit Ergebnis, der Sitzungslebenszyklus einschließlich Leerlaufstopp, Fortsetzung und replikatübergreifendem Zugriff, die Sperrprüfungen oben und ein Rolling Restart der API mit zwei Replikaten. Mehrere Nodes mit `ReadWriteMany`-Konfigurationsspeicher, Docker in Sitzungen auf einer sysbox- oder kata-RuntimeClass, ein Ingress mit `TLS_MODE=external` und hochverfügbare Speicher waren nicht Teil dieses Laufs.
