---
title: Configuration de l'observabilité
description: Les variables d'env et flags qui activent les logs, les métriques et le suivi d'erreurs — et où chacune route quoi.
---

Tale ship trois coutures d'observabilité : logs stdout depuis chaque conteneur, métriques au format Prometheus derrière un bearer token, et reporting d'erreurs Sentry optionnel. Les défauts sont assez bruyants pour repérer un crash et assez discrets pour tenir dans le journald d'un seul hôte ; les boutons de production ci-dessous ajoutent les chemins structurés que ta stack de monitoring existante peut scraper. Aucune des trois n'envoie quoi que ce soit hors-hôte sauf si tu le configures.

Cette page couvre les interrupteurs côté serveur. Le playbook d'alerte côté opérateur vit dans [Opérations](/fr/self-hosted/operate/observability/operations), et la recherche par symptôme dans [Dépannage](/fr/self-hosted/operate/observability/troubleshooting).

## Logs

Chaque conteneur écrit des logs JSON structurés ou console vers stdout, capturés par le driver `json-file` par défaut de Docker avec une rotation de 10 Mo par fichier et 3 fichiers. La destination des logs est fonction de comment tu déploies :

- Hôte unique avec journald — `journalctl -u docker` porte le tout.
- Hôte unique sans journald — `docker compose logs -f <service>` pour le tailing en direct.
- Aggregator (Loki, Vector, Fluent Bit) — pointe le driver de logging Docker dessus via `daemon.json`.

Tale ne ship pas de log shipper. L'échange de driver est le point de connector supporté.

## Métriques

Le proxy Caddy expose jusqu'à quatre chemins de métriques derrière un seul bearer token :

| Chemin               | Source          | Ce qui est dedans                                                                                       |
| -------------------- | --------------- | ------------------------------------------------------------------------------------------------------- |
| `/metrics/platform`  | `tale-platform` | Latence HTTP, compteurs de routes, métriques de processus Node, gauges de cible SLA de temps de réponse |
| `/metrics/convex`    | `tale-convex`   | 261 métriques Convex intégrées, plus les timings RAG et de crawl                                        |
| `/metrics/sla-rules` | `tale-platform` | Rules Prometheus de recording + alerting générées pour les SLA de temps de réponse                      |
| `/metrics/backend`   | `tale-backend-api` | Métriques process, compteurs et latence HTTP par classe de route, profondeur de queue par état de job, générations de chat en cours, streams de hints ouverts, état de drain, et les mêmes gauges de cible SLA |

Le travail de connaissances (recherche RAG, ingestion de documents, crawling web) tourne désormais dans le backend Convex, donc ses timings empruntent la série `/metrics/convex` plutôt qu'un endpoint séparé. Mets `METRICS_BEARER_TOKEN` dans `.env` pour activer ces endpoints ; laisse-le non défini pour qu'ils retournent 401 à chaque requête. Le chemin `/metrics/sla-rules` est un fichier YAML de rules en lecture seule que tu charges dans Prometheus, pas une cible de scrape — les seuils qu'il porte sont documentés dans [Opérations](/fr/self-hosted/operate/observability/operations). Tout sauf les chemins listés retourne aussi 401, donc un scraper mal routé ne voit pas accidentellement les endpoints de santé internes de la plateforme.

`/metrics/backend` n'existe qu'une fois le déploiement basculé sur le backend Postgres (`BACKEND_UPSTREAM` défini dans `.env`). Avant la bascule, le chemin répond 404 au lieu de servir en silence les chiffres d'un autre service sous le nom du backend : une cible de scrape ajoutée trop tôt échoue visiblement au lieu de tracer le mauvais processus.

Une stanza de scrape Prometheus qui marche :

```yaml
scrape_configs:
  - job_name: tale-platform
    scheme: https
    metrics_path: /metrics/platform
    authorization:
      credentials: <METRICS_BEARER_TOKEN>
    static_configs:
      - targets: ['tale.example.com']
```

Duplique la stanza par chemin, ou utilise un job unique avec `relabel_configs` si tu préfères.

## Suivi d'erreurs avec Sentry

Sentry est opt-in via `SENTRY_DSN`. GlitchTip et Bugsink auto-hébergés marchent aussi, puisqu'ils parlent le même format de DSN. Les conteneurs plateforme et convex lisent tous les deux le DSN et taguent les événements avec le nom du conteneur.

```bash
# .env
SENTRY_DSN=https://your-key@your-sentry-host/project-id
SENTRY_TRACES_SAMPLE_RATE=0.1
```

Le sample rate plafonne les traces de performance ; laisse-le non défini pour le défaut 1.0 en développement et resserre-le (0.05–0.2) en production. Les stack frames sont envoyés sans rédaction, donc pointe le DSN sur une infra que tu contrôles si tes payloads d'erreur sont sensibles.

## Ce qui ne ship pas encore

Les traces OpenTelemetry ne sont pas intégrées aux conteneurs. Les données sont joignables indirectement — les durées d'action Convex et les timings de routes HTTP arrivent par les métriques Prometheus — mais il n'y a pas d'exportateur OTLP sur la boîte aujourd'hui. Si tu as besoin d'export de traces complet, fais tourner un OpenTelemetry Collector à côté de Tale et scrape les endpoints Prometheus depuis lui.

## Où cela s'inscrit

Les trois coutures ci-dessus sont les points de contact avec le reste de ta stack de monitoring ; les seuils d'alerte et la checklist d'astreinte vivent dans [Opérations](/fr/self-hosted/operate/observability/operations). Si quelque chose brûle là, maintenant, et qu'il te faut l'index par symptôme, saute à [Dépannage](/fr/self-hosted/operate/observability/troubleshooting).
