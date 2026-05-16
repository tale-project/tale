---
title: Référence d'environnement
description: Référence complète de toutes les variables d'environnement qui configurent Tale.
---

La référence d'environnement catalogue chaque variable que Tale lit au démarrage des conteneurs. Un opérateur consulte cette page quand un bouton a besoin de bouger — un domaine, un mode TLS, un tenant SSO — et de nouveau quand le runtime attendait quelque chose qu'il ne trouve pas. La source de vérité est `.env.example` et les loaders d'environnement par service ; les tableaux ci-dessous sont groupés par surface pour garder les variables qui gouvernent une même préoccupation côte à côte.

Chaque variable vit dans `.env` à la racine du projet. `tale init` provisionne le fichier avec des valeurs par défaut raisonnables ; les déploiements de production surchargent le domaine, le TLS et la base de données, et la plupart des installations ne touchent à rien d'autre.

## Comment lire cette page

Les variables sont groupées par ce qu'elles contrôlent — domaine, TLS, secrets, base de données, supervision, SSO, en-têtes de confiance, rétention, déploiement. Chaque groupe s'ouvre par une phrase ou deux qui nomment ce qu'il gouverne, puis un tableau `Nom | Défaut | Description`. Les variables sans valeur par défaut sont absentes par défaut ; quand une variable requise manque, le conteneur refuse de démarrer avec le message recensé sur la page [Dépannage](/fr/self-hosted/operate/observability/troubleshooting).

Les changements prennent effet au démarrage du conteneur, donc éditer `.env` demande un `tale deploy` (production) ou `tale start` (local) pour être lu. Un stack en marche ne relit jamais `.env`.

## Domaine

`HOST` est le nom d'hôte que Docker utilise pour le routage interne et le courriel ; `SITE_URL` est l'URL complète que les utilisateurs tapent dans un navigateur, port non standard inclus. `BASE_PATH` n'est défini que quand un proxy en amont sert Tale sous un sous-chemin.

| Nom         | Défaut               | Description                                                                                                |
| ----------- | -------------------- | ---------------------------------------------------------------------------------------------------------- |
| `HOST`      | `tale.local`         | Nom d'hôte sans protocole. Sert d'alias sur le réseau Docker et d'en-tête de courriel sortant.             |
| `SITE_URL`  | `https://tale.local` | URL canonique complète avec protocole. Sert aux liens externes et aux callbacks d'authentification.        |
| `BASE_PATH` | _(vide)_             | Sous-chemin quand un proxy ajoute un préfixe (p. ex. `/app`). Laisse vide pour un déploiement à la racine. |

`SITE_URL` doit correspondre à l'URL que les utilisateurs atteignent réellement. Si ton reverse proxy écoute sur `:8443`, inclus-le : `SITE_URL=https://example.com:8443`. Le proxy construit avec cette valeur les URL de callback OAuth et le lien de réinitialisation de mot de passe, donc une divergence casse silencieusement les deux flux.

## TLS

Trois modes couvrent les options de certificat. `selfsigned` est le défaut local ; `letsencrypt` est le défaut de production ; `external` correspond aux déploiements où un proxy en amont termine déjà le TLS.

| Nom         | Défaut       | Description                                                                                 |
| ----------- | ------------ | ------------------------------------------------------------------------------------------- |
| `TLS_MODE`  | `selfsigned` | Gestion des certificats : `selfsigned`, `letsencrypt` ou `external`.                        |
| `TLS_EMAIL` | _(vide)_     | Courriel de contact pour les notifications ACME Let's Encrypt. Recommandé en `letsencrypt`. |

Les certificats auto-signés déclenchent un avertissement du navigateur jusqu'à ce que tu exécutes `docker exec tale-proxy caddy trust` sur l'hôte. Let's Encrypt a besoin que les ports 80 et 443 soient joignables depuis Internet public pour le défi ACME. Le mode externe fait tourner Caddy en HTTP uniquement ; le proxy en amont gère le TLS et propage les upgrades WebSocket pour le canal temps réel Convex.

## Secrets de sécurité

Voici les secrets sans lesquels la plateforme refuse de démarrer. `tale init` génère chacun d'eux ; les faire tourner invalide tout ce qui était chiffré avec l'ancienne valeur.

| Nom                     | Défaut     | Description                                                                                                                                       |
| ----------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BETTER_AUTH_SECRET`    | _(absent)_ | Clé de signature des sessions d'authentification. Génère avec `openssl rand -base64 32`. Requis.                                                  |
| `ENCRYPTION_SECRET_HEX` | _(absent)_ | Clé hex de 32 octets pour la secret box en base. Génère avec `openssl rand -hex 32`. La faire tourner invalide les secrets de garde-fous stockés. |
| `INSTANCE_SECRET`       | _(absent)_ | Graine pour la clé admin Convex que `tale deploy` dérive. Génère avec `openssl rand -hex 32`.                                                     |
| `SOPS_AGE_KEY`          | _(absent)_ | Clé age inline pour le chiffrement SOPS de `providers/*.secrets.json`. `tale init` la provisionne par défaut.                                     |
| `SOPS_AGE_KEY_FILE`     | _(absent)_ | Chemin vers un fichier contenant une ou plusieurs clés age, une par ligne. À utiliser pour la rotation de clés.                                   |

Le fichier `.env.example` livre des placeholders. Remplace chacun d'eux avant de démarrer le stack, même pour du développement local ; les placeholders sont publics sur GitHub et un attaquant capable de joindre l'instance peut forger des jetons d'authentification avec eux. Les modes SOPS — chiffré, texte clair, rotation de clés — sont couverts sur [Fournisseurs](/fr/self-hosted/configuration/providers#provider-secrets-storage).

## Base de données

`DB_PASSWORD` est le mot de passe du conteneur Postgres livré. Les variables de surcharge ne comptent que quand on pointe Tale sur une instance Postgres externe — le schéma complet est sur [Déploiement en production](/fr/self-hosted/install/linux-server#using-an-external-database).

| Nom                    | Défaut     | Description                                                                                                                                |
| ---------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `DB_PASSWORD`          | _(absent)_ | Mot de passe du Postgres livré. Requis quand le conteneur `db` est utilisé.                                                                |
| `POSTGRES_URL`         | _(absent)_ | Surcharge l'URL de connexion construite automatiquement. Format `postgresql://user:pass@host:port` sans nom de base. Convex ajoute `tale`. |
| `RAG_DATABASE_URL`     | _(absent)_ | Surcharge propre au service RAG. Inclus le nom de base (`/tale_knowledge`).                                                                |
| `CRAWLER_DATABASE_URL` | _(absent)_ | Surcharge propre au crawler. Inclus le nom de base (`/tale_knowledge`).                                                                    |

Sans `POSTGRES_URL`, Tale construit l'URL en `postgresql://tale:${DB_PASSWORD}@db:5432`. Les deux URL par service surchargent l'URL de base uniquement pour le service nommé, ce qui permet d'utiliser des réplicas en lecture et du routage par service.

## Suivi d'erreurs

Le pipeline d'erreurs de Tale parle le format DSN Sentry. Définis la variable sur un DSN Sentry, GlitchTip ou Bugsink ; laisse-la absente pour garder les erreurs uniquement dans les logs Docker.

| Nom                         | Défaut     | Description                                                                                   |
| --------------------------- | ---------- | --------------------------------------------------------------------------------------------- |
| `SENTRY_DSN`                | _(absent)_ | Endpoint DSN pour le rapport de crashs et d'erreurs. Compatible Sentry, GlitchTip et Bugsink. |
| `SENTRY_TRACES_SAMPLE_RATE` | `1.0`      | Fraction des transactions échantillonnées pour le traçage de performance. `0.0` désactive.    |

## Supervision

Chaque service expose un endpoint `/metrics` au format texte Prometheus sur le réseau Docker interne. Pour les exposer à travers le proxy, définis un jeton bearer :

| Nom                    | Défaut     | Description                                                                                                                    |
| ---------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `METRICS_BEARER_TOKEN` | _(absent)_ | Jeton bearer requis pour lire `/metrics/<service>` à travers le proxy. Sans valeur, chaque endpoint de métriques répond `401`. |

La liste complète des endpoints et un exemple de configuration de scrape Prometheus vivent sur [Exploitation](/fr/self-hosted/operate/observability/operations#monitoring).

## URL des services

Docker Compose câble automatiquement le trafic entre services, donc les URL ci-dessous ont rarement besoin d'être surchargées. Les variables existent pour les topologies sur mesure — RAG sur un hôte séparé, scaling horizontal du crawler, etc.

| Nom           | Défaut                | Description                                              |
| ------------- | --------------------- | -------------------------------------------------------- |
| `CRAWLER_URL` | `http://crawler:8002` | Endpoint du service crawler, consommé par la plateforme. |
| `RAG_URL`     | `http://rag:8001`     | Endpoint du service RAG, consommé par la plateforme.     |

## Docker

Ces variables contrôlent la manière dont `docker compose` et `tale deploy` récupèrent les images.

| Nom           | Défaut   | Description                                                                                          |
| ------------- | -------- | ---------------------------------------------------------------------------------------------------- |
| `PULL_POLICY` | `build`  | `build` pour le développement local ; `always` pour récupérer les images préconstruites depuis GHCR. |
| `VERSION`     | `latest` | Tag de version de l'image. Combine avec `PULL_POLICY=always` pour épingler une release.              |

## SSO Microsoft Entra

Ces trois variables ne comptent que quand on configure le SSO depuis `.env` plutôt que depuis l'écran **Paramètres > Intégrations**. La plupart des opérateurs passent par l'interface ; la forme variable d'environnement convient aux installations infrastructure-as-code où la config SSO vit dans le même dépôt que `.env`.

| Nom                                 | Défaut     | Description                              |
| ----------------------------------- | ---------- | ---------------------------------------- |
| `AUTH_MICROSOFT_ENTRA_ID_ID`        | _(absent)_ | Microsoft Entra application (client) ID. |
| `AUTH_MICROSOFT_ENTRA_ID_SECRET`    | _(absent)_ | Microsoft Entra client secret.           |
| `AUTH_MICROSOFT_ENTRA_ID_TENANT_ID` | _(absent)_ | Microsoft Entra directory (tenant) ID.   |

Le flux SSO de bout en bout vit sur [Authentification](/fr/self-hosted/admin/authentication#microsoft-entra-id-sso).

## En-têtes de confiance

Pour les déploiements derrière un reverse proxy authentifiant — Authelia, Authentik, oauth2-proxy — Tale lit l'identité de l'utilisateur dans les en-têtes HTTP que le proxy pose, puis provisionne un compte à la première requête.

| Nom                               | Défaut         | Description                                                                                                                         |
| --------------------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `TRUSTED_HEADERS_ENABLED`         | `false`        | À mettre à `true` pour activer l'authentification par en-têtes de confiance. La page de connexion est contournée quand c'est actif. |
| `TRUSTED_HEADERS_INTERNAL_SECRET` | _(absent)_     | Secret partagé que l'endpoint Convex vérifie avant d'honorer les en-têtes. Défense en profondeur.                                   |
| `TRUSTED_EMAIL_HEADER`            | `Remote-Email` | Nom de l'en-tête HTTP qui porte l'adresse de courriel de l'utilisateur.                                                             |
| `TRUSTED_NAME_HEADER`             | `Remote-Name`  | Nom de l'en-tête HTTP qui porte le nom affiché de l'utilisateur.                                                                    |
| `TRUSTED_ROLE_HEADER`             | `Remote-Role`  | Nom de l'en-tête HTTP qui porte le rôle (`admin`, `developer`, `editor` ou `member`).                                               |
| `TRUSTED_TEAMS_HEADER`            | `Remote-Teams` | Nom de l'en-tête HTTP qui porte une liste d'équipes au format `id:name` séparée par virgules.                                       |

N'active les en-têtes de confiance que quand le proxy en amont supprime ces mêmes en-têtes des requêtes externes. Si des clients externes peuvent les poser, ils peuvent se faire passer pour n'importe quel utilisateur. La configuration complète vit sur [Authentification](/fr/self-hosted/admin/authentication#trusted-headers).

## Rétention

Les bornes de rétention de chaque catégorie de données viennent de fichiers JSON sous `TALE_CONFIG_DIR/retention/`. Les variables d'environnement ci-dessous ne peuvent que resserrer ces bornes — jamais étendre ce que le fichier déclare. Le modèle complet à trois couches vit sur [Rétention](/fr/self-hosted/configuration/retention).

Une poignée de variables touche au plancher du journal d'audit et au flux de mise sous séquestre légal plutôt qu'aux bornes par catégorie :

| Nom                                      | Défaut     | Description                                                                                        |
| ---------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------- |
| `TALE_RETENTION_DISABLED`                | `false`    | À `true`, le nettoyage nocturne ne fait rien. Coupe-circuit opérateur pour les migrations.         |
| `TALE_AUDIT_PEPPER`                      | _(absent)_ | Secret d'au moins 16 caractères. Active le hachage HMAC-SHA256 du courriel et de l'IP en audit.    |
| `TALE_AUDIT_SIGNING_KEY`                 | _(absent)_ | Signe les lignes `auditLogCheckpoints` pour distinguer un nettoyage de rétention d'une altération. |
| `TALE_LEGAL_HOLD_RELEASE_COOLDOWN_HOURS` | `24`       | Heures entre l'approbation et la levée effective d'une mise sous séquestre légal.                  |
| `TALE_LEGAL_HOLD_SINGLE_ADMIN_OK`        | `false`    | À `true`, autorise les instances mono-Admin à approuver elles-mêmes la levée d'un séquestre légal. |

Les surcharges `_MIN` / `_MAX` par catégorie sont listées en intégralité sur [Rétention — Variables d'environnement](/fr/self-hosted/configuration/retention#environment-variables-tightening-overlay).

## Fournisseurs IA

Les clés API, URL de base et définitions de modèles des fournisseurs ne sont pas des variables d'environnement — elles vivent dans des fichiers JSON sous `TALE_CONFIG_DIR/providers/`. Le schéma sur disque, les modes de chiffrement SOPS et les règles de propagation des options propres au fournisseur vivent sur [Fournisseurs](/fr/self-hosted/configuration/providers).

## Où cela s'insère

La référence d'environnement est l'API de l'opérateur vers Tale. Tout ce dont le runtime a besoin qui n'est ni livré par le code ni posé via l'interface vit dans l'une des variables ci-dessus, et la plupart ont des valeurs par défaut raisonnables — les pages d'installation en production ne surchargent que le domaine, le TLS, les secrets et la base de données. Les contreparties UI des valeurs exposées dans l'application vivent sous **Paramètres > Gouvernance**, **Paramètres > Fournisseurs IA** et **Paramètres > Image de marque** ; lis [Gouvernance](/fr/platform/admin/governance), [Fournisseurs](/fr/self-hosted/configuration/providers) et [Image de marque](/fr/platform/admin/branding) quand tu as besoin de la référence par fonctionnalité.

Quand le runtime attend une variable qui n'est pas là, le log de démarrage le dit sur stderr. [Dépannage](/fr/self-hosted/operate/observability/troubleshooting) catalogue les modes de défaillance par mauvaise configuration d'environnement les plus courants ; la page [Format des notes de version](/fr/self-hosted/operate/release-notes/format) couvre la manière dont les dépréciations arrivent.
