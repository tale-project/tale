---
title: Référence d’environnement
description: Référence complète de toutes les variables d’environnement pour configurer Tale.
---

Toute la configuration passe par des variables d’environnement dans `.env`. Copie `.env.example` vers `.env` et renseigne tes valeurs.

## Configuration domaine

| Variable    | Requis | Défaut               | Description                                                                                                |
| ----------- | ------ | -------------------- | ---------------------------------------------------------------------------------------------------------- |
| `HOST`      | Oui    | `tale.local`         | nom d’hôte sans protocole (utilisé pour le réseau Docker et les e-mails).                                  |
| `SITE_URL`  | Oui    | `https://tale.local` | URL canonique complète avec protocole (utilisée pour liens externes et callbacks d’auth).                  |
| `BASE_PATH` | Non    |                      | chemin de base pour déploiement en sous-chemin (ex. `/app`). Laisser vide pour un déploiement à la racine. |

`SITE_URL` doit matcher l’URL que voient les utilisateurs, y compris les ports non standard (ex. `https://example.com:8443`).

## TLS/SSL

| Variable    | Requis | Défaut       | Description                                                        |
| ----------- | ------ | ------------ | ------------------------------------------------------------------ |
| `TLS_MODE`  | Non    | `selfsigned` | gestion du certificat : `selfsigned`, `letsencrypt` ou `external`. |
| `TLS_EMAIL` | Non    |              | e-mail pour les notifications Let’s Encrypt (recommandé en prod).  |

- **selfsigned** : certificats auto-signés pour le dev. Le navigateur avertit.
- **letsencrypt** : certificats gratuits de confiance. Exige un domaine public valide et les ports 80/443 joignables.
- **external** : TLS géré par un reverse proxy externe. Caddy n’écoute qu’en HTTP.

## Secrets de sécurité

| Variable                | Requis | Description                                                                                                                                                                                                                                                                                        |
| ----------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BETTER_AUTH_SECRET`    | Oui    | clé de signature des sessions d’auth. Générer avec : `openssl rand -base64 32`.                                                                                                                                                                                                                    |
| `ENCRYPTION_SECRET_HEX` | Oui    | clé de chiffrement pour données sensibles, y compris les secrets de guardrails stockés en base (clés API de modération, etc.). Générer avec : `openssl rand -hex 32`. La rotation de cette valeur invalide tous les secrets de guardrails stockés — les Admins doivent les réenregistrer via l’UI. |
| `INSTANCE_SECRET`       | Non    | secret d’instance Convex. Générer avec : `openssl rand -hex 32`.                                                                                                                                                                                                                                   |
| `SOPS_AGE_KEY`          | Non    | clé secrète age pour le chiffrement [SOPS](https://github.com/getsops/sops) de `providers/*.secrets.json`. Si défini, les secrets de fournisseur sont stockés chiffrés ; sinon en clair avec mode de fichier `0600`. Généré automatiquement par `tale init`.                                       |
| `SOPS_AGE_KEY_FILE`     | Non    | alternative à `SOPS_AGE_KEY` : chemin d’un fichier contenant la clé secrète age. L’une ou l’autre variable active le mode chiffré pour les secrets de fournisseur.                                                                                                                                 |

> **Important :** `.env.example` livre des secrets d’exemple. Tu dois les remplacer par les tiens avant démarrage, même en dev local.

## Fournisseurs IA

La configuration des fournisseurs IA (clés API, base URLs, modèles) passe par des fichiers dans `providers/`, pas par des variables d’environnement. Voir la page Paramètres > Fournisseurs IA dans l’admin UI, ou édite les JSON directement.

- `providers/<name>.json` — config publique (base URL, modèles, tags).
- `providers/<name>.secrets.json` — clé API. Chiffrée par SOPS quand `SOPS_AGE_KEY` est défini ; sinon en clair avec mode `0600`. Auto-créée par `tale init` et l’UI Paramètres.

## Base de données

| Variable               | Requis | Défaut | Description                                                                                                      |
| ---------------------- | ------ | ------ | ---------------------------------------------------------------------------------------------------------------- |
| `DB_PASSWORD`          | Oui    |        | mot de passe pour la base PostgreSQL auto-hébergée.                                                              |
| `POSTGRES_URL`         | Non    |        | surcharge l’URL de connexion auto-générée. Sinon calculée comme `postgresql://tale:${DB_PASSWORD}@db:5432`.      |
| `RAG_DATABASE_URL`     | Non    |        | surcharge l’URL DB pour le service RAG (doit inclure le nom de base, ex. `postgresql://...host/tale_knowledge`). |
| `CRAWLER_DATABASE_URL` | Non    |        | surcharge l’URL DB pour le service Crawler (doit inclure le nom de base).                                        |

Pour utiliser une instance PostgreSQL externe au lieu du conteneur fourni, voir [Utiliser une base externe](/fr/self-hosted/install/linux-server#utiliser-une-base-externe).

## Tracking d’erreurs

| Variable     | Requis | Défaut | Description                                                   |
| ------------ | ------ | ------ | ------------------------------------------------------------- |
| `SENTRY_DSN` | Non    |        | DSN Sentry pour le tracking. Compatible GlitchTip et Bugsink. |

Sans valeur, le tracking est désactivé et les erreurs n’apparaissent que dans les logs Docker.

## Monitoring

| Variable               | Requis | Défaut | Description                                                 |
| ---------------------- | ------ | ------ | ----------------------------------------------------------- |
| `METRICS_BEARER_TOKEN` | Non    |        | bearer token pour l’accès externe aux métriques Prometheus. |

Non défini, les endpoints `/metrics/*` renvoient `401`. Voir [Operations](/fr/self-hosted/operate/observability/operations) pour les détails.

## URLs des services

Automatiques dans Docker Compose, surchargeables pour des setups personnalisés :

| Variable      | Défaut                | Description                                    |
| ------------- | --------------------- | ---------------------------------------------- |
| `CRAWLER_URL` | `http://crawler:8002` | service Crawler pour le crawling.              |
| `RAG_URL`     | `http://rag:8001`     | service RAG pour l’indexation et la recherche. |

## Déploiement Docker

| Variable      | Requis | Défaut | Description                                                                         |
| ------------- | ------ | ------ | ----------------------------------------------------------------------------------- |
| `PULL_POLICY` | Non    |        | `always` pour utiliser des images pré-construites depuis GitHub.                    |
| `VERSION`     | Non    |        | tag de version d’image (ex. `latest`, `v1.0.0`). Utilisé avec `PULL_POLICY=always`. |

## SSO Microsoft Entra ID

Ces variables ne sont nécessaires que si tu configures le SSO via environnement au lieu de l’UI Paramètres > Intégrations.

| Variable                            | Requis | Description                                 |
| ----------------------------------- | ------ | ------------------------------------------- |
| `AUTH_MICROSOFT_ENTRA_ID_ID`        | Non    | Application (client) ID Microsoft Entra ID. |
| `AUTH_MICROSOFT_ENTRA_ID_SECRET`    | Non    | Client secret Microsoft Entra ID.           |
| `AUTH_MICROSOFT_ENTRA_ID_TENANT_ID` | Non    | Tenant ID Microsoft Entra ID.               |

## Authentification par trusted headers

| Variable                          | Requis | Description                                                                 |
| --------------------------------- | ------ | --------------------------------------------------------------------------- |
| `TRUSTED_HEADERS_ENABLED`         | Non    | `true` pour activer l’auth Trusted Headers.                                 |
| `TRUSTED_HEADERS_INTERNAL_SECRET` | Non    | secret partagé pour valider les requêtes Trusted Header (defense-in-depth). |
| `TRUSTED_EMAIL_HEADER`            | Non    | nom du header e-mail (défaut : `Remote-Email`).                             |
| `TRUSTED_NAME_HEADER`             | Non    | nom du header nom affiché (défaut : `Remote-Name`).                         |
| `TRUSTED_ROLE_HEADER`             | Non    | nom du header rôle (défaut : `Remote-Role`).                                |
| `TRUSTED_TEAMS_HEADER`            | Non    | nom du header équipes (défaut : `Remote-Teams`).                            |

Voir le [guide d’authentification](/fr/self-hosted/admin/authentication) pour configurer les Trusted Headers.
