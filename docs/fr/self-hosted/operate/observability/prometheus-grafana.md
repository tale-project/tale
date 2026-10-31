---
title: Prometheus et Grafana
description: Collecte les métriques Tale avec un fichier de jeton, valide la configuration et crée un tableau de bord à partir des séries disponibles.
---

Utilise ton installation Prometheus et Grafana existante si tu en as une. L’exemple ci-dessous lance un projet Compose de surveillance séparé qui interroge Tale via son proxy public. Il comprend un stockage persistant des métriques, un fichier de jeton monté et de premières alertes.

## Préparer l’accès et les fichiers

Définis `METRICS_BEARER_TOKEN` pour le proxy Tale, puis applique la modification avec ta procédure de déploiement. Un simple redémarrage de conteneur ne recharge pas les valeurs d’environnement modifiées. Vérifie les chemins protégés dans [Configurer l’observabilité](/fr/self-hosted/configuration/observability-config#metriques) avant de configurer la collecte.

Crée un dossier de surveillance séparé contenant `compose.monitoring.yml`, `prometheus.yml`, `tale-alerts.yml` et `secrets/tale-metrics-token`. Écris uniquement la valeur du jeton dans ce dernier fichier avec ton gestionnaire de secrets. Exclus ce fichier et le `.env` de surveillance de la gestion de versions. Limite leur accès à l’opérateur et au conteneur qui en a besoin.

Dans le `.env` de surveillance, fixe des tags testés pour `PROMETHEUS_IMAGE` et `GRAFANA_IMAGE`, puis définis `GRAFANA_ADMIN_PASSWORD`. Choisis des versions prises en charge sur les pages officielles de [Prometheus](https://prometheus.io/download/) et de [Grafana](https://grafana.com/grafana/download). Ces versions sont indépendantes de celle de Tale.

## Définir les services de surveillance

Les deux interfaces écoutent sur loopback. Accède-y depuis l’hôte Docker ou par un tunnel SSH ; un contexte Docker distant ne les rend pas locales à ton poste.

```yaml
# compose.monitoring.yml
services:
  prometheus:
    image: ${PROMETHEUS_IMAGE:?set a tested Prometheus image tag}
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml:ro
      - ./tale-alerts.yml:/etc/prometheus/tale-alerts.yml:ro
      - prometheus-data:/prometheus
    secrets: [tale_metrics_token]
    ports: ['127.0.0.1:9090:9090']
    restart: unless-stopped
  grafana:
    image: ${GRAFANA_IMAGE:?set a tested Grafana image tag}
    environment:
      GF_SECURITY_ADMIN_PASSWORD: ${GRAFANA_ADMIN_PASSWORD:?set a strong password}
      GF_USERS_ALLOW_SIGN_UP: 'false'
    volumes: ['grafana-data:/var/lib/grafana']
    ports: ['127.0.0.1:3001:3000']
    restart: unless-stopped
secrets:
  tale_metrics_token:
    file: ./secrets/tale-metrics-token
volumes:
  prometheus-data:
  grafana-data:
```

Le secret est monté dans Prometheus sous `/run/secrets/tale_metrics_token`. Assure-toi que l’environnement de conteneurs peut lire le fichier source sans l’ouvrir aux autres utilisateurs.

## Configurer la collecte et les alertes

Remplace `tale.example.com` par le nom d’hôte Tale accessible, avec le port s’il diffère de 443. Ajoute le chemin de base du déploiement à chaque `metrics_path` si nécessaire. Utilise un certificat HTTPS de confiance ou configure un fichier d’autorité de certification ; ne désactive pas la vérification pour faire réussir la collecte.

```yaml
# prometheus.yml
global:
  scrape_interval: 30s
rule_files:
  - /etc/prometheus/tale-alerts.yml
scrape_configs:
  - job_name: tale-platform
    scheme: https
    metrics_path: /metrics/platform
    authorization:
      credentials_file: /run/secrets/tale_metrics_token
    static_configs:
      - targets: ['tale.example.com']
  - job_name: tale-backend
    scheme: https
    metrics_path: /metrics/backend
    authorization:
      credentials_file: /run/secrets/tale_metrics_token
    static_configs:
      - targets: ['tale.example.com']
```

Le jeton provient de `credentials_file`, conformément à la [configuration HTTP de Prometheus](https://prometheus.io/docs/prometheus/latest/configuration/configuration/#http_config). Un `${METRICS_BEARER_TOKEN}` écrit littéralement dans ce YAML n’est pas remplacé par Docker Compose : Compose monte le fichier sans en réécrire le contenu.

```yaml
# tale-alerts.yml
groups:
  - name: tale
    rules:
      - alert: TaleTargetDown
        expr: up{job=~"tale-.*"} == 0
        for: 2m
        labels: { severity: page }
        annotations:
          summary: 'Tale metrics target {{ $labels.job }} is down'
      - alert: TaleDefaultStoreUnreachable
        expr: tale_backend_store_up == 0
        for: 5m
        labels: { severity: page }
        annotations:
          summary: 'Tale cannot reach its default {{ $labels.store }} store'
      - alert: TaleDispatchStopped
        expr: time() - tale_backend_dispatch_last_pass_timestamp_seconds > 900
        for: 5m
        labels: { severity: ticket }
        annotations:
          summary: 'The dispatch of project {{ $labels.project }} has not passed for 15 minutes'
      - alert: TaleAgentRunsOutOfMemory
        expr: max(increase(tale_backend_agent_run_failures_total{code="resource_exhausted"}[1h])) > 0
        labels: { severity: ticket }
        annotations:
          summary: 'An agent run ran out of memory in the last hour'
```

Adapte la gravité et les délais à tes exigences, puis configure la distribution via Alertmanager ou Grafana. Une règle visible dans Prometheus n’envoie pas de notification à elle seule. L’alerte de stockage couvre les valeurs par défaut du déploiement, pas les bases ou buckets propres aux organisations.

L’alerte de répartition du travail nomme un projet dont la répartition du travail est activée et n’a terminé aucun passage depuis 15 minutes. Chaque répartition activée passe au moins une fois par minute ; une valeur qui ne bouge plus signale des workers de jobs arrêtés ou un passage qui échoue sans cesse.

L’alerte de mémoire signale que la sandbox d’au moins une exécution d’agent a atteint sa limite de mémoire au cours de la dernière heure. Une telle exécution fait l’objet d’une nouvelle tentative après une pause, comme l’explique [Traiter une attente ou un échec](/fr/platform/projects/task-automation#handle-waiting-and-failed-runs), et chaque tentative qui manque de mémoire compte à nouveau. Si l’alerte revient sans cesse, donne plus de mémoire à chaque session d’agent avec `SANDBOX_AGENT_MEMORY`, ou fais tourner moins de sessions à la fois, comme l’indique la [référence d’environnement](/fr/self-hosted/configuration/environment-reference#sandbox-infrastructure).

## Démarrer et vérifier la collecte

Valide les fichiers avant de démarrer :

```bash
docker compose -f compose.monitoring.yml config --quiet
docker compose -f compose.monitoring.yml run --rm --entrypoint promtool \
  prometheus check config /etc/prometheus/prometheus.yml
docker compose -f compose.monitoring.yml up -d
```

Ouvre `http://127.0.0.1:9090/targets`. Les deux jobs Tale doivent afficher **UP**. Vérifie la requête `up{job=~"tale-.*"}` et les règles d’alerte. Un `401` renvoie à la configuration du jeton. Pour une erreur DNS, de connexion ou de certificat, examine le chemin réseau du serveur de collecte. **UP** prouve qu’une collecte a réussi, pas que toutes les fonctions de l’application marchent.

Ouvre Grafana sur `http://127.0.0.1:3001` et ajoute une source de données Prometheus à `http://prometheus:9090`. Cette adresse est résolue dans le réseau Compose de surveillance.

## Construire un premier tableau de bord utile

| Panneau | Requête | Interprétation |
| --- | --- | --- |
| Disponibilité de la collecte | `up{job=~"tale-.*"}` | Chaque chemin public de métriques a-t-il répondu ? |
| Mémoire backend | `process_resident_memory_bytes{job="tale-backend"}` | Mémoire du réplica d’API qui a répondu. |
| Débit de réponses backend | `sum by (status) (rate(tale_backend_http_requests_total[5m]))` | Débit des requêtes par classe de statut de réponse. |
| États des jobs | `tale_backend_jobs` | Jobs par état de file ; surveille une croissance durable et les échecs. |
| Stockages par défaut | `tale_backend_store_up` | Accessibilité mise en cache de `app_db`, `knowledge_db` et `object_store`. |
| Drainage de déploiement | `tale_backend_drain_active` | Le drainage refuse-t-il de nouveaux tours ? |
| Pouls de la répartition du travail | `time() - tale_backend_dispatch_last_pass_timestamp_seconds` | Secondes écoulées depuis le dernier passage terminé de chaque répartition du travail activée, par projet. |
| Exécutions d’agent en attente | `max by (reason) (tale_backend_agent_runs_waiting)` | Exécutions d’agent qui attendent une place en ce moment, par motif. |
| Mises en attente d’exécutions d’agent | `max by (reason) (increase(tale_backend_agent_run_parks_total[1h]))` | Nombre de fois où des exécutions d’agent ont dû attendre une place au cours de la dernière heure, par motif. |
| Réveils d’exécutions d’agent | `max by (source) (increase(tale_backend_agent_run_wakes_total[1h]))` | Exécutions d’agent en attente relancées au cours de la dernière heure, par déclencheur. `tale_backend_agent_run_wake_failures_total` compte les réveils qui ont échoué ; leurs exécutions attendent le réveil suivant. |
| Exécutions d’agent en échec | `max by (code) (increase(tale_backend_agent_run_failures_total[1h]))` | Exécutions d’agent qui ont échoué au cours de la dernière heure, par code d’échec. `resource_exhausted` signifie qu’une sandbox a manqué de mémoire. |

Les séries des exécutions d’agent comptent les exécutions de tâches des agents de projet de toutes les organisations ; les exécutions d’automatisation n’y figurent pas. Leurs totaux sont conservés en base, donc un redémarrage ne les remet pas à zéro, et chaque réplica d’API rapporte les mêmes valeurs pour tout le déploiement : combine les réplicas avec `max`, jamais avec `sum`. Un réplica qui ne peut pas lire la base ne rapporte aucun total lors de cette collecte ; un graphique montre alors une interruption plutôt qu’une baisse. Un événement compte dès qu’il est enregistré ; un processus qui s’arrête entre les deux peut perdre ce seul comptage. Les labels proviennent de listes fixes et ne nomment jamais une organisation, une tâche ou une exécution :

- `reason` : `org_limit` (tous les workers d’agent de l’organisation sont occupés), `host` (le déploiement est plein ou manque de mémoire ou d’espace disque), `destroy_pending` (l’espace de travail que l’exécution utiliserait est en cours de suppression), `exec_limit` (sa sandbox termine encore un processus précédent), `model_capacity` (son modèle d’IA est saturé) ou `unknown`. [Sandboxes](/fr/platform/admin/sandboxes#resoudre-un-demarrage-bloque) explique comment résoudre chaque attente.
- `source` : `release` (un worker ou une place de sandbox vient de se libérer), `scheduled` (le réveil prévu pour cette exécution est arrivé à échéance, par exemple quand son tour est venu dans la file de l’hôte des sandboxes) ou `watchdog` (le passage périodique qui réveille les exécutions que rien d’autre n’a réveillées).
- `code` : le code d’échec avec lequel l’exécution s’est terminée, ou `unknown` quand elle n’en a aucun que cette version connaisse.

Certains collecteurs lisent des comptes partagés en base, d’autres décrivent un processus. Avec plusieurs réplicas, collecte leurs métriques de processus séparément sur ton réseau privé et évite de compter plusieurs fois les jauges partagées. [Surveiller les opérations](/fr/self-hosted/operate/observability/operations) explique les limites des sondes de stockage et les mesures supplémentaires nécessaires au modèle de règles SLA.
