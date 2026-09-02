---
title: Prometheus et Grafana
description: Un stack Prometheus et Grafana en copier-coller qui scrape les endpoints de métriques de Tale, plus un tableau de bord de départ et une première règle d'alerte.
---

C'est l'exemple mis en pratique derrière [Configuration de l'observabilité](/fr/self-hosted/configuration/observability-config) : une paire Prometheus et Grafana que tu poses à côté de Tale, pointée sur les endpoints de métriques à bearer token, avec un tableau de bord de départ et une règle d'alerte à étoffer. C'est pour les opérateurs auto-hébergés qui ont déjà défini `METRICS_BEARER_TOKEN` et veulent maintenant des graphes en direct plutôt qu'un `curl` contre `/metrics`.

La page de référence de configuration liste les endpoints et la stanza de scrape unique ; cette page monte tout le stack de bout en bout. Tout ici tourne sur le même hôte que Tale, donc aucune métrique ne quitte la machine.

## Avant de commencer

Définis `METRICS_BEARER_TOKEN` dans ton `.env` et redémarre le proxy — sans lui, chaque endpoint renvoie 401, et Prometheus affichera chaque cible comme down. Les endpoints, et ce que chacun porte, sont le tableau dans [Configuration de l'observabilité](/fr/self-hosted/configuration/observability-config#metrics) : `/metrics/backend` et `/metrics/platform`, tous deux servis par `tale-proxy` sur le même nom d'hôte que l'app. Scrape `/metrics/backend` en premier — c'est la couche qui sert chaque requête.

## Ajouter Prometheus et Grafana à ta stack

Pose ces deux services dans un override compose à côté de Tale. Prometheus scrape à un intervalle et stocke une TSDB locale ; Grafana lit Prometheus et rend les tableaux de bord. Les deux se lient à localhost uniquement — atteins Grafana via un tunnel SSH ou mets-le derrière le même proxy avec auth, ne l'expose jamais brut.

```yaml
# docker-compose.metrics.yml — start with: docker compose -f docker-compose.yml -f docker-compose.metrics.yml up -d
services:
  prometheus:
    image: prom/prometheus:v3.1.0
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml:ro
      - prometheus-data:/prometheus
    ports:
      - '127.0.0.1:9090:9090'
    restart: unless-stopped

  grafana:
    image: grafana/grafana:11.4.0
    environment:
      GF_SECURITY_ADMIN_PASSWORD: ${GRAFANA_ADMIN_PASSWORD:?set a strong password}
      GF_USERS_ALLOW_SIGN_UP: 'false'
    volumes:
      - grafana-data:/var/lib/grafana
    ports:
      - '127.0.0.1:3001:3000'
    restart: unless-stopped

volumes:
  prometheus-data:
  grafana-data:
```

## Configuration du scraping

Les endpoints de Tale partagent un bearer token, donc la config de scrape est la stanza publiée, répétée une fois par chemin. Enregistre ceci comme `prometheus.yml` à côté de l'override ci-dessus et substitue ton hôte et ton token — Prometheus lit le token depuis le fichier, garde-le donc en `chmod 600` et hors du contrôle de version.

```yaml
global:
  scrape_interval: 30s

scrape_configs:
  - job_name: tale-backend
    scheme: https
    metrics_path: /metrics/backend
    authorization: { credentials: '${METRICS_BEARER_TOKEN}' }
    static_configs:
      - targets: ['tale.example.com']
  - job_name: tale-platform
    scheme: https
    metrics_path: /metrics/platform
    authorization: { credentials: '${METRICS_BEARER_TOKEN}' }
    static_configs:
      - targets: ['tale.example.com']
```

Ouvre `http://127.0.0.1:9090/targets` après le démarrage — les deux jobs devraient afficher **UP**. Une cible bloquée en **DOWN** avec un 401 signifie que le token dans `prometheus.yml` ne correspond pas à `METRICS_BEARER_TOKEN` ; une erreur de connexion signifie que le nom d'hôte ou le schéma est faux.

## Un tableau de bord de départ

Pointe d'abord Grafana sur Prometheus — ajoute une source de données Prometheus à `http://prometheus:9090` (Grafana l'atteint par le nom de service compose). Construis ensuite un tableau de bord à partir de ces panneaux ; les trois premiers utilisent des métriques toujours présentes, et le reste correspond aux signaux dans [Opérations](/fr/self-hosted/operate/observability/operations).

| Panneau             | Requête                                                                                                                            | Se lit comme                                                              |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Cibles up           | `up{job=~"tale-.*"}`                                                                                                               | `1` par endpoint sain, `0` quand le scraping échoue                       |
| 5xx backend         | `sum(rate(tale_backend_http_requests_total{status="5xx"}[5m])) / sum(rate(tale_backend_http_requests_total[5m]))`                   | Part des requêtes en échec — le signal qui touche les clients             |
| Latence de requête  | `histogram_quantile(0.95, sum by (le) (rate(tale_backend_http_request_duration_seconds_bucket[5m])))`                               | p95 sur les classes de route ; découpe par `route` pour le détail         |
| Arriéré de file     | `tale_backend_jobs{state="created"}`                                                                                               | Travail qui attend un worker — un plancher qui monte veut dire qu'il est à l'arrêt |
| Jobs en échec       | `tale_backend_jobs{state="failed"}`                                                                                                | Jobs qui ont épuisé leurs retries                                         |
| Tours en cours      | `tale_backend_generations_inflight`                                                                                                | Générations de chat qui tournent maintenant                               |
| Streams de hints    | `tale_backend_hint_streams_open`                                                                                                   | Navigateurs connectés ; `0` avec des utilisateurs en ligne = SSE cassé    |
| Lag de l'event-loop | `nodejs_eventloop_lag_seconds{job="tale-platform"}`                                                                                | Bondit quand la couche web est saturée                                    |

Les deux endpoints portent les métriques de processus par défaut de Node (CPU, mémoire, lag de l'event-loop, GC). Les séries applicatives ci-dessus sont celles du backend, et le label `route` est une classe bornée (`/api/app/<segment>`, `/api/v1`, `/dav`, `/events`, …) plutôt que le chemin brut, donc découper un panneau par route ne fait jamais exploser le nombre de séries. Ouvre l'endpoint une fois (`curl -H "Authorization: Bearer $TOKEN" https://tale.example.com/metrics/backend`) pour lire les noms exacts qu'expose ta version.

## Une première règle d'alerte

Commence par le seul signal sans ambiguïté — une cible de métriques qui cesse de répondre. Ajoute ce fichier de règle à Prometheus (monte-le et référence-le sous `rule_files:` dans `prometheus.yml`), puis câble Alertmanager ou l'alerting Grafana sur ton pager.

```yaml
groups:
  - name: tale
    rules:
      - alert: TaleTargetDown
        expr: up{job=~"tale-.*"} == 0
        for: 2m
        labels: { severity: page }
        annotations:
          summary: 'Tale metrics target {{ $labels.job }} is down'
```

La liste complète de ce qui vaut un page contre ce qui peut attendre — taux de 5xx du backend, saturation du pool Postgres, arriéré de la file de jobs, joignabilité de la base de connaissances, sauvegarde-quotidienne-non-écrite — est le tableau de signaux dans [Opérations](/fr/self-hosted/operate/observability/operations) ; traduis chaque ligne en règle dès que la série correspondante est sur ton tableau de bord.

## Où cela s'inscrit

Cette page transforme les endpoints de métriques documentés en un stack Prometheus et Grafana qui tourne : un override compose, une config de scrape à deux jobs, un tableau de bord de départ et une alerte cible-down que tu étoffes avec les seuils d'Opérations. Garde les deux services liés à localhost et le bearer token hors du disque en clair, et toute la surface de monitoring reste sur l'hôte avec Tale.

Les endpoints et le token qui les protège appartiennent à [Configuration de l'observabilité](/fr/self-hosted/configuration/observability-config) ; les seuils et la checklist d'astreinte sont [Opérations](/fr/self-hosted/operate/observability/operations). Quand un panneau passe au rouge, la recherche symptôme-vers-correction est [Dépannage](/fr/self-hosted/operate/observability/troubleshooting).
