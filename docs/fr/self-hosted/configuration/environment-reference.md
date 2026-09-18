---
title: Référence des variables d'environnement
description: Variables de déploiement, valeurs par défaut, secrets et services concernés par chaque réglage.
i18nLintExclude:
  - terminology-loanword
  - prose-exclamation
  - style-numbers
---

Cette référence indique les variables de déploiement, leurs valeurs par défaut et les processus concernés. Le fichier `.env` du projet est une source possible ; l’environnement des conteneurs et un gestionnaire de secrets peuvent aussi fournir les valeurs. Le [fichier d’exemple](https://github.com/tale-project/tale/blob/main/.env.example) contient la configuration correspondante.

Après une modification, recrée les services concernés avec ta procédure de déploiement. `docker compose restart` conserve l’environnement existant. Les fichiers de configuration d’organisation ont un cycle distinct.

## Comment lire cette page

Les tableaux indiquent le nom, la valeur par défaut et le rôle de chaque variable. Les valeurs requises doivent atteindre le service concerné ; certaines sont générées par le déploiement. Les variables facultatives peuvent rester absentes. Une valeur par défaut peut venir de Compose plutôt que du processus lui-même.

Consulte aussi les commentaires du fichier d’exemple et vérifie l’environnement effectif du service lorsqu’une valeur manque.

## Identité de domaine (obligatoire au premier boot)

| Nom         | Défaut              | Description                                                                                                                               |
| ----------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `HOST`      | `localhost`         | **Obligatoire.** Nom d'hôte sans protocole. Utilisé pour le réseau Docker et le mail sortant.                                             |
| `SITE_URL`  | `https://localhost` | **Obligatoire.** URL canonique complète incluant le schéma et tout port non standard. Les callbacks d'auth l'utilisent.                   |
| `ADDITIONAL_SITE_URLS` | non défini | **Optionnel.** Autres origines sur lesquelles le même déploiement répond, séparées par des virgules ou des espaces (ex. `https://a.example,https://b.example`). Chacune est une entrée complète. Voir [TLS et domaines](/fr/self-hosted/configuration/tls-and-domains#plusieurs-domaines-a-la-fois). |
| `BASE_PATH` | non défini          | **Optionnel.** Préfixe de chemin pour les déploiements en sous-chemin derrière un reverse proxy (ex. `/app`). Laisse vide pour la racine. |
| `DOCS_URL` | `https://docs.<HOST>` | Origine publique de l’hôte de documentation distinct dans le proxy. Le service docs doit aussi faire partie du déploiement. |

`SITE_URL` désigne l’origine publique canonique. Protocole, hôte et port doivent correspondre à l’adresse du navigateur et aux callbacks enregistrés. `BASE_PATH` ajoute le préfixe de chemin ; le proxy normalise une barre oblique finale. Les adresses supplémentaires sont des origines sans chemin dans `ADDITIONAL_SITE_URLS`. Une origine supplémentaire invalide empêche le backend de démarrer.

La documentation utilise sa propre origine. Sur l’origine de la plateforme, `/docs` ouvre la référence API interactive et `/openapi.json` fournit son schéma. `DOCS_URL` change l’hôte de documentation du proxy ; cette variable n’installe pas le service docs et ne réécrit pas les liens des clients déjà compilés. `TALE_DOCS_URL` dans les outils de compilation SEO et le préfixe `DOCS_BASE_URL` du service docs, utilisé à la compilation comme à l’exécution, sont des réglages distincts.

## TLS

| Nom         | Défaut       | Description                                                                                                           |
| ----------- | ------------ | --------------------------------------------------------------------------------------------------------------------- |
| `TLS_MODE`  | `selfsigned` | Un de `selfsigned`, `letsencrypt`, `external`. Voir [TLS et domaines](/fr/self-hosted/configuration/tls-and-domains). |
| `TLS_EMAIL` | non défini   | E-mail de contact pour les notifications Let's Encrypt. Optionnel mais recommandé en production.                      |
| `TRUSTED_PROXIES` | `private_ranges` | Avec `TLS_MODE=external`, les adresses dont le proxy accepte les en-têtes transférés : plages CIDR séparées par des espaces, ou `private_ranges`. Les autres modes l’ignorent. Voir [TLS et domaines](/fr/self-hosted/configuration/tls-and-domains). |

`selfsigned` crée un certificat Caddy local. Fais confiance à sa CA uniquement pour ta propre installation contrôlée. `letsencrypt` exige un domaine public et les ports 80/443 accessibles. Avec `external`, Caddy sert HTTP derrière un proxy TLS.

## Secrets de sécurité (obligatoire)

| Nom                     | Défaut                           | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `BETTER_AUTH_SECRET` | valeur d'exemple dans le fichier | Secret d’authentification commun aux réplicas backend. Génère une valeur aléatoire robuste, par exemple avec `openssl rand -base64 32`, et garde-la stable. Un changement peut invalider les sessions et les connexions en cours. |
| `ENCRYPTION_SECRET_HEX` | valeur d'exemple dans le fichier | Racine de chiffrement de 32 octets en hexadécimal ; génère-la avec `openssl rand -hex 32`. Conserve la valeur correspondant aux secrets existants. La remplacer ne migre pas les données chiffrées : rétablis la bonne clé ou saisis les secrets concernés par leur parcours prévu. |
| `INSTANCE_SECRET`       | valeur d'exemple dans le fichier | **Obligatoire.** Le secret racine de l’instance : 64 caractères hex, généré par `tale init` (à la main : `openssl rand -hex 32`). Au démarrage, Tale en dérive la clé HMAC des mots de passe d’app WebDAV (`WEBDAV_APP_PASSWORD_HMAC_KEY`) sauf si tu définis cette clé toi-même, et les jetons éphémères avec lesquels les sessions sandbox récupèrent des blobs sont signés par une sous-clé de la même dérivation. Garde-le stable entre les déploiements : une rotation re-dérive la clé et invalide chaque mot de passe d’app WebDAV. |
| `SANDBOX_TOKEN`         | valeur d'exemple dans le fichier | **Obligatoire.** Secret HMAC partagé entre le backend et le spawner sandbox : le backend signe chaque appel au spawner avec, et le spawner rejette les appels non signés. Sans lui, le spawner refuse de démarrer — il tient le socket docker de l’hôte, il n’a donc pas de mode non signé. `tale init` et `bun run dev` le génèrent ; une stack que tu composes toi-même le pose avant le premier boot (`openssl rand -hex 32`). Une rotation veut dire redémarrer le backend et le spawner ensemble — ils doivent s’accorder. |
| `SANDBOX_LLM_GATEWAY_ADMIN_PASSWORD` | non défini | **Requis pour les appels de harness sandbox.** Le backend utilise cet identifiant d’administration pour créer les clés de session. Il configure l’accès à la première utilisation ; le gateway conserve une empreinte du mot de passe dans `llm-gateway-data`. Garde le secret correspondant ou utilise la procédure de récupération/rotation prise en charge par le gateway. Ne supprime pas son état comme réparation habituelle. Le nom par défaut est `admin` (`SANDBOX_LLM_GATEWAY_ADMIN_USERNAME`). |

Remplace les valeurs livrées dans `.env.example` avant d'exposer l'instance — ce sont des espaces réservés volontairement non sûrs.

## Base de données

Tale utilise `tale_app` pour les données applicatives et `tale_knowledge` pour les fragments, embeddings et pages web. Le déploiement standard conserve les deux dans le service Postgres `db`, avec l’alias `knowledge-db`. Tu peux configurer des connexions externes séparément.

| Nom                                       | Défaut                                                              | Description                                                                                                                                                                                                                                                                                                                                                |
| ----------------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DB_PASSWORD` | `tale_password_change_me` | **Requis pour Postgres fourni.** Mot de passe commun aux bases applicative et documentaire dans le déploiement standard. Remplace l’exemple avant la production. |
| `DATABASE_URL`                            | construit depuis `DB_PASSWORD`                                      | **Optionnel.** URL de connexion de la base opérationnelle. Pose-la pour diriger le backend vers un Postgres que tu exploites toi-même : il n’a besoin d’aucune extension ni d’un superutilisateur, seulement d’une base et d’un rôle qui peut créer des schémas. Relue à chaque démarrage. |
| `DATABASE_POOL_MAX`                       | `10`                                                                | **Optionnel.** Connexions qu’un processus backend ouvre vers la base opérationnelle. Chaque réplique de `backend-api` et `backend-worker` en coûte le double — le pool applicatif et celui de la file de jobs. C’est ce nombre que tu compares au `max_connections` d’un Postgres managé. |
| `POSTGRES_CA_FILE`                        | non défini                                                          | **Optionnel.** Chemin d’un bundle PEM auquel **toutes** les connexions Postgres font confiance : la base opérationnelle, le corpus de connaissances et les bases que les organisations apportent elles-mêmes. Nécessaire dès qu’une URL demande `sslmode=verify-ca` ou `verify-full` face à un fournisseur dont la racine n’est pas livrée avec Node — Amazon RDS est le cas courant. Si tes bases utilisent des fournisseurs différents, concatène leurs racines dans un seul fichier. |
| `KNOWLEDGE_DATABASE_URL` | `postgresql://tale:${DB_PASSWORD}@knowledge-db:5432/tale_knowledge` | URL de connexion du corpus documentaire par défaut. La modifier sélectionne une autre base, sans migrer les fragments ni les vecteurs existants. |
| `KNOWLEDGE_DB_POOL_MAX` | `10` | **Optionnel.** Connexions qu’un processus backend ouvre vers le corpus documentaire. Chaque job d’indexation en occupe une pendant qu’il écrit une tranche de fragments ; si `WORKER_CONCURRENCY` autorise plus de jobs simultanés que cela, ils attendent le pool : augmente les deux ensemble. Comme `DATABASE_POOL_MAX`, cette valeur compte par réplique dans le `max_connections` de la base du corpus. |
| `KNOWLEDGE_DB_NAME` | `tale_knowledge` | Nom de la base documentaire créée par l’initialisation du service de base fourni. |
| `KNOWLEDGE_INDEX_REPAIR_INLINE_MAX_BYTES` | `1073741824`                                                        | **Optionnel.** Taille maximale (en octets) d'un index de recherche BM25 que le backend reconstruit de façon synchrone au démarrage quand il le trouve corrompu ; au-delà, un job d'arrière-plan le reconstruit pendant que les écritures vers ce corpus sont refusées. Voir [Architecture des conteneurs](/fr/self-hosted/operate/container-architecture). |
| `KNOWLEDGE_INDEX_REPAIR_DISABLED` | non défini | `1` ou `true` désactive la vérification et la réparation BM25 au démarrage. Cela ne corrige aucune corruption ; les échecs de lecture ou d’écriture nécessitent une enquête et une réparation contrôlée. |

L’URL générée est `postgresql://tale:${DB_PASSWORD}@db:5432/tale_app` ; `APP_DB_NAME` change le nom de base. Le corpus utilise les schémas `private_knowledge` et `public_web`. Une organisation peut choisir ses propres connexions sous **Paramètres > Résidence des données**. Enregistrer une autre URL ne migre aucune donnée. Consulte [Résidence des données](/fr/self-hosted/configuration/data-residency).

Deux points à connaître avant de diriger l’une des deux bases vers ta propre infrastructure :

- **Le corpus de connaissances exige `pgvector` déjà installé.** Tale crée lui-même ses schémas et ses tables sur une base vide, mais n’installe jamais d’extension — la table des chunks porte une colonne `vector`, donc `CREATE EXTENSION vector;` doit avoir été lancé sur la base cible. Le `pg_search` de ParadeDB reste optionnel : sans lui la recherche retombe sur le vectoriel seul au lieu d’échouer. La base opérationnelle, elle, n’a besoin d’aucune extension.
- **Utilise une connexion Postgres directe ou compatible avec les sessions.** Notifications de tâches, verrous de migration et requêtes préparées dépendent de ces propriétés. Vérifie tout proxy de connexion géré selon ces exigences.

## Store d'objets

Les fichiers et médias utilisent un stockage compatible S3. Ces variables règlent la connexion par défaut. Une connexion propre à l’organisation est prioritaire ; une panne du stockage par défaut ne signifie pas que les buckets de toutes les organisations sont inaccessibles.

| Nom                              | Défaut                       | Description                                                                                                                                                                           |
| -------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OBJECT_STORE_ACCESS_KEY` | non défini | Clé d’accès de la connexion S3 par défaut. Pour MinIO fourni, configure la même valeur dans `MINIO_ROOT_USER`. Sans identifiants, aucune connexion par défaut n’est créée ; une organisation peut néanmoins avoir sa propre connexion valide. |
| `OBJECT_STORE_SECRET_KEY` | auto-généré par `tale init` | Clé secrète du stockage par défaut. Pour MinIO fourni, elle doit correspondre à `MINIO_ROOT_PASSWORD`. Coordonne la rotation du stockage et du backend, puis teste lecture et écriture. Changer le mot de passe ne déplace pas les fichiers et ne les rend pas intrinsèquement orphelins. |
| `OBJECT_STORE_BUCKET`            | `tale-blobs`                 | Bucket où vivent les blobs. Le backend le crée s’il est absent et que la clé y est autorisée ; s’il existe déjà, il l’utilise tel quel. |
| `OBJECT_STORE_ENDPOINT` | `http://object-store:9000` dans le compose livré | Endpoint du stockage vu par le backend. AWS S3 n’utilise pas d’endpoint personnalisé ; retire ou vide explicitement celui du stockage fourni dans l’environnement Compose effectif. MinIO, R2 ou un autre service compatible utilisent une URL dédiée. |
| `OBJECT_STORE_REGION`            | `us-east-1`                  | Région de signature. Signifiante sur AWS ; arbitraire mais exigée par le signataire pour un store auto-hébergé. |
| `OBJECT_STORE_FORCE_PATH_STYLE`  | `true` avec endpoint, `false` sans | Adresse le bucket en `endpoint/bucket/key` plutôt qu’en `bucket.endpoint/key`. Le défaut suit l’endpoint et convient donc aux deux cas ; ne le pose que pour un store qui déroge à sa propre forme. |
| `OBJECT_STORE_PREFIX`            | non défini                   | Préfixe de clés dans le bucket, pour que les blobs de Tale partagent un bucket avec d’autres données. Vide signifie la racine du bucket. |
| `OBJECT_STORE_PUBLIC_ENDPOINT`   | `${SITE_URL}` (posé par la CLI) | Où le **navigateur** atteint le store. Le proxy publie le store embarqué sous `/<bucket>/*` et transfère les URLs présignées telles quelles, donc téléversements et téléchargements se font directement navigateur↔store. Si ce point d’accès est l’une des origines du déploiement, un lien destiné à un navigateur sur une autre origine configurée est signé pour cette origine. Laisse-le vide pour un bucket que le navigateur atteint déjà. |

Le proxy fourni expose la route des objets au navigateur sans publier le port d’administration du stockage. Un stockage externe peut utiliser son propre endpoint public.

### Comment ces variables arrivent dans le déploiement en cours

Au démarrage, le backend rapproche `default/object-storage/connection.json` de son environnement. Recrée `backend-api` et `backend-worker` avec les nouvelles valeurs. Les messages de démarrage distinguent les résultats suivants :

| Ligne | Signification |
| --- | --- |
| `object store (seeded)` | il n’y avait aucune connexion ; une a été écrite depuis l’environnement |
| `object store (reconciled)` | l’environnement a changé ; la connexion a été mise à jour |
| `object store (adopted)` | une connexion écrite par une version antérieure a été reconnue et est désormais suivie |
| `object store (ignored)` | la connexion porte `"managedBy": "operator"`, ces variables ne font donc rien |
| `object store (skipped)` | Aucune paire d’identifiants fournie pour créer la connexion par défaut. Vérifie si une connexion existante ou propre à l’organisation reste utilisable. |
| *(rien)* | déjà aligné — l’état normal |

Si tu préfères gérer le store à la main, mets `"managedBy": "operator"` dans `connection.json` : le backend ne touchera plus jamais ce fichier. Un fichier sans `managedBy` du tout — écrit avant ce comportement — n’est repris que s’il nomme encore le même bucket sur le même endpoint que l’environnement ; si tu l’avais repointé à la main, ta modification reste.

Droits sur le bucket : le backend vérifie l’existence du bucket avec `HeadBucket` et ne le crée que s’il est absent. Une clé qui peut lire, écrire et supprimer des objets sans pouvoir créer de bucket suffit donc, à condition que tu crées le bucket toi-même. Les téléversements et téléchargements présignés passent par le navigateur : un bucket externe a donc aussi besoin d’une politique CORS autorisant l’origine de ton déploiement en `GET`, `PUT` et `HEAD` — voir [Résidence des données](/fr/self-hosted/configuration/data-residency).

## Signature du journal d'audit

Le vérificateur PostgreSQL actuel contrôle les hachages SHA-256 et les liens entre les lignes d’audit, sans vérifier de points de contrôle signés par HMAC. La CLI génère et conserve encore les variables de signature pour compatibilité. Leur présence ne prouve pas que le backend actuel signe l’historique. Un pepper distinct pseudonymise les données personnelles enregistrées lors des connexions échouées.

| Nom                               | Défaut                      | Description                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --------------------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TALE_AUDIT_SIGNING_KEY` | auto-généré par `tale init` | Valeur hexadécimale de 64 caractères générée et conservée par la CLI pour compatibilité. Conserve les valeurs existantes avec les secrets du déploiement ; le vérificateur PostgreSQL actuel n’utilise pas cette clé. |
| `TALE_AUDIT_SIGNING_KEY_PREVIOUS` | non défini | Variable de compatibilité pour une ancienne clé de signature. Le vérificateur PostgreSQL actuel ne l’utilise pas ; la définir n’active pas de vérification de signature. |
| `TALE_AUDIT_PEPPER` | auto-généré par `tale init` | Au moins 16 caractères pour pseudonymiser les échecs de connexion : HMAC-SHA256 de l’e-mail et de l’adresse IP tronquée. Sans valeur, ces champs d’audit restent en clair et le backend avertit. La rotation empêche de corréler les nouveaux identifiants avec les anciens ; la conservation suit la politique appliquée de l’organisation. |

Voir [Intégrité du journal d'audit](/fr/self-hosted/operate/security/audit-log-integrity) pour le modèle de vérification.

## Observabilité

| Nom                         | Défaut     | Description                                                                                                                                                            |
| --------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SENTRY_DSN`                | non défini | DSN Sentry pour le suivi d'erreurs. Laisse vide pour désactiver. Compatible avec GlitchTip et Bugsink auto-hébergés.                                                   |
| `SENTRY_TRACES_SAMPLE_RATE` | non défini | Taux d'échantillonnage optionnel pour les traces de performance du navigateur (`0.0`–`1.0`). Navigateur uniquement — le backend remonte des erreurs, jamais de traces. |
| `METRICS_BEARER_TOKEN` | non défini | Jeton Bearer pour les routes `/metrics/*` du proxy. Sans jeton configuré, elles répondent 401. Restreins séparément l’accès réseau aux endpoints internes des processus. |
| `UMAMI_URL` | non défini | Origine HTTPS de la passerelle de collecte authentifiée. HTTP est accepté uniquement pour les tests locaux sur `localhost`, `127.0.0.1` ou `[::1]`. Exige un identifiant de site et un jeton valides ; aucun chemin, paramètre de recherche ni identifiant de connexion dans l’URL. |
| `UMAMI_WEBSITE_ID` | non défini | UUID du site Umami. Une valeur absente ou invalide désactive la collecte. Utilise un identifiant distinct par déploiement. |
| `UMAMI_PROXY_TOKEN` | non défini | Jeton Bearer de la passerelle, réservé au serveur : 16 à 256 lettres ASCII, chiffres ou caractères de `._~-`. Ne l’injecte jamais dans la configuration du navigateur. |

Définir `METRICS_BEARER_TOKEN` expose les endpoints de métriques derrière le token : `/metrics/platform`, `/metrics/backend` (les métriques du backend applicatif) et `/metrics/sla-rules`. Voir [Configuration d'observabilité](/fr/self-hosted/configuration/observability-config) pour la configuration de scrape.

## Chiffrement des secrets de fournisseur

SOPS protège les fichiers de secrets de configuration compatibles. Les identifiants actuels des fournisseurs en base utilisent `ENCRYPTION_SECRET_HEX`, décrit avec les secrets de sécurité plus haut.

| Nom | Défaut | Description |
| --- | --- | --- |
| `SOPS_AGE_KEY` | non défini | Une clé privée age directe. Prime sur le fichier de clés. |
| `SOPS_AGE_KEY_FILE` | non défini | Chemin accessible au processus, avec une ou plusieurs clés privées age, une par ligne. Monte le fichier dans chaque conteneur concerné. |

Sans clé age, le module SOPS écrit les fichiers compatibles en clair avec les permissions `0600`. Les fichiers déjà chiffrés exigent toujours leur clé. Lis [Secrets avec SOPS](/fr/self-hosted/configuration/secrets-with-sops) avant de modifier ces variables.

Les identifiants de fournisseurs peuvent référencer une variable préfixée par `TALE_PROVIDER_KEY_` (40 caractères maximum). Les courtiers d’abonnement utilisent le préfixe distinct `TALE_TOKEN_SOURCE_` (60 maximum). Ces champs contiennent des noms de variables, pas les secrets. Injecte les valeurs dans les processus backend et recrée les conteneurs concernés après modification. [Fournisseurs](/fr/self-hosted/configuration/providers) décrit ce fonctionnement.

## Applications OAuth des connecteurs

Les connecteurs OAuth (Gmail, Google Drive, Outlook, Teams, Slack, …) résolvent leur application fournisseur d’abord par organisation : une app configurée sous **Paramètres > Connectors > Apps OAuth** gagne pour cette organisation. L’environnement fournit la valeur par défaut du déploiement en dessous (et reste la seule source pour Slack, dont la vérification de signature des événements s’exécute avant qu’aucune organisation ne soit connue). Pour chaque slug de connecteur :

| Nom                                    | Défaut | Description                                                                                                               |
| -------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------- |
| `CONNECTOR_OAUTH_<SLUG>_CLIENT_ID`     | unset  | Identifiant client OAuth pour ce connecteur. Slug en majuscules, tirets remplacés par des tirets bas (`gmail` → `GMAIL`). |
| `CONNECTOR_OAUTH_<SLUG>_CLIENT_SECRET` | unset  | Secret client correspondant.                                                                                              |
| `CONNECTOR_SLACK_SIGNING_SECRET`       | unset  | Le secret de signature de l’app Slack. L’endpoint d’événements entrants vérifie chaque livraison avec lui et renvoie 503 tant qu’il manque. |

Enregistre `${SITE_URL}${BASE_PATH}/api/connectors/oauth2/callback` sur l’application fournisseur, et pour Slack aussi `${SITE_URL}${BASE_PATH}/api/connectors/slack/events` comme Events Request URL. Détails : [Connectors (développement)](/fr/develop/connectors).

## Import cloud Knowledge (Documents)

Les autorisations OneDrive / Google Drive par utilisateur pour **Connaissances → Documents** sont distinctes des connectors d’organisation et de la connexion. Ici aussi, une app d’organisation configurée sous **Paramètres > Connectors > Apps OAuth** prime — l’entrée **google-drive** est partagée avec la voie connector, et **OneDrive / SharePoint (import de connaissances)** a sa propre entrée ; les chaînes ci-dessous s’appliquent partout où l’organisation n’en a pas configuré. Enregistre cette URI de redirection sur l’app Microsoft (ou Google) :

`${SITE_URL}${BASE_PATH}/api/cloud-import/oauth2/callback`

Résolution des identifiants pour OneDrive (premier match gagne) :

| Nom                                            | Description                                   |
| ---------------------------------------------- | --------------------------------------------- |
| `CLOUD_IMPORT_MICROSOFT_CLIENT_ID` / `_SECRET` | App dédiée à l’import Knowledge (préférée).   |
| `CLOUD_IMPORT_MICROSOFT_TENANT_ID`             | ID d’annuaire (tenant) de cette app.          |
| `AUTH_MICROSOFT_ENTRA_ID_ID` / `_SECRET`       | App de connexion Microsoft.                   |
| `AUTH_MICROSOFT_ENTRA_ID_TENANT_ID`            | ID d’annuaire (tenant) de l’app de connexion. |

Les inscriptions d’app Entra mono-tenant exigent une URL d’autorisation propre au tenant — `/common` échoue avec AADSTS50194. Définis l’ID de tenant (ou `organizations` / `common` pour une app multi-tenant). S’il est absent, Tale reprend le tenant de l’issuer SSO Entra de l’organisation s’il est configuré.

L’écran de consentement Microsoft demande Graph **Files.Read** et **Sites.Read.All** (liste/téléchargement OneDrive et SharePoint), **User.Read** (libellé du compte) et **offline_access** (jeton de rafraîchissement pour la sync). Cette autorisation est intentionnelle et par utilisateur — elle n’est pas attachée à la connexion à Tale.

Google Drive utilise uniquement une app dédiée (pas de repli sur l’app de connexion) :

| Nom                                               | Description                          |
| ------------------------------------------------- | ------------------------------------ |
| `CLOUD_IMPORT_GOOGLE_DRIVE_CLIENT_ID` / `_SECRET` | App d’import Google Drive Knowledge. |

Enregistre la même URI de callback cloud-import sur le client OAuth Google. Le consentement demande **drive.readonly** et **userinfo.email**.

## Drapeaux de fonctionnalité

Ces variables règlent l’authentification backend, les événements de fichiers et les droits opérateur. Recrée les rôles backend concernés après un changement d’environnement. Modifier seulement le conteneur web ne suffit pas.

| Nom                               | Défaut                   | Description                                                                                                                                                                                                                                                |
| --------------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TRUSTED_SECRET_HEADER` | `Remote-Internal-Secret` | Nom de l'en-tête de requête qui porte la clé trusted headers de l'organisation sur la requête de passage. |
| `TRUSTED_EMAIL_HEADER`            | `Remote-Email`           | Nom de l'en-tête de requête qui porte l'e-mail de l'utilisateur — l'identité pour laquelle la session est émise.                                                                                                                                           |
| `TRUSTED_NAME_HEADER`             | `Remote-Name`            | Nom de l'en-tête de requête qui porte le nom affiché. S'il manque, Tale prend la partie locale de l'e-mail.                                                                                                                                                |
| `TRUSTED_ROLE_HEADER` | `Remote-Role` | Nom de l'en-tête de requête qui porte le rôle d'organisation avec lequel la session agit, plafonné au plafond de l'organisation (`member` si l'en-tête manque). |
| `TRUSTED_TEAMS_HEADER`            | `Remote-Teams`           | Nom de l'en-tête de requête qui porte les appartenances aux équipes, en noms d'équipe séparés par des virgules (les entrées `id:name` sont aussi acceptées). Absent, les équipes ne bougent pas ; présent, la liste du proxy fait foi pour les appartenances qu'il a accordées (vide les révoque). |
| `TALE_FILE_EVENTS`                | `false`                  | Diffuse les changements des fichiers de config sous `TALE_CONFIG_DIR` aux onglets ouverts (`/events/file`) : un fichier d’agent, de skill ou de branding modifié sur disque apparaît sans recharger. Actif dans le compose de dev, inactif en production.  |
| `TALE_DEPLOYMENT_CONFIG_ADMINS`   | non défini               | Allowlist de courriels (séparés par des virgules) des opérateurs autorisés à écrire le fichier de configuration du déploiement (`deployment.yml`, aujourd’hui la section du runtime de la sandbox) via l’API. Vide/non défini = lecture seule pour tous les admins. La résidence des données se configure par organisation et ne dépend pas de cette liste. |
| `TALE_ALLOW_PRIVATE_PROVIDER_HOSTS` | non défini | Avec `1` dans l’environnement du backend, autorise les destinations privées des fournisseurs de modèles, y compris leur configuration dans la passerelle sandbox. Les métadonnées cloud restent bloquées. Voir [Fournisseurs](/fr/self-hosted/configuration/providers). |
| `TALE_ALLOW_PRIVATE_CRAWL_HOSTS` | non défini | Avec `1`, autorise les cibles intranet et les hôtes privés dans l’`imageUrl` d’un produit. Les métadonnées cloud restent bloquées. |
| `TALE_ALLOW_OPEN_SIGN_UP` | non défini | La valeur exacte `true` laisse `POST /api/auth/sign-up/email` ouvert après le premier compte du déploiement. Réservé aux piles de test jetables — l’orchestrateur de développement local et la surcouche compose de développement le définissent eux-mêmes. Un déploiement réel le laisse non défini : chaque compte suivant est créé par une administratrice ou un administrateur. |
| `TALE_ORGANIZATION_CREATORS` | non défini | Liste d’adresses e-mail, séparées par des virgules, des comptes autorisés à créer une organisation, comparées sans tenir compte de la casse. Non définie, toute personne connectée peut en créer une. Définie, toute autre personne est refusée avec `403 ORGANIZATION_CREATION_FORBIDDEN` dès que le déploiement compte une organisation — la première est toujours autorisée — et l’application lui masque **Créer une organisation**. Une valeur définie mais vide ferme la création à tout le monde. Un déploiement géré l’écrit à partir de `organizations.creators` de sa spécification ; voir [Installer la CLI tale](/fr/self-hosted/install/cli-install#managed-organization-creators). |

L’autorisation des cibles privées concerne deux contrôles : l’enregistrement des sites et les requêtes du crawler, ainsi que la validation de l’`imageUrl` d’un produit. Sans elle, une cible de site privée renvoie `400 WEBSITE_DOMAIN_NOT_CRAWLABLE` ; une URL d’image privée renvoie `400 INVALID_BODY`. Pour un produit, seule la chaîne du nom d’hôte est contrôlée, sans télécharger l’image ni résoudre le DNS. L’enregistrement d’un site et le crawler vérifient aussi les adresses résolues. Active cette variable uniquement si le déploiement a besoin de ces destinations privées. Elle est distincte de l’autorisation des fournisseurs privés.

## Réglage du retrieval RAG

Ces variables facultatives `RAG_` règlent la recherche et le reclassement par cross-encoder. Les processus backend les lisent au démarrage. Après avoir modifié leur environnement de déploiement, recrée les conteneurs concernés ; `docker compose restart` conserve leur ancien environnement.

| Nom                          | Défaut                                 | Description                                                                                                                                                                                  |
| ---------------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RAG_RERANKING_ENABLED` | `false` | Active le reclassement des résultats BM25 et vectoriels fusionnés. Configure aussi le fournisseur API ci-dessous. Mesure la pertinence et la latence supplémentaire sur ton corpus. |
| `RAG_RERANKING_MODEL`        | `cross-encoder/ms-marco-MiniLM-L-6-v2` | Identifiant du modèle cross-encoder transmis au fournisseur de rerank.                                                                                                                       |
| `RAG_RERANKING_PROVIDER`     | `local`                                | Doit être réglé sur `api` pour activer le re-ranking — il poste les candidats à un endpoint `/rerank` externe (compatible Cohere/Jina). `local` n'est plus supporté et échoue tout de suite. |
| `RAG_RERANKING_TOP_K`        | `10`                                   | Nombre maximal de résultats que le reranker renvoie. La réponse ne dépasse jamais le `top_k` de la requête.                                                                                  |
| `RAG_RERANKING_CANDIDATES`   | `30`                                   | Taille du pool de candidats fourni au reranker. Un pool plus large améliore la qualité de re-notation et coûte proportionnellement plus de temps par requête.                                |
| `RAG_RERANKING_API_BASE_URL` | non défini                             | URL de base du fournisseur de rerank ; le backend appelle `{base_url}/rerank`. Obligatoire quand le re-ranking est activé.                                                                   |
| `RAG_RERANKING_API_KEY`      | non défini                             | Token Bearer envoyé à l'endpoint de rerank externe. Laisse-le non défini pour les endpoints sans authentification.                                                                           |

Le reclassement est désactivé par défaut. Pour l’activer, définis `RAG_RERANKING_ENABLED=true`, `RAG_RERANKING_PROVIDER=api` et une `RAG_RERANKING_API_BASE_URL` valide, avec les identifiants nécessaires. Le backend n’exécute aucun modèle local de reclassement. Compare les résultats et la latence avant de l’ouvrir aux utilisateurs.

## Topologie du déploiement

Ces valeurs façonnent les rôles applicatifs d’un déploiement de workspace : le nombre de réplicas, que `tale deploy` lit dans l’environnement du projet et ramène dans la plage autorisée avec un avertissement, et la quantité de travail qu’un réplica de worker prend en charge à la fois.

| Nom                            | Défaut  | Description                                                                                              |
| ------------------------------ | ------- | ---------------------------------------------------------------------------------------------------------- |
| `TALE_PLATFORM_REPLICAS`       | `1`     | Replicas de l'étage web qui sert la coquille de l'app. Plage `1`–`16`.                                     |
| `TALE_BACKEND_API_REPLICAS`    | `1`     | Replicas de l'API — chaque porte applicative, l'auth et le flux de hints. Plage `1`–`16`.                  |
| `TALE_BACKEND_WORKER_REPLICAS` | `1`     | Replicas du runner de jobs : ingestion, crawls, automations, tours d'agent. Plage `1`–`16`.                |
| `WORKER_CONCURRENCY`           | `5`     | Jobs qu’un réplica `backend-worker` exécute en même temps — ingestion, crawls, automations et tours d’agent se partagent ce nombre. Le processus worker le lit lui-même ; plage `1`–`64`. C’est le levier à actionner avant d’ajouter des réplicas de worker quand un retard s’accumule. Chaque job d’indexation en cours écrit via le pool du corpus, donc augmente `KNOWLEDGE_DB_POOL_MAX` en même temps. |
| `TALE_BACKEND_URL` | `http://backend-api:3005` | Où l'étage web atteint le backend applicatif : la page publique `/status` le sonde et le serveur web lui demande les réponses que seule une base de données peut donner. Le Compose livré et l'entrypoint du conteneur prennent l'alias in-compose par défaut ; définis la variable seulement si ton service backend porte un autre nom. Lue uniquement par le service `platform`. |

Un déploiement de workspace fait temporairement tourner les deux couleurs. Prévois cette capacité supplémentaire. Augmente le rôle qui limite le débit selon tes mesures ; davantage de réplicas consomment aussi plus de connexions et de mémoire. Consulte [Mises à jour](/fr/self-hosted/operate/upgrades).

## Sessions

| Nom                            | Défaut     | Description                                                                                                                                                                                                           |
| ------------------------------ | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SESSION_IDLE_TIMEOUT_MINUTES` | non défini | **Optionnel.** Déconnecte une session après ce nombre de minutes d'inactivité (`1`–`1440`). La fenêtre glisse à chaque activité et est appliquée côté serveur — sessions e-mail/mot de passe, SSO et trusted headers. |

Laisse-le non défini pour conserver la durée de session par défaut. Si défini, une session inactive expire côté serveur une fois la fenêtre écoulée, tandis qu'une session active continue de glisser à chaque requête. Les Administrateurs d'organisation peuvent raccourcir la fenêtre effective par organisation — jamais l'allonger au-delà de ce plafond — via la [politique de gouvernance du délai d'inactivité de session](/fr/platform/admin/governance/policies-and-limits) ; les sessions inactives sous cette politique sont révoquées par une passe qui tourne environ toutes les cinq minutes.

## Infrastructure sandbox {#sandbox-infrastructure}

Le spawner sandbox lit les paramètres ci-dessous. Transmets-les dans son environnement et recrée ce service après une modification. `SANDBOX_MAX_SESSIONS` fixe la capacité partagée par toutes les organisations. Le total des trois limites de travail d’une organisation se recalcule automatiquement ; tu ne peux pas enregistrer ces limites s’il dépasse cette capacité. Gère les limites dans [Sandboxes](/fr/platform/admin/sandboxes), où les environnements réellement actifs et les mesures de l’hôte apparaissent séparément des allocations.

| Nom | Défaut | Description |
| --- | --- | --- |
| `SANDBOX_MAX_SESSIONS` | `8` | Nombre maximal de sessions actives ou au démarrage de toutes les organisations sur l’hôte Docker ou dans le namespace Kubernetes, y compris les conteneurs inactifs conservés pour être réutilisés. Cette capacité ne réserve ni CPU ni mémoire. Des réplicas Kubernetes concurrents l’appliquent au mieux ; utilise ResourceQuota pour imposer des limites strictes aux ressources du namespace. |
| `SANDBOX_AGENT_CPUS` | `2` | Limite de CPU par session d’agent. Tiens compte des builds simultanés et des autres tâches de l’hôte pour choisir le nombre de sessions. |
| `SANDBOX_AGENT_MEMORY` | `4g` ; `8g` avec Docker dans la sandbox | Limite de mémoire par session d’agent, partagée avec son daemon Docker interne et les conteneurs qu’il lance. Une valeur explicite remplace ces deux valeurs par défaut et s’applique aux nouvelles sessions. |
| `SANDBOX_SESSION_MAX_IDLE_MS` | `1800000` (30 min) | Délai d’inactivité avant l’arrêt des sessions non épinglées. Les conteneurs auxiliaires du cache de build d’une organisation s’arrêtent aussi après ce délai sans session potentiellement active ; leurs réseaux et volumes de cache sont conservés. |
| `SANDBOX_RUNTIME_IMAGE`          | `tale-sandbox-runtime:latest` | **Optionnel, lu par le spawner.** L'image dont sort chaque conteneur de session. Le défaut est le tag que la stack de développement construit localement ; un hôte qui tire ses images pose donc le nom de la registry : `ghcr.io/tale-project/tale/tale-sandbox-runtime:<version>`, aligné sur le reste de la stack. `tale deploy` le pose pour toi. |
| `SANDBOX_DIND_INNER_POOL` | non défini (automatique) | Pool d’adresses optionnel du daemon Docker interne des sessions d’agent, sur Docker ou Kubernetes. Choisis un `/16` IPv4 privé RFC1918 sous forme canonique, hors de tes réseaux de Pods, de Services et de VPC. Le runtime refuse tout chevauchement avec les réseaux et adresses qu’elle détecte. |

À pleine capacité, le spawner peut arrêter une session inactive, libérée et non épinglée avant le délai d’inactivité pour accepter un nouveau travail. Le daemon doit confirmer qu’aucun travail n’est en cours ; les sessions occupées ou dont l’état est inconnu restent protégées. L’arrêt conserve le répertoire ou le volume persistant de l’espace de travail. Sans session à récupérer en toute sécurité, la capacité du déploiement continue de bloquer les nouveaux démarrages.

### Dimensionner la capacité des sessions

Commence à 8, puis teste les tâches que ton déploiement exécutera en même temps. Le rendu dans le navigateur et les builds Docker n’ont pas les mêmes pics de charge ; inclus les agents, les workflows et l’exploration de toutes les organisations. Une place libre ne garantit pas des ressources suffisantes. Le spawner n’ajuste pas automatiquement cette valeur à la mémoire de l’hôte.

Sous Docker, relève la consommation pendant que des tâches représentatives s’exécutent en parallèle. Répète cette commande pendant l’exécution ; une mesure au repos ne montre pas les pics des tâches :

```bash
docker stats --no-stream --format 'table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}'
```

Retire de la mémoire de l’hôte la part nécessaire au système, aux services de la plateforme, aux bases de données, aux conteneurs auxiliaires de build et à une marge de sécurité. Divise le reste par le pic mesuré par session active, puis arrondis à l’entier inférieur. Par exemple, un hôte de 32 GiB avec 8 GiB mis de côté et un pic mesuré de 3 GiB par session donne `(32 - 8) / 3 = 8` sessions. C’est un exemple de calcul, pas un benchmark. Pour des tâches différentes, additionne leurs pics simultanés et vérifie la saturation du CPU ainsi que la durée des tâches avant d’augmenter la limite.

Les 4 GiB ou 8 GiB d’un agent sont un plafond de mémoire ; cette mémoire n’est pas réservée au démarrage. Huit agents qui exécutent des builds Docker peuvent donc consommer bien plus que huit sessions surtout inactives. Mesure avec une charge représentative et garde une marge. Passe à 16 ou plus seulement si l’hôte tient cette charge dans la durée. Avant de réduire la capacité, abaisse les totaux d’organisation qui dépassent la nouvelle valeur. Les limites par défaut d’une organisation totalisent 6 ; une capacité inférieure demande aussi des limites d’organisation plus basses.

### Appliquer un changement de capacité

Ajoute ou modifie cette ligne dans le `.env` du déploiement, en conservant les autres entrées. Les valeurs explicites restent en vigueur après une mise à niveau ; la valeur par défaut de 8 s’applique quand la variable est absente.

```dotenv .env
SANDBOX_MAX_SESSIONS=8
```

Pour une stack Compose que tu gères toi-même, recrée uniquement le service sandbox avec son image locale existante :

```bash
docker compose up -d --no-deps --no-build --pull never sandbox
```

Utilise le même projet, les mêmes fichiers `-f` et les mêmes options de fichiers d’environnement que la stack active. Un redémarrage seul ne charge pas un `.env` modifié. Pour une installation gérée par la CLI, suis la procédure de déploiement dans [Mises à niveau](/fr/self-hosted/operate/upgrades). Sous Kubernetes, définis la variable dans le Deployment du spawner sandbox, puis déploie cette nouvelle configuration.

Vérifie la nouvelle capacité du déploiement dans [Sandboxes](/fr/platform/admin/sandboxes). Avec des limites d’organisation de 2/2/2 et une capacité de 8, le total affiche **6 / 8**. Les réglages existants des organisations sont conservés ; leur total doit toujours respecter la capacité actuelle pour être enregistré. Ce changement n’augmente pas les limites de CPU ou de mémoire des conteneurs.

### Après une mise à niveau

La capacité par défaut était de 16, et les organisations créées avant cette version ont reçu les limites 2/4/4, soit un total de 10. Un déploiement qui n’a jamais défini `SANDBOX_MAX_SESSIONS` démarre donc la nouvelle version avec une capacité de 8 et des organisations dont le total enregistré la dépasse. Le travail en cours n’est pas touché, et chaque organisation continue d’admettre du travail selon ses limites enregistrées ; seul l’enregistrement de la page Sandboxes reste bloqué tant que le total ne rentre pas, et abaisser une limite s’enregistre toujours. Définis `SANDBOX_MAX_SESSIONS=16` explicitement pour conserver la capacité précédente, ou demande à chaque organisation concernée d’abaisser une limite.

### Caches de build Docker

Les caches de build Docker sont isolés par organisation. Chaque organisation utilise un builder privilégié et trois miroirs de registre sans privilèges élevés. Dès qu’aucune session ne peut encore les utiliser, le délai d’inactivité commence ; les conteneurs auxiliaires s’arrêtent ensuite. Le prochain build les redémarre avec leurs volumes de cache conservés. Les réseaux et les volumes restent disponibles pour être réutilisés. Les sessions Kubernetes utilisent leur propre builder Docker interne ; la réconciliation Kubernetes n’appelle pas la CLI Docker pour ces conteneurs auxiliaires.

Le spawner remplit le premier pool d’adresses Docker disponible avec les réseaux d’organisation avant de passer au suivant. Par défaut, chaque réseau reçoit un `/23` de 512 adresses ; un `/16` entièrement libre peut donc accueillir 128 réseaux d’organisation. Les sous-réseaux plus petits configurés dans Docker gardent leur taille. Le spawner exclut les réseaux Docker existants, les routes et les adresses des serveurs DNS de l’hôte du daemon Docker, ainsi que `172.31.0.0/16` pour les anciennes images de runtime, puis vérifie le réseau créé.

Pour observer l’hôte du daemon même avec Docker à distance, le spawner lance brièvement l’image BuildKit configurée dans le namespace réseau de l’hôte. Ce conteneur utilise un système de fichiers en lecture seule, sans capacités Linux ni montages. Si cette observation échoue ou qu’aucun sous-réseau sûr ne reste disponible, les sessions construisent localement sans cache partagé. Le spawner recrée un réseau inutilisé qui lui appartient si son sous-réseau est invalide ; il conserve les réseaux utilisés ou appartenant à un autre propriétaire.

Une mise à niveau crée des caches d’organisation vides et conserve les anciennes données globales. Les anciens conteneurs auxiliaires s’arrêtent automatiquement dès qu’aucune session active n’en dépend. Laisse se terminer les anciennes sessions épinglées ou arrête-les pour achever la transition ; jusque-là, l’ancien service de cache partagé reste accessible. L’automatisation du navigateur utilise Chromium sans interface graphique. La vue en direct et la prise de contrôle manuelle ont été retirées.

### Réseaux Docker internes

Sur Docker et Kubernetes, le choix automatique vérifie les routes IPv4 et leurs passerelles dans toutes les tables de routage, les adresses et préfixes des interfaces, les serveurs DNS et les adresses résolues des hôtes de proxy et de passerelle configurés dans l’environnement au démarrage du conteneur. Les hôtes transmis plus tard pendant un tour d’agent échappent à cette observation initiale. Il tient aussi compte du réseau d’organisation Docker raccordé ensuite. Le runtime privilégie `172.31.0.0/16` s’il est libre, puis essaie d’autres plages privées `/16`. Le premier `/24` sert à `docker0` ; les réseaux Compose internes utilisent des blocs `/24` du même pool. En mode automatique, une observation indisponible ou l’absence de plage libre empêche le démarrage de la session.

Un Pod ne peut pas déduire tous les CIDR des Pods, des Services et du VPC du cluster depuis son propre namespace réseau. Pour DinD sur Kubernetes, définis `SANDBOX_DIND_INNER_POOL` avec un `/16` privé que tu as vérifié contre l’ensemble de ces réseaux. Un pool explicite reste refusé si le runtime détecte un chevauchement ou une valeur invalide. Si certaines observations manquent, il les indique dans un avertissement et peut continuer avec ce pool ; c’est à toi de tenir compte des plages invisibles depuis le Pod.

Après avoir modifié ce pool, redémarre le spawner et recrée les sessions existantes pour leur appliquer la valeur. Redémarrer le conteneur runner dans le même Pod Kubernetes conserve l’environnement du Pod et le stockage Docker interne.

Le proxy egress autorise les requêtes DNS vers les adresses IP de serveurs de noms validées dans son `/etc/resolv.conf`, y compris le DNS privé du cluster. Chaque exception se limite à cette IP exacte et au port de destination 53 en UDP/TCP. Les autres destinations privées et le transfert entre réseaux raccordés restent bloqués.

### Protection du transfert IPv6

Garde `sandbox`, `sandbox-egress` et `SANDBOX_RUNTIME_IMAGE` sur la même version lors d’une mise à niveau. Avant de raccorder le réseau de build Docker d’une organisation, le spawner vérifie la protection de la session contre le transfert de paquets. Compose et les conteneurs de session Docker générés désactivent IPv6 avec `net.ipv6.conf.all.disable_ipv6=1` et `net.ipv6.conf.default.disable_ipv6=1`. Conserve les deux valeurs dans tes propres définitions Docker.

Les Pods Kubernetes ne reçoivent pas automatiquement de sysctls non sûrs. Le proxy egress a besoin d’un pare-feu IPv6 fonctionnel ou d’IPv6 désactivé dans son namespace réseau. Si le pare-feu IPv6 est indisponible, l’entrypoint tente cette désactivation locale, puis vérifie la valeur par défaut et chaque interface. Un `/proc/sys` en lecture seule ou des droits insuffisants peuvent l’en empêcher ; IPv6 encore actif sans protection bloque le démarrage. Configure le Pod egress avant le déploiement avec les paramètres réseau autorisés par ton cluster.

## Tours d'agent en sandbox

| Nom                              | Défaut               | Description                                                                                                                                                                                                                                                                                                                              |
| -------------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TALE_EXTERNAL_TURN_DEADLINE_MS` | `1800000` (30 min)   | **Optionnel.** Combien de temps un tour d’agent de code en sandbox (Claude Code, OpenCode, Codex) peut rester sans que personne ne lise sa sortie avant que le daemon de la sandbox ne le récupère. Une fenêtre glissante, relancée chaque fois que la plateforme se rattache à la sortie — pas un plafond absolu sur le tour. En millisecondes. |
| `SANDBOX_LLM_GATEWAY_STREAM_IDLE_TIMEOUT_SECONDS` | `600` (10 min) | **Optionnel.** Combien de temps la passerelle de modèles de la sandbox attend l’octet suivant d’un modèle en amont resté silencieux avant d’interrompre le flux, y compris pendant qu’un modèle local lent traite encore un long prompt. Le backend lit cette valeur et s’en sert pour configurer la passerelle. Les tours Claude Code et Codex attendent au moins aussi longtemps avant d’abandonner un flux silencieux et de renvoyer la requête. Tu peux donc l’augmenter pour un modèle local lent sans que l’un d’eux envoie un tour en double. En contrepartie, un modèle en amont bloqué retient aussi un tour plus longtemps avant que la passerelle n’interrompe le flux. Une valeur supérieure à 600 relève aussi d’autant le délai de requête de la passerelle : il borne une réponse entière non diffusée en flux, sur laquelle un agent se replie quand un flux s’interrompt. En secondes. |

Cherche pourquoi la sortie n’est plus lue avant d’augmenter ce délai. Il limite les flux de sortie abandonnés, pas la durée totale d’une tâche. Recrée les rôles backend concernés après avoir changé l’environnement.

## Ingestion de liens vidéo (yt-dlp)

Le worker utilise ces valeurs pour récupérer les transcriptions vidéo. Son image comprend yt-dlp et un plugin de jetons PO. [Importation vidéo](/fr/self-hosted/configuration/video-ingestion) distingue les restrictions de source, les problèmes de sortie réseau et les sessions autorisées. Recrée le worker après une modification de son environnement ; relire une variable dans un processus ne recharge pas `.env`.

| Nom                              | Défaut                                     | Description                                                                                                                                                                                                                                                                                                                                                  |
| -------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `VIDEO_INGEST_PROXY_URL` | non défini | Proxy des requêtes yt-dlp. Protocoles admis : `http`, `https`, `socks4`, `socks4a`, `socks5`, `socks5h` ; le dernier résout le DNS de destination au proxy. Utilise un service de sortie approuvé. |
| `VIDEO_INGEST_POT_PROVIDER_URL` | `http://bgutil-provider:4416` (intégré) | URL du fournisseur de jetons PO. Le sidecar fourni est utilisé par défaut lorsque le plugin est présent dans l’image. Les jetons peuvent aider la récupération, sans autoriser du contenu privé ni garantir le succès. |
| `VIDEO_INGEST_FETCH_POT` | `always` dès qu'un fournisseur est branché | Quand demander des jetons : `never`, `auto` ou `always`. Le parcours fourni utilise `always`. Choisis `never` pour désactiver délibérément cette source de jetons. |
| `VIDEO_INGEST_YTDLP_PLUGIN_DIRS` | `/opt/yt-dlp/plugins` (intégré)            | Répertoire depuis lequel yt-dlp charge les plugins — chaque plugin imbriqué un niveau plus bas (`<dir>/<nom>/yt_dlp_plugins/…`). Par défaut, le répertoire de plugins bgutil intégré quand il est présent ; ne le remplace que pour ajouter tes propres plugins.                                                                                             |
| `VIDEO_INGEST_COOKIES_FILE` | non défini | Chemin dans le worker vers un fichier de cookies Netscape. Protège-le comme des identifiants de compte et utilise une session autorisée. Le pool de sessions par organisation décrit dans le guide vidéo permet un import et une révocation gérés. |
| `VIDEO_INGEST_PLAYER_CLIENT`     | `default,tv_simply`                        | Liste de repli des clients de lecture YouTube, séparés par des virgules. Quand un fournisseur de PO tokens est branché, la valeur par défaut s'élargit à `default,mweb,tv_simply` (mweb exige un token GVS) ; définis-la explicitement pour forcer une liste.                                                                                                |
| `VIDEO_INGEST_PO_TOKEN`          | non défini                                 | PO token défini manuellement (`CLIENT.CONTEXT+TOKEN`). Surtout pour les tests — les tokens sont liés à l'ID de la vidéo et éphémères ; privilégie le fournisseur.                                                                                                                                                                                            |
| `VIDEO_INGEST_IMPERSONATE`       | non défini                                 | Cible d'imitation TLS/JA3 du navigateur (p. ex. `safari`). Nécessite `curl_cffi` dans l'image ; à laisser non défini sauf disponibilité connue.                                                                                                                                                                                                              |
| `VIDEO_INGEST_BIN_DIR`           | non défini                                 | Répertoire ajouté en tête du `PATH` du processus enfant yt-dlp/ffmpeg, pour qu'un `yt-dlp` auto-provisionné (et son runtime Deno) installé hors des répertoires bin intégrés soit trouvé en premier. L'image du backend intègre yt-dlp dans le `PATH`, donc laisse-le non défini là ; définis-le sur un hôte ou une machine de dev avec sa propre toolchain. |
| `VIDEO_INGEST_FFMPEG_LOCATION`   | `/usr/bin/ffmpeg`                          | Chemin absolu vers le ffmpeg que yt-dlp utilise pour la post-production (conversion des sous-titres, extraction audio). À surcharger quand ffmpeg vit ailleurs — p. ex. le `/opt/homebrew/bin/ffmpeg` de Homebrew sur une machine de dev macOS.                                                                                                              |
