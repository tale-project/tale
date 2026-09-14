---
title: Prometheus et Grafana
description: Collecte les métriques Tale avec un fichier de jeton, valide la configuration et crée un tableau de bord à partir des séries disponibles.
---

Utilise ton installation Prometheus et Grafana existante si tu en as une. L’exemple ci-dessous lance un projet Compose de surveillance séparé qui interroge Tale via son proxy public. Il comprend un stockage persistant des métriques, un fichier de jeton monté et deux premières alertes.

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
```

Adapte la gravité et les délais à tes exigences, puis configure la distribution via Alertmanager ou Grafana. Une règle visible dans Prometheus n’envoie pas de notification à elle seule. L’alerte de stockage couvre les valeurs par défaut du déploiement, pas les bases ou buckets propres aux organisations.

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

Certains collecteurs lisent des comptes partagés en base, d’autres décrivent un processus. Avec plusieurs réplicas, collecte leurs métriques de processus séparément sur ton réseau privé et évite de compter plusieurs fois les jauges partagées. [Surveiller les opérations](/fr/self-hosted/operate/observability/operations) explique les limites des sondes de stockage et les mesures supplémentaires nécessaires au modèle de règles SLA.
