---
title: Exploitation
description: Monitoring, tracking d'erreurs, logs, backups DB, health checks et validation des conteneurs.
---

## Monitoring

Tous les services Tale exposent un endpoint Prometheus `/metrics` sur le réseau Docker interne. Pour l'accès externe, définis un bearer token dans ton `.env` :

```dotenv
METRICS_BEARER_TOKEN=your-secret-token-here
```

Les métriques sont alors accessibles sur :

| Service        | Endpoint métriques                        |
| -------------- | ----------------------------------------- |
| Crawler        | `https://yourdomain.com/metrics/crawler`  |
| RAG            | `https://yourdomain.com/metrics/rag`      |
| Platform (Bun) | `https://yourdomain.com/metrics/platform` |
| Convex         | `https://yourdomain.com/metrics/convex`   |

> **Note :** Le backend Convex expose plus de 260 métriques intégrées couvrant latence des requêtes, débit des mutations et performance du scheduler.

Sans token, tous les endpoints `/metrics/*` renvoient `401`.

### Config de scrape Prometheus

```yaml
scrape_configs:
  - job_name: tale-crawler
    scheme: https
    metrics_path: /metrics/crawler
    authorization:
      credentials: your-secret-token-here
    static_configs:
      - targets: ['your-tale-host.com']

  # Répéter pour tale-rag, tale-platform, tale-convex
  # en changeant metrics_path en conséquence.
```

## Tracking d'erreurs

Tale supporte Sentry et des alternatives compatibles comme GlitchTip. Définis ton DSN dans `.env` :

```dotenv
SENTRY_DSN=https://your-key@your-sentry-host/project-id
```

Si `SENTRY_DSN` n'est pas défini, le tracking est désactivé et les erreurs n'apparaissent que dans les logs Docker.

## Consulter les logs

Tous les logs partent vers stdout Docker avec rotation automatique à 10 Mo par fichier, 3 fichiers conservés par service.

```bash
# Stream de tous les logs
docker compose logs -f

# Stream pour un service précis
docker compose logs -f rag

# Voir les derniers logs sans stream
docker compose logs --tail=100 platform
```

## Backups DB

Créer un snapshot DB :

```bash
docker exec tale-db pg_dump -U tale tale > backup-$(date +%Y%m%d).sql
```

Restaurer depuis un backup :

```bash
docker exec -i tale-db psql -U tale tale < backup-20260101.sql
```

## Health checks

Chaque service a un endpoint de health check :

| Endpoint                       | Ce qu'il vérifie                                       |
| ------------------------------ | ------------------------------------------------------ |
| `GET /health`                  | le proxy tourne et écoute.                             |
| `GET /api/health`              | platform est up et le backend Convex joignable.        |
| `http://localhost:8001/health` | le service RAG tourne et le pool DB est connecté.      |
| `http://localhost:8002/health` | le service Crawler et le moteur navigateur sont prêts. |

## Validation de santé des conteneurs

Pour valider que tous les conteneurs sont sains après un déploiement ou changement de config, lance le smoke test :

```bash
bun run docker:test
```

Il construit toutes les images, les démarre sur des ports non conflictuels, valide les endpoints de santé et la connectivité inter-services, puis arrête tout. C'est le même test qui tourne en CI sur chaque PR.

Pour la validation d'image (labels OCI, pas de secrets, budgets de taille) :

```bash
bun run docker:test:image
```

## Monitoring de la taille des images

Chaque image a un budget de taille imposé par CI. Tailles et budgets actuels :

| Service    | Taille actuelle | Budget   |
| ---------- | --------------- | -------- |
| Crawler    | ~1,85 Go        | 2,1 Go   |
| RAG        | ~515 Mo         | 600 Mo   |
| Platform   | ~2,58 Go        | 2,9 Go   |
| DB         | ~1,06 Go        | 1,2 Go   |
| Proxy      | ~88 Mo          | 100 Mo   |

Si une image dépasse son budget après changement, `bun run docker:test:image` échoue. Voir la page [Architecture des conteneurs](/fr-CH/operate/deployment/container-architecture) pour les stratégies multi-stage qui gardent les images légères.
