---
title: Référence des variables d'environnement
description: Chaque variable d'environnement que Tale lit au boot, sa valeur par défaut et la surface produit qu'elle contrôle. La référence opérateur complète pour `.env`.
i18nLintExclude:
  - terminology-loanword
  - prose-exclamation
  - style-numbers
---

Tale lit sa configuration depuis un unique fichier `.env` à la racine du dépôt. Environ une douzaine de variables sont obligatoires au premier boot ; les autres ajustent le comportement. Cette page liste chaque variable que [`.env.example`](https://github.com/tale-project/tale/blob/main/.env.example) ship, sa valeur par défaut et la surface produit qui la consomme.

Les groupes sont ordonnés selon le moment où tu en as besoin la première fois : identité de domaine, TLS, secrets, base de données, instance, observabilité, chiffrement des fournisseurs. Si une variable change de valeur, redémarre le conteneur plateforme (`docker compose restart tale-platform tale-convex`) pour qu'elle prenne effet.

## Comment lire cette page

Chaque groupe est un tableau `Nom | Défaut | Description`. Les variables marquées **Obligatoire** doivent être définies pour que `docker compose up` réussisse. Les variables marquées **Optionnel** peuvent rester non définies ; la description nomme ce que désactiver la fonctionnalité signifie.

Le fichier `.env.example` ship des commentaires inline qui expliquent chaque variable dans son contexte ; cette page est la référence structurée et groupée pour le même ensemble.

## Identité de domaine (obligatoire au premier boot)

| Nom         | Défaut               | Description                                                                                                                               |
| ----------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `HOST`      | `tale.local`         | **Obligatoire.** Nom d'hôte sans protocole. Utilisé pour le réseau Docker et le mail sortant.                                             |
| `SITE_URL`  | `https://tale.local` | **Obligatoire.** URL canonique complète incluant le schéma et tout port non standard. Les callbacks d'auth l'utilisent.                   |
| `BASE_PATH` | non défini           | **Optionnel.** Préfixe de chemin pour les déploiements en sous-chemin derrière un reverse proxy (ex. `/app`). Laisse vide pour la racine. |

Le `SITE_URL` doit correspondre exactement à ce que l'utilisateur tape dans le navigateur. Un slash en queue, un port manquant ou `http` au lieu de `https` cassent le callback d'auth et produisent des boucles de sign-in.

## TLS

| Nom         | Défaut       | Description                                                                                                           |
| ----------- | ------------ | --------------------------------------------------------------------------------------------------------------------- |
| `TLS_MODE`  | `selfsigned` | Un de `selfsigned`, `letsencrypt`, `external`. Voir [TLS et domaines](/fr/self-hosted/configuration/tls-and-domains). |
| `TLS_EMAIL` | non défini   | E-mail de contact pour les notifications Let's Encrypt. Optionnel mais recommandé en production.                      |

`selfsigned` fait tourner Caddy avec un certificat généré — le navigateur avertit, OK pour le développement. `letsencrypt` exige un vrai domaine et les ports 80/443 joignables depuis l'Internet public. `external` fait servir Caddy en HTTP brut ; un reverse proxy amont termine TLS.

## Secrets de sécurité (obligatoire)

| Nom                     | Défaut                           | Description                                                                                                                                                                                                                                                                                   |
| ----------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BETTER_AUTH_SECRET`    | valeur d'exemple dans le fichier | **Obligatoire.** Secret base64 pour le signeur de session Better Auth. Génère avec `openssl rand -base64 32`. La rotation invalide chaque session.                                                                                                                                            |
| `ENCRYPTION_SECRET_HEX` | valeur d'exemple dans le fichier | **Obligatoire.** Clé hex de 32 octets. Clé AES-256 pour les credentials OAuth et intégrations et entrée HKDF pour la secret-box des garde-fous. Génère avec `openssl rand -hex 32`. La rotation invalide chaque ciphertext en base ; les opérateurs doivent réinscrire les secrets concernés. |
| `INSTANCE_SECRET`       | valeur d'exemple dans le fichier | **Obligatoire.** Sert à dériver la clé admin Convex pour `tale deploy`. Le déploiement échoue si non défini.                                                                                                                                                                                  |

Remplace les valeurs livrées dans `.env.example` avant d'exposer l'instance — ce sont des espaces réservés volontairement non sûrs.

## Base de données

| Nom            | Défaut                         | Description                                                                                                                                             |
| -------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DB_PASSWORD`  | `tale_password_change_me`      | **Obligatoire.** Mot de passe pour l'utilisateur Postgres auto-hébergé. Change-le avant la production. Utilisé par chaque service compose.              |
| `POSTGRES_URL` | construit depuis `DB_PASSWORD` | **Optionnel.** Override de l'URL de connexion construite automatiquement. Utilise-le pour pointer sur un Postgres externe ou un hôte/port non standard. |

La forme auto-construite est `postgresql://tale:${DB_PASSWORD}@db:5432`. Convex attend l'URL sans nom de base ; le nom est dérivé de la configuration d'instance.

## Observabilité

| Nom                         | Défaut     | Description                                                                                                                                  |
| --------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `SENTRY_DSN`                | non défini | DSN Sentry pour le suivi d'erreurs. Laisse vide pour désactiver. Compatible avec GlitchTip et Bugsink auto-hébergés.                         |
| `SENTRY_TRACES_SAMPLE_RATE` | non défini | Taux d'échantillonnage optionnel pour les traces de performance (`0.0`–`1.0`). Le comportement par défaut dépend du déploiement.             |
| `METRICS_BEARER_TOKEN`      | non défini | Token bearer requis pour accéder aux endpoints Prometheus `/metrics/*`. Laisse vide pour rendre les endpoints inatteignables de l'extérieur. |

Définir `METRICS_BEARER_TOKEN` expose quatre endpoints derrière le token : `/metrics/crawler`, `/metrics/rag`, `/metrics/platform` et `/metrics/convex` (les 261 métriques intégrées de Convex). Voir [Configuration d'observabilité](/fr/self-hosted/configuration/observability-config) pour la configuration de scrape.

## Chiffrement des secrets de fournisseur

| Nom                                  | Défaut     | Description                                                                                                                                                                                                                                                                                |
| ------------------------------------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `SOPS_AGE_KEY`                       | non défini | Clé secrète age inline. Chiffre `providers/*.secrets.json`. Mode par défaut après `tale init`. Plusieurs clés ne sont pas supportées en inline.                                                                                                                                            |
| `SOPS_AGE_KEY_FILE`                  | non défini | Chemin vers un fichier avec une ou plusieurs clés age (une par ligne ; commentaires `#` autorisés). Obligatoire pour la rotation. S'exclut mutuellement avec la forme inline.                                                                                                              |
| `TALE_PROVIDER_SECRET_ENV_ALLOWLIST` | non défini | Allowlist (séparée par des virgules) des noms de variables d'env que le `secretsEnv` d'un fournisseur peut lire. Vide ou non définie désactive la source de clé par variable d'environnement. Les noms doivent faire 40 caractères ou moins. Ne liste jamais un secret de déploiement ici. |

Si les deux clés age ne sont pas définies, Tale stocke `providers/*.secrets.json` en JSON clair en mode 0600. Atteins ce mode seulement si le disque hôte est chiffré au repos ou si les fichiers sont produits par un outillage externe (un montage de secret Kubernetes, un template Vault). Faire tourner une clé age, c'est ajouter la nouvelle clé, réenregistrer chaque fournisseur dans l'UI, puis retirer l'ancienne. Voir [Secrets avec SOPS](/fr/self-hosted/configuration/secrets-with-sops) pour la marche complète de rotation.

`TALE_PROVIDER_SECRET_ENV_ALLOWLIST` débloque la source de clé par variable d'environnement : un fournisseur peut lire sa clé depuis une variable d'environnement nommée plutôt que depuis un fichier de secrets, mais seulement quand ce nom de variable apparaît dans cette allowlist. Le mécanisme — ordre de résolution, le plafond de 40 caractères, l'exigence de redémarrage — est documenté dans [Fournisseurs](/fr/self-hosted/configuration/providers#environment-variable-key-source).

## Drapeaux de fonctionnalité

Bascules optionnelles pour des fonctionnalités non activées par défaut. Chaque drapeau active ou désactive une fonctionnalité au boot ; basculer demande un redémarrage du conteneur plateforme.

| Nom                             | Défaut  | Description                                                                                                                                                           |
| ------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MICROSOFT_AUTH_ENABLED`        | `false` | Active l'option de sign-in Microsoft Entra.                                                                                                                           |
| `TRUSTED_HEADERS_ENABLED`       | `false` | Active le mode auth par trusted headers (identité fournie par le reverse proxy).                                                                                      |
| `FILE_EVENTS_ENABLED`           | `false` | Active les événements de surveillance de fichiers pour l'intégration OneDrive-sync.                                                                                   |
| `TALE_DEPLOYMENT_CONFIG_ADMINS` | unset   | Allowlist de courriels (séparés par des virgules) des opérateurs autorisés à modifier la résidence des données. Vide/non défini = lecture seule pour tous les admins. |

## Sessions

| Nom                            | Défaut     | Description                                                                                                                                                                                                           |
| ------------------------------ | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SESSION_IDLE_TIMEOUT_MINUTES` | non défini | **Optionnel.** Déconnecte une session après ce nombre de minutes d'inactivité (`1`–`1440`). La fenêtre glisse à chaque activité et est appliquée côté serveur — sessions e-mail/mot de passe, SSO et trusted headers. |

Laisse-le non défini pour conserver la durée de session par défaut. Si défini, une session inactive expire côté serveur une fois la fenêtre écoulée, tandis qu'une session active continue de glisser à chaque requête.

## Versionnage

| Nom            | Défaut          | Description                                                                                                    |
| -------------- | --------------- | -------------------------------------------------------------------------------------------------------------- |
| `TALE_VERSION` | dernière stable | Le tag d'image que `docker compose pull` récupère. Fige sur un tag spécifique pour des montées reproductibles. |

## Où cela s'inscrit

Les variables ici sont la surface de contact de l'opérateur ; la surface UI qui en consomme la plupart vit sous [Plateforme administration](/fr/platform/admin/overview). Les clés de fournisseur sont la moitié-et-moitié : les clés elles-mêmes vivent dans `providers/*.secrets.json`, mais l'UI sous **Paramètres > Fournisseurs** est ainsi que tu les ajoutes et les fais tourner en pratique. La lecture suivante à mettre en file est [Fournisseurs](/fr/self-hosted/configuration/providers) — elle couvre la forme fichier, les modes SOPS et le comportement de résolution et de failover.
