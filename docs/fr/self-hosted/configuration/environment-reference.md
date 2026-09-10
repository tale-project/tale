---
title: Référence des variables d'environnement
description: Chaque variable d'environnement que Tale lit au boot, sa valeur par défaut et la surface produit qu'elle contrôle. La référence opérateur complète pour `.env`.
i18nLintExclude:
  - terminology-loanword
  - prose-exclamation
  - style-numbers
---

Tale lit sa configuration depuis un unique fichier `.env` à la racine du dépôt. Environ une douzaine de variables sont obligatoires au premier boot ; les autres ajustent le comportement. Cette page liste chaque variable que [`.env.example`](https://github.com/tale-project/tale/blob/main/.env.example) ship, sa valeur par défaut et la surface produit qui la consomme.

Les groupes sont ordonnés selon le moment où tu en as besoin la première fois : identité de domaine, TLS, secrets, base de données, instance, observabilité, chiffrement des fournisseurs. Après avoir modifié `.env`, recrée les services concernés avec ta procédure de déploiement. `docker compose restart` conserve l’environnement existant du conteneur.

## Comment lire cette page

Chaque groupe est un tableau `Nom | Défaut | Description`. Les variables marquées **Obligatoire** doivent être définies pour que `docker compose up` réussisse. Les variables marquées **Optionnel** peuvent rester non définies ; la description nomme ce que désactiver la fonctionnalité signifie.

Le fichier `.env.example` ship des commentaires inline qui expliquent chaque variable dans son contexte ; cette page est la référence structurée et groupée pour le même ensemble.

## Identité de domaine (obligatoire au premier boot)

| Nom         | Défaut              | Description                                                                                                                               |
| ----------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `HOST`      | `localhost`         | **Obligatoire.** Nom d'hôte sans protocole. Utilisé pour le réseau Docker et le mail sortant.                                             |
| `SITE_URL`  | `https://localhost` | **Obligatoire.** URL canonique complète incluant le schéma et tout port non standard. Les callbacks d'auth l'utilisent.                   |
| `ADDITIONAL_SITE_URLS` | non défini | **Optionnel.** Autres origines sur lesquelles le même déploiement répond, séparées par des virgules ou des espaces (ex. `https://a.example,https://b.example`). Chacune est une entrée complète. Voir [TLS et domaines](/fr/self-hosted/configuration/tls-and-domains#plusieurs-domaines-a-la-fois). |
| `BASE_PATH` | non défini          | **Optionnel.** Préfixe de chemin pour les déploiements en sous-chemin derrière un reverse proxy (ex. `/app`). Laisse vide pour la racine. |

Le `SITE_URL` doit correspondre exactement à ce que l'utilisateur tape dans le navigateur. Un slash en queue, un port manquant ou `http` au lieu de `https` cassent le callback d'auth et produisent des boucles de sign-in. Quand un déploiement sert plusieurs domaines, `SITE_URL` reste le canonique et le reste va dans `ADDITIONAL_SITE_URLS` ; une entrée doit y être une origine nue, et une entrée malformée arrête le backend au boot plutôt que de laisser un domaine sur lequel personne ne peut se connecter.

## TLS

| Nom         | Défaut       | Description                                                                                                           |
| ----------- | ------------ | --------------------------------------------------------------------------------------------------------------------- |
| `TLS_MODE`  | `selfsigned` | Un de `selfsigned`, `letsencrypt`, `external`. Voir [TLS et domaines](/fr/self-hosted/configuration/tls-and-domains). |
| `TLS_EMAIL` | non défini   | E-mail de contact pour les notifications Let's Encrypt. Optionnel mais recommandé en production.                      |

`selfsigned` fait tourner Caddy avec un certificat généré — le navigateur avertit, OK pour le développement. `letsencrypt` exige un vrai domaine et les ports 80/443 joignables depuis l'Internet public. `external` fait servir Caddy en HTTP brut ; un reverse proxy amont termine TLS.

## Secrets de sécurité (obligatoire)

| Nom                     | Défaut                           | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `BETTER_AUTH_SECRET`    | valeur d'exemple dans le fichier | **Obligatoire.** Secret base64 pour le signeur de session Better Auth. Génère avec `openssl rand -base64 32`. La rotation invalide chaque session.                                                                                                                                                                                                                                                                                                                                                                                         |
| `ENCRYPTION_SECRET_HEX` | valeur d'exemple dans le fichier | **Obligatoire.** Clé hex de 32 octets. Clé AES-256 pour les credentials OAuth et connectors et entrée HKDF pour la secret-box des garde-fous. Génère avec `openssl rand -hex 32`. La rotation invalide chaque ciphertext en base ; les opérateurs doivent réinscrire les secrets concernés.                                                                                                                                                                                                                                                |
| `INSTANCE_SECRET`       | valeur d'exemple dans le fichier | **Obligatoire.** Le secret racine de l’instance : 64 caractères hex, généré par `tale init` (à la main : `openssl rand -hex 32`). Au démarrage, Tale en dérive la clé HMAC des mots de passe d’app WebDAV (`WEBDAV_APP_PASSWORD_HMAC_KEY`) sauf si tu définis cette clé toi-même, et les jetons éphémères avec lesquels les sessions sandbox récupèrent des blobs sont signés par une sous-clé de la même dérivation. Garde-le stable entre les déploiements : une rotation re-dérive la clé et invalide chaque mot de passe d’app WebDAV. |
| `SANDBOX_TOKEN`         | valeur d'exemple dans le fichier | **Obligatoire.** Secret HMAC partagé entre le backend et le spawner sandbox : le backend signe chaque appel au spawner avec, et le spawner rejette les appels non signés. Sans lui, le spawner refuse de démarrer — il tient le socket docker de l’hôte, il n’a donc pas de mode non signé. `tale init` et `bun run dev` le génèrent ; une stack que tu composes toi-même le pose avant le premier boot (`openssl rand -hex 32`). Une rotation veut dire redémarrer le backend et le spawner ensemble — ils doivent s’accorder. |
| `SANDBOX_LLM_GATEWAY_ADMIN_PASSWORD` | non défini | **Obligatoire pour les runs d’agent.** Credential admin de l’API de management de la gateway LLM sandbox, que le backend appelle pour créer la clé virtuelle de session sur laquelle tourne chaque tour de harness. La gateway est présente sur le réseau sandbox, donc son plan de management n’est jamais anonyme : sans le secret, le backend refuse l’appel et chaque run d’agent échoue au démarrage. `tale init` / `tale deploy` et `bun run dev` le génèrent ; une stack que tu composes toi-même le pose avant le premier boot (`openssl rand -hex 32`). Seul le backend le lit — la gateway reçoit le credential via son API de management au premier appel de provisioning et n’a besoin d’aucune variable d’environnement à elle. Garde-le stable — la gateway le hashe dans `llm-gateway-data`, donc une valeur changée verrouille la plateforme dehors jusqu’à ce que ce volume soit effacé. Le nom d’utilisateur vaut `admin` par défaut (`SANDBOX_LLM_GATEWAY_ADMIN_USERNAME`). |

Remplace les valeurs livrées dans `.env.example` avant d'exposer l'instance — ce sont des espaces réservés volontairement non sûrs.

## Base de données

Tale garde deux bases : le magasin opérationnel (`tale_app` — agents, runs, le log d'audit) et le corpus de connaissances (`tale_knowledge` — fragments de documents, embeddings, pages crawlées). Un stack de production replie les deux dans un seul service ParadeDB (`db`, port 5432, alias `knowledge-db`). Les deux partagent `DB_PASSWORD`, et le corpus peut être pointé vers une infrastructure externe tout seul.

| Nom                                       | Défaut                                                              | Description                                                                                                                                                                                                                                                                                                                                                |
| ----------------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DB_PASSWORD`                             | `tale_password_change_me`                                           | **Obligatoire.** Mot de passe pour l'utilisateur Postgres auto-hébergé. Change-le avant la production. Utilisé par les deux conteneurs de base de données.                                                                                                                                                                                                 |
| `DATABASE_URL`                            | construit depuis `DB_PASSWORD`                                      | **Optionnel.** URL de connexion de la base opérationnelle. Pose-la pour diriger le backend vers un Postgres que tu exploites toi-même : il n’a besoin d’aucune extension ni d’un superutilisateur, seulement d’une base et d’un rôle qui peut créer des schémas. Relue à chaque démarrage. |
| `DATABASE_POOL_MAX`                       | `10`                                                                | **Optionnel.** Connexions qu’un processus backend ouvre vers la base opérationnelle. Chaque réplique de `backend-api` et `backend-worker` en coûte le double — le pool applicatif et celui de la file de jobs. C’est ce nombre que tu compares au `max_connections` d’un Postgres managé. |
| `POSTGRES_CA_FILE`                        | non défini                                                          | **Optionnel.** Chemin d’un bundle PEM auquel **toutes** les connexions Postgres font confiance : la base opérationnelle, le corpus de connaissances et les bases que les organisations apportent elles-mêmes. Nécessaire dès qu’une URL demande `sslmode=verify-ca` ou `verify-full` face à un fournisseur dont la racine n’est pas livrée avec Node — Amazon RDS est le cas courant. Si tes bases utilisent des fournisseurs différents, concatène leurs racines dans un seul fichier. |
| `KNOWLEDGE_DATABASE_URL`                  | `postgresql://tale:${DB_PASSWORD}@knowledge-db:5432/tale_knowledge` | **Optionnel.** URL de connexion que le backend utilise pour le corpus de connaissances. Override pour relocaliser le corpus vers ton propre ParadeDB géré — la banque sensible à la résidence se déplace indépendamment.                                                                                                                                   |
| `KNOWLEDGE_DB_NAME`                       | `tale_knowledge`                                                    | **Optionnel.** Nom de la base de connaissances. Le conteneur `knowledge-db` fourni crée cette base au premier boot.                                                                                                                                                                                                                                        |
| `KNOWLEDGE_INDEX_REPAIR_INLINE_MAX_BYTES` | `1073741824`                                                        | **Optionnel.** Taille maximale (en octets) d'un index de recherche BM25 que le backend reconstruit de façon synchrone au démarrage quand il le trouve corrompu ; au-delà, un job d'arrière-plan le reconstruit pendant que les écritures vers ce corpus sont refusées. Voir [Architecture des conteneurs](/fr/self-hosted/operate/container-architecture). |
| `KNOWLEDGE_INDEX_REPAIR_DISABLED`         | non défini                                                          | **Optionnel.** `1` ou `true` désactive la vérification et la réparation des index de recherche BM25 au démarrage. Un index corrompu fait alors planter la base de connaissances à chaque écriture jusqu'à sa reconstruction manuelle.                                                                                                                      |

La forme opérationnelle auto-construite est `postgresql://tale:${DB_PASSWORD}@db:5432/tale_app` (le nom de base s’override avec `APP_DB_NAME`). Le corpus de connaissances vit dans `tale_knowledge` avec les schémas `private_knowledge` et `public_web` ; ces variables fixent les défauts du déploiement que toutes les organisations partagent ; une organisation peut en plus pointer son propre corpus et son propre bucket vers sa propre infrastructure sous **Paramètres > Résidence des données** (fichiers par organisation, appliqués à chaud, sans redémarrage), couvert dans [Résidence des données](/fr/self-hosted/configuration/data-residency).

Deux points à connaître avant de diriger l’une des deux bases vers ta propre infrastructure :

- **Le corpus de connaissances exige `pgvector` déjà installé.** Tale crée lui-même ses schémas et ses tables sur une base vide, mais n’installe jamais d’extension — la table des chunks porte une colonne `vector`, donc `CREATE EXTENSION vector;` doit avoir été lancé sur la base cible. Le `pg_search` de ParadeDB reste optionnel : sans lui la recherche retombe sur le vectoriel seul au lieu d’échouer. La base opérationnelle, elle, n’a besoin d’aucune extension.
- **Aucune des deux bases ne peut se trouver derrière un pooler de connexions en mode transaction.** La file de jobs garde des connexions `LISTEN`, le migrateur tient un verrou consultatif lié à la session, et la couche de requêtes utilise des prepared statements — les trois ont besoin d’une session à eux. PgBouncer en mode session convient ; le mode transaction non, pas plus qu’un endpoint de pooler qui multiplexe (port pooler de Supabase, RDS Proxy qui épingle). Dirige Tale vers le port propre de la base.

## Store d'objets

Les documents téléversés, les pièces jointes de chat, l’audio et les médias générés vivent dans un store compatible S3 : celui qui est embarqué (le service `object-store`, MinIO), ou n’importe quel bucket que tu apportes — AWS S3, MinIO, Cloudflare R2, Wasabi. C’est le seul backend de blobs, donc un déploiement qui ne l’atteint pas refuse le moindre téléversement. Une organisation qui pointe ses blobs vers son propre bucket (**Paramètres > Résidence des données**) est résolue avant ce défaut de déploiement et n’est pas touchée par ces variables.

| Nom                              | Défaut                       | Description                                                                                                                                                                           |
| -------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OBJECT_STORE_ACCESS_KEY`        | non défini                   | **Obligatoire.** Clé d’accès S3 — et, pour le store embarqué, son utilisateur root, les deux côtés lisant la même valeur. Le processus n’a pas de défaut : si l’une des deux clés manque, le backend ne configure aucun store et refuse le moindre téléversement. |
| `OBJECT_STORE_SECRET_KEY`        | auto-généré par `tale init`  | **Obligatoire.** Clé secrète S3 / mot de passe root MinIO. Pour le store **embarqué** elle doit rester stable — c’est l’identifiant du store lui-même, et la changer orpheline tout blob déjà écrit. Pour un bucket **externe** ce n’est qu’un identifiant, et la changer ici est la façon prévue de la faire tourner. |
| `OBJECT_STORE_BUCKET`            | `tale-blobs`                 | Bucket où vivent les blobs. Le backend le crée s’il est absent et que la clé y est autorisée ; s’il existe déjà, il l’utilise tel quel. |
| `OBJECT_STORE_ENDPOINT`          | `http://object-store:9000` dans le compose livré | Où le backend atteint le store. **Laisse-le vide pour AWS S3 lui-même** — le bucket est alors adressé sur `https://<bucket>.s3.<region>.amazonaws.com`. Pose-le pour MinIO, R2, Wasabi ou tout autre endpoint compatible S3. |
| `OBJECT_STORE_REGION`            | `us-east-1`                  | Région de signature. Signifiante sur AWS ; arbitraire mais exigée par le signataire pour un store auto-hébergé. |
| `OBJECT_STORE_FORCE_PATH_STYLE`  | `true` avec endpoint, `false` sans | Adresse le bucket en `endpoint/bucket/key` plutôt qu’en `bucket.endpoint/key`. Le défaut suit l’endpoint et convient donc aux deux cas ; ne le pose que pour un store qui déroge à sa propre forme. |
| `OBJECT_STORE_PREFIX`            | non défini                   | Préfixe de clés dans le bucket, pour que les blobs de Tale partagent un bucket avec d’autres données. Vide signifie la racine du bucket. |
| `OBJECT_STORE_PUBLIC_ENDPOINT`   | `${SITE_URL}` (posé par la CLI) | Où le **navigateur** atteint le store. Le proxy publie le store embarqué sous `/<bucket>/*` et transfère les URLs présignées telles quelles, donc téléversements et téléchargements se font directement navigateur↔store. Laisse-le vide pour un bucket que le navigateur atteint déjà. |

Le store embarqué est purement interne : les URLs présignées sont signées par le backend contre l’endpoint interne puis transférées par le proxy, et le store lui-même n’est jamais publié.

### Comment ces variables arrivent dans le déploiement en cours

Le backend garde `default/object-storage/connection.json` du volume de config aligné sur ces variables et les relit à chaque démarrage — repointer le store, ou faire tourner ses identifiants, se réduit donc à une modification de l’environnement suivie d’un redémarrage de `backend-api` et `backend-worker`. Le journal de démarrage dit lequel de ces cas s’est produit :

| Ligne | Signification |
| --- | --- |
| `object store (seeded)` | il n’y avait aucune connexion ; une a été écrite depuis l’environnement |
| `object store (reconciled)` | l’environnement a changé ; la connexion a été mise à jour |
| `object store (adopted)` | une connexion écrite par une version antérieure a été reconnue et est désormais suivie |
| `object store (ignored)` | la connexion porte `"managedBy": "operator"`, ces variables ne font donc rien |
| `object store (skipped)` | aucune paire d’identifiants ; le déploiement refusera tout téléversement |
| *(rien)* | déjà aligné — l’état normal |

Si tu préfères gérer le store à la main, mets `"managedBy": "operator"` dans `connection.json` : le backend ne touchera plus jamais ce fichier. Un fichier sans `managedBy` du tout — écrit avant ce comportement — n’est repris que s’il nomme encore le même bucket sur le même endpoint que l’environnement ; si tu l’avais repointé à la main, ta modification reste.

Droits sur le bucket : le backend vérifie l’existence du bucket avec `HeadBucket` et ne le crée que s’il est absent. Une clé qui peut lire, écrire et supprimer des objets sans pouvoir créer de bucket suffit donc, à condition que tu crées le bucket toi-même. Les téléversements et téléchargements présignés passent par le navigateur : un bucket externe a donc aussi besoin d’une politique CORS autorisant l’origine de ton déploiement en `GET`, `PUT` et `HEAD` — voir [Résidence des données](/fr/self-hosted/configuration/data-residency).

## Signature du journal d'audit

La chaîne de hachage d'audit est rendue inviolable par une signature HMAC-SHA256 sur ses checkpoints de rétention et de scrub PII (SOC 2 CC7.2, ISO 27001) ; le cron d'intégrité quotidien la vérifie. Une seconde clé pseudonymise les données personnelles qu'une connexion échouée laisse dans la chaîne.

| Nom                               | Défaut                      | Description                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --------------------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TALE_AUDIT_SIGNING_KEY`          | auto-généré par `tale init` | Clé HMAC hex de 64 caractères. Garde-la stable entre les déploiements et sauvegarde-la — une clé manquante ou changée déclenche l'alerte « Audit log integrity check failed ».                                                                                                                                                                                                                                                    |
| `TALE_AUDIT_SIGNING_KEY_PREVIOUS` | non défini                  | La clé précédente pendant une fenêtre de rotation. Copie la clé actuelle ici, pose une nouvelle `TALE_AUDIT_SIGNING_KEY`, redéploie ; le vérificateur accepte les deux, puis retire celle-ci la fois suivante.                                                                                                                                                                                                                    |
| `TALE_AUDIT_PEPPER`               | auto-généré par `tale init` | Pepper (16 caractères ou plus) pour le hash HMAC-SHA256 de l'e-mail et du préfixe `/24` (IPv4) ou `/64` (IPv6) de l'IP qu'une connexion échouée écrit dans le journal d'audit — des lignes qui vivent 365 à 3650 jours, bien plus longtemps que la tentative elle-même. Sans lui, ces lignes portent l'e-mail et l'IP en clair et le backend journalise un avertissement `[SECURITY]`. Le faire tourner coupe la corrélation au passage de la frontière ; les anciennes lignes expirent avec la rétention. |

Voir [Intégrité du journal d'audit](/fr/self-hosted/operate/security/audit-log-integrity) pour le modèle de vérification.

## Observabilité

| Nom                         | Défaut     | Description                                                                                                                                                            |
| --------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SENTRY_DSN`                | non défini | DSN Sentry pour le suivi d'erreurs. Laisse vide pour désactiver. Compatible avec GlitchTip et Bugsink auto-hébergés.                                                   |
| `SENTRY_TRACES_SAMPLE_RATE` | non défini | Taux d'échantillonnage optionnel pour les traces de performance du navigateur (`0.0`–`1.0`). Navigateur uniquement — le backend remonte des erreurs, jamais de traces. |
| `METRICS_BEARER_TOKEN`      | non défini | Token bearer requis pour accéder aux endpoints Prometheus `/metrics/*`. Laisse vide pour rendre les endpoints inatteignables de l'extérieur.                           |

Définir `METRICS_BEARER_TOKEN` expose les endpoints de métriques derrière le token : `/metrics/platform`, `/metrics/backend` (les métriques du backend applicatif) et `/metrics/sla-rules`. Voir [Configuration d'observabilité](/fr/self-hosted/configuration/observability-config) pour la configuration de scrape.

## Chiffrement des secrets de fournisseur

| Nom                 | Défaut     | Description                                                                                                                                                                   |
| ------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SOPS_AGE_KEY`      | non défini | Clé secrète age inline. Chiffre `providers/*.secrets.json`. Mode par défaut après `tale init`. Plusieurs clés ne sont pas supportées en inline.                               |
| `SOPS_AGE_KEY_FILE` | non défini | Chemin vers un fichier avec une ou plusieurs clés age (une par ligne ; commentaires `#` autorisés). Obligatoire pour la rotation. S'exclut mutuellement avec la forme inline. |

Si les deux clés age ne sont pas définies, Tale stocke `providers/*.secrets.json` en JSON clair en mode 0600. Atteins ce mode seulement si le disque hôte est chiffré au repos ou si les fichiers sont produits par un outillage externe (un montage de secret Kubernetes, un template Vault). Faire tourner une clé age, c'est ajouter la nouvelle clé, réenregistrer chaque fournisseur dans l'UI, puis retirer l'ancienne. Voir [Secrets avec SOPS](/fr/self-hosted/configuration/secrets-with-sops) pour la marche complète de rotation.

La source de clé par variable d'environnement ne nécessite aucun commutateur de déploiement : des identifiants peuvent porter seulement le _nom_ d'une variable d'environnement au lieu d'une clé stockée, tant que ce nom porte le préfixe réservé `TALE_PROVIDER_KEY_`. La barrière est fail-closed — tout autre nom est rejeté, donc le champ ne peut jamais pointer sur un secret de déploiement étranger — et les noms sont plafonnés à 40 caractères. Définis la variable ici ou dans ton gestionnaire de secrets pour que la plateforme et le backend puissent tous deux la lire ; le mécanisme complet est documenté dans [Fournisseurs](/fr/self-hosted/configuration/providers). Un identifiant de type courtier d'abonnement dispose d'un second espace de noms, distinct, pour le secret que Tale présente **au courtier** : ce champ accepte un nom de variable d'environnement sous le préfixe réservé `TALE_TOKEN_SOURCE_`, plafonné à 60 caractères. Les deux préfixes restent séparés à dessein — un secret de courtier n'est pas une clé API de fournisseur, et aucun des deux champs ne peut nommer une variable hors de son propre espace de noms.

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

Bascules optionnelles pour des fonctionnalités non activées par défaut. Chaque drapeau active ou désactive une fonctionnalité au boot ; basculer demande un redémarrage du conteneur plateforme.

| Nom                               | Défaut                   | Description                                                                                                                                                                                                                                                |
| --------------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TRUSTED_HEADERS_ENABLED`         | `false`                  | Active le mode auth par trusted headers (identité fournie par le reverse proxy).                                                                                                                                                                           |
| `TRUSTED_HEADERS_INTERNAL_SECRET` | non défini               | Secret partagé que le proxy authentifiant doit envoyer avec chaque requête trusted headers. Obligatoire dès que le mode est actif — sans lui, l'endpoint refuse de fonctionner.                                                                            |
| `TRUSTED_SECRET_HEADER`           | `Remote-Internal-Secret` | Nom de l'en-tête de requête qui porte le secret interne.                                                                                                                                                                                                   |
| `TRUSTED_EMAIL_HEADER`            | `Remote-Email`           | Nom de l'en-tête de requête qui porte l'e-mail de l'utilisateur — l'identité pour laquelle la session est émise.                                                                                                                                           |
| `TRUSTED_NAME_HEADER`             | `Remote-Name`            | Nom de l'en-tête de requête qui porte le nom affiché. S'il manque, Tale prend la partie locale de l'e-mail.                                                                                                                                                |
| `TRUSTED_ROLE_HEADER`             | `Remote-Role`            | Nom de l'en-tête de requête qui porte le rôle d'organisation avec lequel la session agit (`member` si l'en-tête manque).                                                                                                                                   |
| `TRUSTED_TEAMS_HEADER`            | `Remote-Teams`           | Nom de l'en-tête de requête qui porte les appartenances aux équipes, en entrées `id:name` séparées par des virgules. Absent, les équipes ne bougent pas ; présent, la liste du proxy fait foi pour les appartenances qu'il a accordées (vide les révoque). |
| `TALE_FILE_EVENTS`                | `false`                  | Diffuse les changements des fichiers de config sous `TALE_CONFIG_DIR` aux onglets ouverts (`/events/file`) : un fichier d’agent, de skill ou de branding modifié sur disque apparaît sans recharger. Actif dans le compose de dev, inactif en production.  |
| `TALE_DEPLOYMENT_CONFIG_ADMINS`   | non défini               | Allowlist de courriels (séparés par des virgules) des opérateurs autorisés à écrire le fichier de configuration du déploiement (`deployment.yml`, aujourd’hui la section du runtime de la sandbox) via l’API. Vide/non défini = lecture seule pour tous les admins. La résidence des données se configure par organisation et ne dépend pas de cette liste. |

## Réglage du retrieval RAG

Réglages optionnels pour la recherche dans la base de connaissances. Le chemin RAG re-note les résultats avec un cross-encoder quand le re-ranking est activé. Tous portent le préfixe `RAG_` et sont lus par le backend au boot ; après un changement, lance `docker compose restart backend-api backend-worker` pour qu'il prenne effet.

| Nom                          | Défaut                                 | Description                                                                                                                                                                                  |
| ---------------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RAG_RERANKING_ENABLED`      | `false`                                | Re-note les candidats fusionnés BM25 + vecteur avec un cross-encoder avant de renvoyer les résultats. Améliore la précision au prix de la latence par requête.                               |
| `RAG_RERANKING_MODEL`        | `cross-encoder/ms-marco-MiniLM-L-6-v2` | Identifiant du modèle cross-encoder transmis au fournisseur de rerank.                                                                                                                       |
| `RAG_RERANKING_PROVIDER`     | `local`                                | Doit être réglé sur `api` pour activer le re-ranking — il poste les candidats à un endpoint `/rerank` externe (compatible Cohere/Jina). `local` n'est plus supporté et échoue tout de suite. |
| `RAG_RERANKING_TOP_K`        | `10`                                   | Nombre maximal de résultats que le reranker renvoie. La réponse ne dépasse jamais le `top_k` de la requête.                                                                                  |
| `RAG_RERANKING_CANDIDATES`   | `30`                                   | Taille du pool de candidats fourni au reranker. Un pool plus large améliore la qualité de re-notation et coûte proportionnellement plus de temps par requête.                                |
| `RAG_RERANKING_API_BASE_URL` | non défini                             | URL de base du fournisseur de rerank ; le backend appelle `{base_url}/rerank`. Obligatoire quand le re-ranking est activé.                                                                   |
| `RAG_RERANKING_API_KEY`      | non défini                             | Token Bearer envoyé à l'endpoint de rerank externe. Laisse-le non défini pour les endpoints sans authentification.                                                                           |

Le re-ranking est livré désactivé parce qu'il ajoute de la latence par requête et dépend d'un endpoint externe. Active-le — en réglant `RAG_RERANKING_PROVIDER=api` et en pointant `RAG_RERANKING_API_BASE_URL` vers un service de rerank hébergé — quand la précision du retrieval compte plus que le temps de réponse. Il n'y a aucun modèle en in-process à télécharger ou à mettre en cache ; le re-ranking désactivé, la recherche renvoie le classement hybride BM25 + vecteur simple.

## Topologie du déploiement

Combien de replicas de chaque rôle sans état une couleur fait tourner. `tale deploy` les lit dans le `.env` du projet ; une valeur hors plage est ramenée dans la plage avec un avertissement plutôt que refusée — zéro replica d'API, c'est une panne que personne ne configure exprès.

| Nom                            | Défaut  | Description                                                                                              |
| ------------------------------ | ------- | ---------------------------------------------------------------------------------------------------------- |
| `TALE_PLATFORM_REPLICAS`       | `1`     | Replicas de l'étage web qui sert la coquille de l'app. Plage `1`–`16`.                                     |
| `TALE_BACKEND_API_REPLICAS`    | `1`     | Replicas de l'API — chaque porte applicative, l'auth et le flux de hints. Plage `1`–`16`.                  |
| `TALE_BACKEND_WORKER_REPLICAS` | `1`     | Replicas du runner de jobs : ingestion, crawls, automations, tours d'agent. Plage `1`–`16`.                |

Un déploiement fait tourner les deux couleurs en même temps : chaque nombre est doublé pendant le chevauchement. Monte le worker d’abord — c’est le moins cher. [Montées de version](/fr/self-hosted/operate/upgrades) est quand ces nombres s’appliquent.

## Sessions

| Nom                            | Défaut     | Description                                                                                                                                                                                                           |
| ------------------------------ | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SESSION_IDLE_TIMEOUT_MINUTES` | non défini | **Optionnel.** Déconnecte une session après ce nombre de minutes d'inactivité (`1`–`1440`). La fenêtre glisse à chaque activité et est appliquée côté serveur — sessions e-mail/mot de passe, SSO et trusted headers. |

Laisse-le non défini pour conserver la durée de session par défaut. Si défini, une session inactive expire côté serveur une fois la fenêtre écoulée, tandis qu'une session active continue de glisser à chaque requête. Les Administrateurs d'organisation peuvent raccourcir la fenêtre effective par organisation — jamais l'allonger au-delà de ce plafond — via la [politique de gouvernance du délai d'inactivité de session](/fr/platform/admin/governance/policies-and-limits) ; les sessions inactives sous cette politique sont révoquées par une passe qui tourne environ toutes les cinq minutes.

## Infrastructure sandbox

Le spawner sandbox lit les paramètres ci-dessous. Transmets-les dans son environnement et recrée ce service après une modification. `SANDBOX_MAX_SESSIONS` fixe la capacité partagée par toutes les organisations. Le total des trois limites de travail d’une organisation se recalcule automatiquement ; tu ne peux pas enregistrer ces limites s’il dépasse cette capacité. Gère les limites dans [Sandboxes](/fr/platform/admin/sandboxes), où les environnements réellement actifs et les mesures de l’hôte apparaissent séparément des allocations.

| Nom | Défaut | Description |
| --- | --- | --- |
| `SANDBOX_MAX_SESSIONS` | `8` | Nombre maximal de sessions actives ou au démarrage de toutes les organisations sur l’hôte Docker ou dans le namespace Kubernetes, y compris les conteneurs inactifs conservés pour être réutilisés. Cette capacité ne réserve ni CPU ni mémoire. Des réplicas Kubernetes concurrents l’appliquent au mieux ; utilise ResourceQuota pour imposer des limites strictes aux ressources du namespace. |
| `SANDBOX_AGENT_CPUS` | `2` | Limite de CPU par session d’agent. Tiens compte des builds simultanés et des autres tâches de l’hôte pour choisir le nombre de sessions. |
| `SANDBOX_AGENT_MEMORY` | `4g` ; `8g` avec Docker dans la sandbox | Limite de mémoire par session d’agent, partagée avec son daemon Docker interne et les conteneurs qu’il lance. Une valeur explicite remplace ces deux valeurs par défaut et s’applique aux nouvelles sessions. |
| `SANDBOX_SESSION_MAX_IDLE_MS` | `1800000` (30 min) | Délai d’inactivité avant l’arrêt des sessions non épinglées. Les conteneurs auxiliaires du cache de build d’une organisation s’arrêtent aussi après ce délai sans session potentiellement active ; leurs réseaux et volumes de cache sont conservés. |
| `SANDBOX_RUNTIME_IMAGE`          | `tale-sandbox-runtime:latest` | **Optionnel, lu par le spawner.** L'image dont sort chaque conteneur de session. Le défaut est le tag que la stack de développement construit localement ; un hôte qui tire ses images pose donc le nom de la registry : `ghcr.io/tale-project/tale/tale-sandbox-runtime:<version>`, aligné sur le reste de la stack. `tale deploy` le pose pour toi. |
| `SANDBOX_DIND_INNER_POOL` | non défini (automatique) | Pool d’adresses optionnel du daemon Docker interne des sessions d’agent, sur Docker ou Kubernetes. Choisis un `/16` IPv4 privé RFC1918 sous forme canonique, hors de tes réseaux de Pods, de Services et de VPC. La runtime refuse tout chevauchement avec les réseaux et adresses qu’elle détecte. |

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

Sur Docker et Kubernetes, le choix automatique vérifie les routes IPv4 et leurs passerelles dans toutes les tables de routage, les adresses et préfixes des interfaces, les serveurs DNS et les adresses résolues des hôtes de proxy et de passerelle configurés dans l’environnement au démarrage du conteneur. Les hôtes transmis plus tard pendant un tour d’agent échappent à cette observation initiale. Il tient aussi compte du réseau d’organisation Docker raccordé ensuite. La runtime privilégie `172.31.0.0/16` s’il est libre, puis essaie d’autres plages privées `/16`. Le premier `/24` sert à `docker0` ; les réseaux Compose internes utilisent des blocs `/24` du même pool. En mode automatique, une observation indisponible ou l’absence de plage libre empêche le démarrage de la session.

Un Pod ne peut pas déduire tous les CIDR des Pods, des Services et du VPC du cluster depuis son propre namespace réseau. Pour DinD sur Kubernetes, définis `SANDBOX_DIND_INNER_POOL` avec un `/16` privé que tu as vérifié contre l’ensemble de ces réseaux. Un pool explicite reste refusé si la runtime détecte un chevauchement ou une valeur invalide. Si certaines observations manquent, elle les indique dans un avertissement et peut continuer avec ce pool ; c’est à toi de tenir compte des plages invisibles depuis le Pod.

Après avoir modifié ce pool, redémarre le spawner et recrée les sessions existantes pour leur appliquer la valeur. Redémarrer le conteneur runner dans le même Pod Kubernetes conserve l’environnement du Pod et le stockage Docker interne.

Le proxy egress autorise les requêtes DNS vers les adresses IP de serveurs de noms validées dans son `/etc/resolv.conf`, y compris le DNS privé du cluster. Chaque exception se limite à cette IP exacte et au port de destination 53 en UDP/TCP. Les autres destinations privées et le transfert entre réseaux raccordés restent bloqués.

### Protection du transfert IPv6

Garde `sandbox`, `sandbox-egress` et `SANDBOX_RUNTIME_IMAGE` sur la même version lors d’une mise à niveau. Avant de raccorder le réseau de build Docker d’une organisation, le spawner vérifie la protection de la session contre le transfert de paquets. Compose et les conteneurs de session Docker générés désactivent IPv6 avec `net.ipv6.conf.all.disable_ipv6=1` et `net.ipv6.conf.default.disable_ipv6=1`. Conserve les deux valeurs dans tes propres définitions Docker.

Les Pods Kubernetes ne reçoivent pas automatiquement de sysctls non sûrs. Le proxy egress a besoin d’un pare-feu IPv6 fonctionnel ou d’IPv6 désactivé dans son namespace réseau. Si le pare-feu IPv6 est indisponible, l’entrypoint tente cette désactivation locale, puis vérifie la valeur par défaut et chaque interface. Un `/proc/sys` en lecture seule ou des droits insuffisants peuvent l’en empêcher ; IPv6 encore actif sans protection bloque le démarrage. Configure le Pod egress avant le déploiement avec les paramètres réseau autorisés par ton cluster.

## Tours d'agent en sandbox

| Nom                              | Défaut               | Description                                                                                                                                                                                                                                                                                                                              |
| -------------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TALE_EXTERNAL_TURN_DEADLINE_MS` | `1800000` (30 min)   | **Optionnel.** Combien de temps un tour d’agent de code en sandbox (Claude Code, OpenCode, Codex) peut rester sans que personne ne lise sa sortie avant que le daemon de la sandbox ne le récupère. Une fenêtre glissante, relancée chaque fois que la plateforme se rattache à la sortie — pas un plafond absolu sur le tour. En millisecondes. |

Augmente-le quand de longs tours d’agent sur un hôte lent reviennent comme des orphelins récupérés ; la plateforme se rattache d’elle-même, la fenêtre ne termine donc qu’un tour dont la chaîne de lecture est morte. Lu par le backend au démarrage — redémarre `backend-api backend-worker` après l’avoir changé.

## Ingestion de liens vidéo (yt-dlp)

Quand Tale ingère un lien vidéo, il récupère sa transcription pour l'agent. YouTube bloque l'accès automatisé depuis les IP de centres de données/serveurs, ce qui peut échouer sur un déploiement cloud. Le déploiement embarque par défaut un fournisseur de PO tokens câblé d'origine (voir [Ingestion vidéo](/fr/self-hosted/configuration/video-ingestion) pour le tableau complet) ; les options ci-dessous sont des surcharges et des escalades facultatives. Aucune ne garantit un contournement — une IP de sortie propre est le levier le plus important. Lues par le backend worker et réévaluées à chaque ingestion, donc une modification prend effet sans redémarrage.

| Nom                              | Défaut                                     | Description                                                                                                                                                                                                                                                                                                                                                  |
| -------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `VIDEO_INGEST_PROXY_URL`         | non défini                                 | Acheminer la sortie de yt-dlp via un proxy (une IP résidentielle/FAI fonctionne le mieux ; les proxys de centre de données sont généralement signalés aussi). Schémas : `http`, `https`, `socks4`, `socks4a`, `socks5`, `socks5h` — privilégie `socks5h://` pour que le DNS soit résolu au niveau du proxy.                                                  |
| `VIDEO_INGEST_POT_PROVIDER_URL`  | `http://bgutil-provider:4416` (intégré)    | URL de base du fournisseur de PO tokens qui fournit les tokens GVS levant le mur anti-bot de YouTube. Par défaut, le sidecar compose `bgutil-provider` quand le plugin intégré est présent — à définir uniquement pour pointer vers un fournisseur sur un autre hôte.                                                                                        |
| `VIDEO_INGEST_FETCH_POT`         | `always` dès qu'un fournisseur est branché | Quand yt-dlp demande des PO tokens au fournisseur (`never`/`auto`/`always`). Le `auto` de yt-dlp n'en demande jamais pour la requête player — précisément là où le mur anti-bot frappe —, Tale passe donc à `always` dès qu'un fournisseur est présent. `never` contourne un fournisseur défaillant.                                                         |
| `VIDEO_INGEST_YTDLP_PLUGIN_DIRS` | `/opt/yt-dlp/plugins` (intégré)            | Répertoire depuis lequel yt-dlp charge les plugins — chaque plugin imbriqué un niveau plus bas (`<dir>/<nom>/yt_dlp_plugins/…`). Par défaut, le répertoire de plugins bgutil intégré quand il est présent ; ne le remplace que pour ajouter tes propres plugins.                                                                                             |
| `VIDEO_INGEST_COOKIES_FILE`      | non défini                                 | Chemin vers un fichier de cookies Netscape. Des cookies invités issus d'une session privée augmentent la limite de débit sans risque de bannissement ; des cookies de compte débloquent le contenu restreint mais risquent le compte.                                                                                                                        |
| `VIDEO_INGEST_PLAYER_CLIENT`     | `default,tv_simply`                        | Liste de repli des clients de lecture YouTube, séparés par des virgules. Quand un fournisseur de PO tokens est branché, la valeur par défaut s'élargit à `default,mweb,tv_simply` (mweb exige un token GVS) ; définis-la explicitement pour forcer une liste.                                                                                                |
| `VIDEO_INGEST_PO_TOKEN`          | non défini                                 | PO token défini manuellement (`CLIENT.CONTEXT+TOKEN`). Surtout pour les tests — les tokens sont liés à l'ID de la vidéo et éphémères ; privilégie le fournisseur.                                                                                                                                                                                            |
| `VIDEO_INGEST_IMPERSONATE`       | non défini                                 | Cible d'imitation TLS/JA3 du navigateur (p. ex. `safari`). Nécessite `curl_cffi` dans l'image ; à laisser non défini sauf disponibilité connue.                                                                                                                                                                                                              |
| `VIDEO_INGEST_BIN_DIR`           | non défini                                 | Répertoire ajouté en tête du `PATH` du processus enfant yt-dlp/ffmpeg, pour qu'un `yt-dlp` auto-provisionné (et son runtime Deno) installé hors des répertoires bin intégrés soit trouvé en premier. L'image du backend intègre yt-dlp dans le `PATH`, donc laisse-le non défini là ; définis-le sur un hôte ou une machine de dev avec sa propre toolchain. |
| `VIDEO_INGEST_FFMPEG_LOCATION`   | `/usr/bin/ffmpeg`                          | Chemin absolu vers le ffmpeg que yt-dlp utilise pour la post-production (conversion des sous-titres, extraction audio). À surcharger quand ffmpeg vit ailleurs — p. ex. le `/opt/homebrew/bin/ffmpeg` de Homebrew sur une machine de dev macOS.                                                                                                              |

Aucune de ces options ne garantit le succès face à la détection adaptative de YouTube. Les vidéos publiques ordinaires, les plateformes moins agressives ou un déploiement à IP résidentielle/auto-hébergé fonctionnent généralement sans elles.

## Où cela s'inscrit

Les variables ici sont la surface de contact de l'opérateur ; la surface UI qui en consomme la plupart vit sous [Plateforme administration](/fr/platform/admin/overview). Les clés de fournisseur sont la moitié-et-moitié : les clés elles-mêmes vivent dans `providers/*.secrets.json`, mais l'UI sous **Paramètres > Fournisseurs IA** est ainsi que tu les ajoutes et les fais tourner en pratique. La lecture suivante à mettre en file est [Fournisseurs](/fr/self-hosted/configuration/providers) — elle couvre les fichiers de connecteurs livrés et les variables réservées qui portent les clés de fournisseur.
