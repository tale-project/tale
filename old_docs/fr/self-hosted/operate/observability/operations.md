---
title: Exploitation
description: Supervision, suivi d'erreurs, journaux, sauvegardes de base, health checks et validation des conteneurs.
---

L'exploitation, c'est tout ce qui se passe après que Tale tourne — les métriques que tu scrapes, les journaux que tu expédies, les sauvegardes que tu prends, les sondes de santé que tu alarmes. Cette page est l'index pour les opérateurs qui vivent avec une instance de production au quotidien : ce que chaque service expose, comment le brancher dans un stack Prometheus et un agrégateur de logs, et les étapes de validation qui prouvent qu'un déploiement est réellement sain.

Les valeurs par défaut sont assez raisonnables pour qu'une installation fraîche soit exploitable dès le premier jour. Le travail documenté ci-dessous est ce que tu règles une fois que tu as du trafic à protéger.

## Supervision

Chaque service Tale expose un endpoint `/metrics` au format texte Prometheus sur le réseau Docker interne. Les endpoints sont utiles aux health checks entre services de la plateforme elle-même, même quand rien d'externe ne les scrape ; pour les exposer à travers le proxy à un Prometheus externe, pose un jeton bearer dans `.env` :

```dotenv
METRICS_BEARER_TOKEN=your-secret-token-here
```

Les surfaces de métriques répondent alors sur l'URL publique derrière le proxy :

| Service        | Endpoint de métriques                     |
| -------------- | ----------------------------------------- |
| Crawler        | `https://yourdomain.com/metrics/crawler`  |
| RAG            | `https://yourdomain.com/metrics/rag`      |
| Platform (Bun) | `https://yourdomain.com/metrics/platform` |
| Convex         | `https://yourdomain.com/metrics/convex`   |

Le backend Convex expose plus de 260 métriques intégrées qui couvrent la latence des queries, le débit des mutations, la profondeur de file du scheduler et le nombre d'appels par fonction. Quand le jeton bearer n'est pas posé, chaque endpoint `/metrics/*` répond `401` — c'est volontaire, parce que les métriques portent assez de détail opérationnel pour mériter une protection.

### Configuration de scrape Prometheus

```yaml
scrape_configs:
  - job_name: tale-crawler
    scheme: https
    metrics_path: /metrics/crawler
    authorization:
      credentials: your-secret-token-here
    static_configs:
      - targets: ['your-tale-host.com']

  # Répète pour tale-rag, tale-platform, tale-convex — seuls metrics_path et job_name changent.
```

Les quatre blocs `job_name` ne diffèrent que par les chaînes `metrics_path` et `job_name`, donc la plupart des opérateurs collent la même configuration quatre fois avec une ligne changée.

## Suivi d'erreurs

Le pipeline d'erreurs de Tale parle le format DSN Sentry. Sentry auto-hébergé, GlitchTip et Bugsink acceptent tous la même forme de DSN, donc n'importe lequel marche en remplacement direct. Pose le DSN dans `.env` :

```dotenv
SENTRY_DSN=https://your-key@your-sentry-host/project-id
```

Avec `SENTRY_DSN` non posé, le suivi d'erreurs est désactivé et les erreurs n'apparaissent que dans les logs Docker. La variable `SENTRY_TRACES_SAMPLE_RATE` contrôle la fraction de transactions envoyées pour le traçage de performance ; la valeur par défaut de `1.0` (chaque transaction) est correcte pour des instances à faible trafic, et tu l'abaisserais sur un déploiement de production chargé.

## Journaux

Tous les journaux de service vont vers stdout Docker. Le fichier compose plafonne chaque conteneur à 10 Mo par fichier de log avec trois fichiers rotatés gardés, pour qu'un service qui dérape ne remplisse pas le disque pendant la nuit.

```bash
# Streame le log de chaque service.
docker compose logs -f

# Streame un service.
docker compose logs -f rag

# Lignes récentes sans streaming.
docker compose logs --tail=100 platform
```

Quand le stack tourne sous `tale deploy`, `tale logs <service>` est la même image filtrée par la couleur blue-green active — utile quand les deux couleurs existent brièvement pendant un déploiement et que tu ne veux que la nouvelle.

## Sauvegardes de base

Le conteneur `db` livré contient chaque pièce d'état persistant que Tale écrit — tables Convex, embeddings RAG, URL du crawler, journal d'audit, tout. Prends un instantané avec `pg_dump` dans le conteneur :

```bash
docker exec tale-db pg_dump -U tale tale > backup-$(date +%Y%m%d).sql
```

La restauration est l'inverse :

```bash
docker exec -i tale-db psql -U tale tale < backup-20260101.sql
```

Pour la production, planifie le dump via cron et expédie le fichier hors de l'hôte. Le volume nommé `db-backup` monté sur `/var/lib/postgresql/backup` est la zone de transit pour l'expédition hors hôte ; le compose livré le monte mais n'y écrit pas automatiquement.

## Health checks

Chaque service répond à un endpoint de santé que le proxy et le healthcheck propre à Docker interrogent aussi :

| Endpoint                       | Ce qu'il vérifie                                                        |
| ------------------------------ | ----------------------------------------------------------------------- |
| `GET /health`                  | Le proxy tourne et écoute.                                              |
| `GET /api/health`              | La plateforme est en marche et Convex est joignable depuis l'intérieur. |
| `http://localhost:8001/health` | RAG tourne et le pool de base est connecté.                             |
| `http://localhost:8002/health` | Le crawler tourne et le moteur de navigateur est initialisé.            |

L'endpoint plateforme est la sonde la plus utile pendant un déploiement parce qu'il exerce la chaîne complète — Bun qui répond, Convex joignable, le fichier de readiness écrit par l'entrypoint après la synchronisation d'environnement.

## Validation de la santé des conteneurs

Deux scripts valident un build frais avant que tu le pousses en production. Les deux tournent en CI à chaque pull request et les deux sont sûrs à faire tourner sur un hôte de développement.

```bash
bun run docker:test
```

Il construit chaque image, démarre chaque conteneur sur des ports sans conflit (le compose de test utilise la plage `13000+`), valide les endpoints de santé, exerce la connectivité entre services et fait le démontage. C'est ce qui se rapproche le plus d'un vrai déploiement de production qui tient sur un portable.

Pour la validation au niveau image — labels OCI, pas de secrets dans les couches, budgets de taille, utilisateur non-root, instruction HEALTHCHECK :

```bash
bun run docker:test:image
```

Les deux scripts sont documentés en détail sur le [guide Contributing Docker](/fr/develop/contributing-docker).

## Supervision de taille d'image

Chaque image de conteneur a un budget de taille imposé par la CI. Les tailles actuelles et les budgets :

| Service  | Taille actuelle | Budget |
| -------- | --------------- | ------ |
| Crawler  | ~1,85 Go        | 2,1 Go |
| RAG      | ~515 Mo         | 600 Mo |
| Platform | ~320 Mo         | 400 Mo |
| Convex   | ~485 Mo         | 600 Mo |
| DB       | ~1,06 Go        | 1,2 Go |
| Proxy    | ~88 Mo          | 100 Mo |

Un changement qui pousse une image au-dessus de son budget fait échouer `bun run docker:test:image`. La page [Architecture des conteneurs](/fr/self-hosted/operate/container-architecture) couvre les stratégies de build multi-étapes qui gardent chaque image dans son budget.

## Où cela s'insère

L'exploitation est la surface du jour pour l'opérateur qui fait tourner Tale en production — métriques à scraper, journaux à expédier, sondes de santé à surveiller, budgets d'image à imposer. Quand quelque chose commence à dérailler sur une instance vivante, [Dépannage](/fr/self-hosted/operate/observability/troubleshooting) est la carte symptôme-vers-correction ; pour le modèle architectural derrière les services qui émettent ces métriques, [Architecture des conteneurs](/fr/self-hosted/operate/container-architecture) est à un clic.
