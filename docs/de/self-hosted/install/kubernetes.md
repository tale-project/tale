---
title: Auf Kubernetes bereitstellen
description: Übertrage den Dienstvertrag in Kubernetes-Objekte, betreibe den Sandbox-Spawner mit seinem nativen Backend und prüfe Isolation, Sitzungslebenszyklus und Rollouts, bevor du Nutzer zulässt.
---

Tale läuft auf Kubernetes, wenn du den [Dienstvertrag](/de/self-hosted/install/own-compose) selbst in Deployments, Services und Volumes überträgst und den Sandbox-Spawner auf `SANDBOX_BACKEND=kubernetes` umstellst. Ein offizielles Helm-Chart gibt es nicht. Diese Anleitung beschreibt eine Namespace-Aufteilung, die mit Tale 0.5.31 auf einem Cluster mit einem Node vollständig durchgespielt wurde, die Objekte, die sich vom Compose-Stack unterscheiden, und die Prüfungen, die das Ergebnis belegen. Cluster, Speicher, öffentlicher Zugang und Rollout-Ablauf bleiben in deiner Verantwortung.

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

Reserviere Arbeitsspeicher für die Anwendungsrollen plus eine Agentensitzung je gleichzeitiger Aufgabe; `SANDBOX_AGENT_MEMORY` und die übrigen Sitzungslimits stehen in der [Umgebungsreferenz](/de/self-hosted/configuration/environment-reference#sandbox-infrastructure).

## Den Namespace aufteilen

Betreibe alle Dienste in einem Namespace. Sitzungs-Pods müssen `backend-api` und `sandbox-llm-gateway` direkt erreichen, und die Egress-Sperre, die der Spawner anlegt, erlaubt nur den Namespace, in dem er läuft. Deshalb gehören auch die Anwendungsrollen dorthin. Behalte die Compose-Dienstnamen als Service-Namen bei: Die Images lösen `db`, `knowledge-db`, `object-store`, `backend-api`, `platform`, `sandbox`, `sandbox-egress`, `sandbox-llm-gateway` samt Alias `llm-gateway` und `bgutil-provider` über den Namen auf.

<Warning>

Setze `enableServiceLinks: false` auf jedem Pod. Andernfalls injiziert Kubernetes für jeden Service im Namespace Variablen im Docker-Stil, etwa `SANDBOX_PORT=tcp://10.96.6.49:8003` und `DB_PORT=tcp://10.96.150.113:5432`. Der Spawner liest `SANDBOX_PORT` als seinen Listen-Port und beendet sich beim Start, und das Platform-Image leitet seine Datenbank-URL aus `DB_PORT` ab.

</Warning>

| Compose-Dienst | Kubernetes-Objekte | Hinweise |
| --- | --- | --- |
| `db` mit Alias `knowledge-db` | StatefulSet `db`; Services `db` und `knowledge-db` auf denselben Pod | Lass `TALE_DB_ROLE` ungesetzt: Das Image legt beide Datenbanken an und wendet die Wissensmigrationen an; das Backend migriert das Anwendungsschema beim Start. Binde ein `emptyDir` im Arbeitsspeicher mit 256 MiB unter `/dev/shm` ein. Gewähre 60 Sekunden Beendigungsfrist; das Image stoppt mit `SIGINT`. |
| `object-store` | Deployment mit Strategie `Recreate`, PVC unter `/data`, Service auf 9000 | Starte `server /data --address ':9000' --console-address ':9001'` mit `MINIO_ROOT_USER` und `MINIO_ROOT_PASSWORD` aus dem Secret. Das Backend legt den Bucket beim Start an. |
| `platform` | Deployment; Service auf 3000 | `config-data` nur lesend, `TALE_BACKEND_URL=http://backend-api:3005`. |
| `backend-api` | Deployment mit zwei Replikaten; Service auf 3005 | `config-data` lesend und schreibend. Zwei Replikate ermöglichen einen Rollout ohne Lücke. |
| `backend-worker` | Deployment | Kein Service und keine HTTP-Prüfung. |
| `proxy` | Deployment mit Strategie `Recreate`; `hostPort` 80 und 443 oder ein LoadBalancer-Service; PVC für `/data` | Der Zertifikatspeicher überlebt Neustarts auf dem PVC. |
| `sandbox` | ServiceAccount, Role, RoleBinding, Deployment; Service auf 8003 | `SANDBOX_BACKEND=kubernetes`; `config-data` nur lesend unter `/app/platform-config`. Kein Docker-Socket. |
| `sandbox-egress` | Deployment; Service auf 3128 | Der ausgelieferte Capability-Satz, keine Sysctls. |
| `sandbox-llm-gateway` | Deployment mit Strategie `Recreate`, PVC unter `/app/data`; Services `sandbox-llm-gateway` und `llm-gateway` auf 8080 | Das Image läuft als uid 1000; setze `fsGroup: 1000`, damit es seinen Zustand schreiben kann. |
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
| `sandbox-egress` | keine | TCP-Socket 3128 | keine |
| `sandbox-llm-gateway` | keine | `GET /health` auf 8080 | keine |

Kubernetes kennt kein `depends_on`. Eine Backend-Rolle, die startet, bevor Postgres antwortet, beendet sich einmal mit `ECONNREFUSED`; die Neustartrichtlinie heilt das. Ergänze einen Init-Container, der auf `db:5432` wartet, wenn du einen sauberen ersten Start willst.

## Die gemeinsame Umgebung anlegen

Lege die deploymentweiten Werte aus der Compose-`.env` in einem Secret ab und binde es mit `envFrom` in jeden Tale-Container ein. Erzeuge jedes Geheimnis einmal und bewahre es auf; besonders `ENCRYPTION_SECRET_HEX` muss für vorhandene verschlüsselte Werte stabil bleiben. Die [Umgebungsreferenz](/de/self-hosted/configuration/environment-reference) erklärt jede Variable.

```yaml
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
```

Ersetze jeden Platzhalter `<...>`. `DATABASE_URL` enthält dasselbe Passwort wie `DB_PASSWORD`; die Wissensverbindung verwendet standardmäßig `knowledge-db:5432/tale_knowledge` mit diesem Passwort. Lege außerdem eine Version für alle Tale-Images fest, zum Zeitpunkt dieser Anleitung `VERSION=0.5.31`, und ersetze `${VERSION}` in den folgenden Fragmenten, bevor du sie anwendest, etwa mit `envsubst`; kubectl expandiert die Variable nicht.

## Die Datenbank betreiben

Das StatefulSet behält das Datenvolume über Pod-Ersetzungen hinweg und gibt dem Image das Herunterfahren, das es erwartet.

```yaml
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
      volumes:
        - name: shm
          emptyDir: { medium: Memory, sizeLimit: 256Mi }
  volumeClaimTemplates:
    - metadata: { name: data }
      spec:
        accessModes: [ReadWriteOnce]
        resources: { requests: { storage: 20Gi } }
```

Lege zwei Services mit `selector: { app: db }` auf Port 5432 an, benannt `db` und `knowledge-db`. Für ein externes Postgres setzt du `DATABASE_URL` und `KNOWLEDGE_DATABASE_URL` wie unter [Externe Speicher verbinden](/de/self-hosted/install/own-compose#externe-speicher-verbinden) beschrieben und lässt das StatefulSet weg.

## Die Anwendungsrollen betreiben

Die drei Rollen teilen sich das Platform-Image. Dieses Deployment ist die API-Rolle. Der Worker nutzt dieselbe Pod-Vorlage mit `TALE_ROLE: worker`, ohne Port und ohne Prüfungen; die Web-Ebene lässt `TALE_ROLE` weg, bindet `config-data` nur lesend ein und nutzt die Exec-Prüfungen aus der Tabelle oben.

```yaml
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
      volumes:
        - name: config-data
          persistentVolumeClaim: { claimName: config-data }
```

Der Container startet als root, korrigiert die Besitzrechte von `/app/data` und wechselt dann zum Anwendungsbenutzer; setze auf ihm kein `runAsNonRoot`.

<Warning>

Gewähre den Backend-Rollen auf Kubernetes kein `NET_ADMIN`. Mit dieser Capability installiert das Image seine iptables-Egress-Sperre, die nur die direkt angebundenen Subnetze des Pods erlaubt und den übrigen privaten Adressraum abweist. In einem Pod-Netz trifft das auch den Cluster-DNS und jede Service-Adresse: Die Rolle scheitert mit `getaddrinfo EAI_AGAIN db` und startet neu, bis du die Capability entfernst. `TALE_SKIP_SSRF_FIREWALL=1` hält die Entscheidung fest, und die NetworkPolicy unten übernimmt die Sperre.

</Warning>

```yaml
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

Versieh die API- und Worker-Pods mit dem Label `tale.tier: backend`. Die Richtlinie lässt sie jeden Nachbarn im Namespace, den Cluster-DNS und das öffentliche Internet erreichen und blockiert den Cloud-Metadatendienst, die Nodes und private Netze. Erweitere die letzte Regel, wenn deine Modellanbieter oder Konnektoren in einem privaten Bereich liegen.

## Den Proxy veröffentlichen

Der Proxy ist der einzige öffentliche Dienst. Gib ihm `BACKEND_UPSTREAM=backend-api:3005`, `OBJECT_STORE_UPSTREAM=object-store:9000` und das gemeinsame Secret, binde ein PVC für den Zertifikatspeicher unter `/data` ein und prüfe `GET /health` auf Port 2020. Nutze die Strategie `Recreate`; zwei Proxy-Pods können sich weder einen `hostPort` noch ein `ReadWriteOnce`-Volume teilen.

```yaml
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
```

Wähle den Zugang, der zu deinem Cluster passt:

- `hostPort` 80 und 443 auf einem Node, auf dessen Adresse der öffentliche Name zeigt, wie im Fragment. `TLS_MODE=selfsigned` und `letsencrypt` funktionieren unverändert; der Proxy bedient auch `docs.<HOST>` und besorgt dafür ein Zertifikat.
- Ein LoadBalancer-Service auf 80 und 443 vor dem Proxy. Dieselben TLS-Modi gelten; der Zertifikatspeicher muss auf dem PVC bleiben.
- Ein Ingress, der TLS terminiert. Setze `TLS_MODE=external` und `TRUSTED_PROXIES` auf den Adressbereich des Ingress, damit weitergeleitete Header akzeptiert werden, wie in [TLS und Domains](/de/self-hosted/configuration/tls-and-domains) beschrieben.

`SITE_URL` muss der Adresse im Browser entsprechen, einschließlich eines abweichenden Ports.

## Die Sandbox-Ebene betreiben

Der Egress-Proxy braucht den Capability-Satz aus dem Compose-Vertrag und keine Sysctls: Der Entrypoint installiert die IPv6-Firewall mit ip6tables, wenn der Node-Kernel sie anbietet, und deaktiviert IPv6 andernfalls im eigenen Netzwerk-Namespace. Ein Cluster, der beides verweigert, blockiert den Pod beim Start; erlaube in dem Fall die Sysctls `net.ipv6.conf.*` auf dem Kubelet.

```yaml
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
      tcpSocket: { port: 3128 }
```

Das Gateway braucht `fsGroup: 1000` auf seinem Pod, das gemeinsame Secret, ein PVC unter `/app/data` und zwei Services, `sandbox-llm-gateway` und `llm-gateway`, auf Port 8080.

Der Spawner legt Sitzungs-Pods, Secrets und Workspace-Claims über die Kubernetes-API an und läuft deshalb mit einer namespacegebundenen Role und ohne Docker-Socket:

```yaml
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

Wende zuerst Namespace und Secret an, dann die Speicher, die Anwendungsrollen, den Proxy und die Sandbox-Ebene. Warte, bis jeder Pod bereit ist, und prüfe die Signale, auf die es ankommt:

```bash
kubectl -n tale get pods
kubectl -n tale logs deploy/backend-api | grep 'applying app migration'
kubectl -n tale get networkpolicy tale-sandbox-session-egress tale-backend-egress
curl -s https://tale.example.com/api/health
```

Das Backend-Protokoll listet jede angewendete Migration auf und endet mit `api listening on :3005`; der Health-Endpunkt antwortet mit `{"status":"ok","version":"0.5.31"}`. Öffne dann die Site, [erstelle den ersten Inhaber](/de/self-hosted/install/first-admin) und verbinde einen Anbieter.

Unter **Einstellungen > Sandboxes** meldet die Deployment-Karte den Namespace als Geltungsbereich und lässt die CPU- und Speichermessungen leer; auf diesem Backend ist das erwartet. Weise einem Agenten eine Aufgabe zu und warte auf sein Ergebnis: Der Lauf erzeugt im Namespace einen Sitzungs-Pod namens `tale-sbx-ses-<hash>` zusammen mit einem `-spec`-Secret und einem `-ws`-Claim.

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

Diese Aufteilung wurde auf einem kind-Cluster mit einem Node, Kubernetes 1.36, kube-network-policies, der StorageClass local-path und Tale 0.5.31 durchgespielt: Start und Migrationen, der öffentliche Zugang, die Einrichtung des ersten Inhabers, eine Agentenaufgabe mit Ergebnis, der Sitzungslebenszyklus einschließlich Leerlaufstopp, Fortsetzung und replikatübergreifendem Zugriff, die Sperrprüfungen oben und ein Rolling Restart der API mit zwei Replikaten. Mehrere Nodes mit `ReadWriteMany`-Konfigurationsspeicher, Docker in Sitzungen auf einer sysbox- oder kata-RuntimeClass, ein Ingress mit `TLS_MODE=external` und hochverfügbare Speicher waren nicht Teil dieses Laufs.
