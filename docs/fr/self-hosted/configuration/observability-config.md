---
title: Configurer la supervision
description: Consulter les journaux, collecter les métriques protégées et choisir la destination des rapports d’erreur.
---
Commence par les journaux des conteneurs et l’état des services. Ajoute les métriques Prometheus pour suivre les tendances et déclencher des alertes, puis un service de suivi des erreurs si tu veux consulter leur historique. Tale n’envoie ces données à un service de supervision externe que si tu en configures un.

## Consulter les journaux de l’application

Les conteneurs écrivent sur stdout et stderr. La configuration Compose fournie utilise le pilote Docker `json-file`, avec une rotation à 10 Mo par fichier et trois fichiers par conteneur. Utilise les noms de services de ton fichier Compose :

```bash
docker compose logs --tail=100 backend-api backend-worker
docker compose logs -f backend-api
```

Appuie sur `Ctrl-C` pour arrêter le suivi ; les conteneurs continuent de fonctionner. Consulte `backend-api` pour les requêtes, la connexion et les réponses du chat interactif ; utilise `backend-worker` pour les tâches de fond, les appels d’agent mis en file et l’importation des documents. `docker compose ps` permet de repérer un conteneur qui redémarre en boucle.

`journalctl -u docker` affiche le journal du démon Docker. Avec le pilote par défaut `json-file`, il ne remplace pas les journaux des conteneurs. Pour utiliser journald ou centraliser les journaux, configure séparément le pilote Docker et leur collecte. Tale ne fournit pas d’agent de collecte. Un changement de pilote exige de recréer les conteneurs concernés.

## Activer les métriques protégées {#metriques}

Définis un `METRICS_BEARER_TOKEN` robuste dans l’environnement du déploiement. Applique la modification avec ta procédure habituelle afin de recréer les services concernés. Un simple redémarrage de conteneur ne recharge pas les variables d’environnement de Compose. Enregistre le même jeton dans le gestionnaire de secrets de ton système de supervision.

Le proxy exige `Authorization: Bearer <token>` pour ces routes. Sans jeton configuré, elles renvoient **401**.

| Route | Contenu | Utilisation |
| --- | --- | --- |
| `/metrics/platform` | Métriques du processus web et objectifs de temps de réponse | Cible de collecte Prometheus |
| `/metrics/backend` | Métriques HTTP et système du backend, files d’attente, générations actives et état d’arrêt progressif | Cible de collecte Prometheus |
| `/metrics/sla-rules` | Règles d’enregistrement et d’alerte générées en YAML | Fichier de règles Prometheus |

Le backend traite les recherches de connaissances et les tâches d’importation. Ses métriques HTTP et de file d’attente aident à repérer les erreurs et les retards ; elles ne mesurent pas séparément la durée de la recherche ou de la génération. `BACKEND_UPSTREAM` désigne la cible backend d’un déploiement séparé. Cette variable ne crée pas de service de métriques propre aux connaissances.

Crée une tâche de collecte par route. Dans cet exemple, `/run/secrets/tale_metrics_token` est un fichier du conteneur Prometheus qui contient uniquement le jeton. Crée-le avec ton gestionnaire de secrets et autorise Prometheus à le lire.

```yaml
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

Ne collecte pas `/metrics/sla-rules` comme des métriques. Les règles générées utilisent des séries de latence qui nécessitent une instrumentation supplémentaire. Charger le fichier ne suffit pas à mesurer le respect des objectifs de réponse. Examine les règles avant de les charger dans Prometheus. La page [Prometheus et Grafana](/fr/self-hosted/operate/observability/prometheus-grafana) détaille l’installation complète.

## Choisir la destination des erreurs

`SENTRY_DSN` active le suivi facultatif des erreurs. Il peut désigner Sentry ou un service compatible comme GlitchTip ou Bugsink. Le navigateur et le backend utilisent ce DSN ; les événements du backend indiquent le rôle du processus et la version déployée.

```bash
SENTRY_DSN=https://your-key@your-sentry-host/project-id
SENTRY_TRACES_SAMPLE_RATE=0.1
```

Le taux d’échantillonnage concerne les traces de performance du navigateur. Le backend envoie des erreurs, pas de traces de performance. Le taux par défaut des traces du navigateur est de 1.0 en développement. Choisis un taux adapté à ton budget de supervision en production. Les cadres de pile sont envoyés sans masquage ; choisis la destination selon tes exigences de traitement des données.

## Connaître les limites

Tale n’exporte actuellement pas de traces OpenTelemetry par OTLP. Un OpenTelemetry Collector peut collecter les métriques Prometheus, mais cette collecte ne produit pas de traces distribuées. L’export de traces de bout en bout exige aussi une instrumentation de l’application.

Pour les seuils d’alerte et les procédures d’intervention, consulte [Exploitation](/fr/self-hosted/operate/observability/operations). Si un service échoue, utilise les tableaux de symptômes du [Dépannage](/fr/self-hosted/operate/observability/troubleshooting).
