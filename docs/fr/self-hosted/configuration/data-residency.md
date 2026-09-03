---
title: Résidence des données
description: Pointe la base de connaissances, la base de données applicative et le stockage des fichiers téléversés d'une installation Tale auto-hébergée vers une infrastructure que tu contrôles — configuré par les administrateurs dans Paramètres > Résidence des données et appliqué au redémarrage.
---

Une installation Tale auto-hébergée tourne sur une infrastructure que tu contrôles déjà, donc ses données vivent sur tes hôtes par défaut. La **résidence des données** sert au cas où tu veux pointer des banques de données précises vers ton propre Postgres géré ou ton stockage objet plutôt que vers les conteneurs fournis — par exemple pour garder le texte des documents dans une base que ton équipe exploite, ou les fichiers téléversés dans ton propre bucket S3. Le corpus de connaissances tourne comme son propre conteneur (`knowledge-db`) précisément pour pouvoir être relocalisé ou remplacé indépendamment de la base opérationnelle — c'est la banque qui compte le plus pour la majorité des exigences de résidence. Les administrateurs configurent cela dans **Paramètres > Résidence des données** ; le changement est écrit dans un seul fichier de configuration au niveau du déploiement et **prend effet au redémarrage des conteneurs concernés**.

Cette page couvre ce qui peut être déplacé, le seul prérequis qui mord (ParadeDB), comment la configuration est stockée et appliquée, et comment redémarrer sans risque.

## Activer la modification

**Paramètres > Résidence des données** est une seule page avec deux familles de sections : les banques à l'échelle du déploiement que toutes les organisations partagent, et celles qu'une organisation apporte pour elle seule. Chaque section s'affiche en lecture seule ou modifiable selon ce que la personne qui la lit a le droit de changer, et la page nomme l'état dans lequel tu te trouves. Voir la page est ouvert à tout owner ou admin d'une organisation ; **modifier les banques du déploiement** — repointer une banque de données, enregistrer des secrets, lancer un test de connexion ou appliquer un redémarrage — est réservé à une allowlist nommée d'opérateurs. Liste leurs courriels de connexion (séparés par des virgules) dans `.env` et redémarre :

```bash
TALE_DEPLOYMENT_CONFIG_ADMINS=alice@example.com,bob@example.com
```

Si l'allowlist est vide ou non définie, les sections de déploiement montrent toujours la configuration actuelle aux administrateurs, mais en lecture seule — les actions d'en-tête **Enregistrer le déploiement** et **Appliquer & redémarrer** n'apparaissent que pour les opérateurs de l'allowlist. Seul un admin connecté dont le courriel figure sur la liste rend ces sections modifiables ; la page t'indique quel courriel ajouter. Les entrypoints consomment le fichier de configuration quelle que soit l'allowlist, donc un opérateur qui préfère éditer le fichier à la main sur le disque peut le faire sans nommer d'éditeurs UI.

## Ce que tu peux relocaliser

Trois banques de données, chacune indépendante et optionnelle. Un réglage absent signifie « utilise le défaut fourni » — une installation neuve sans configuration reste donc inchangée.

- **Base de connaissances** — le corpus de connaissances : métadonnées des documents, texte des fragments extraits, embeddings, index BM25, cache sémantique et pages web crawlées. Elle est livrée comme le conteneur `knowledge-db` (`tale_knowledge`, avec les schémas `private_knowledge` et `public_web`) et c'est la banque qui compte le plus pour les exigences de résidence, car elle détient le contenu de tes documents. Pointe-la vers ton propre Postgres géré pour garder le corpus sur une infrastructure que ton équipe exploite.
- **Stockage de fichiers** — où vivent les fichiers téléversés (les blobs d'origine). Par défaut ils résident dans le magasin d'objets fourni avec la pile (le service `object-store`, sur son propre volume) ; tu peux les pointer vers un bucket externe compatible S3.
- **Base de données applicative** (avancé) — le magasin opérationnel derrière les agents, les runs et le log d'audit (le conteneur `db` fourni, la base `tale_app`). La relocaliser pointe la `DATABASE_URL` du backend vers ton propre Postgres ; le nom de la base est `tale_app` par défaut (override avec `APP_DB_NAME`), donc un Postgres externe doit contenir une base de ce nom.

> Note : la base de connaissances et la base de données applicative sont deux instances Postgres séparées — déplacer l'une ne touche pas l'autre. Relocaliser la base de connaissances déplace le texte extrait et les embeddings ; les fichiers téléversés d'origine ne suivent que si tu relocalises aussi le **stockage de fichiers** vers S3.

## Le prérequis ParadeDB

La base de connaissances utilise deux extensions Postgres : `vector` (pgvector) pour les embeddings et `pg_search` (ParadeDB) pour la recherche hybride plein texte/BM25. Un Postgres de connaissances externe **doit faire tourner ParadeDB** (qui regroupe les deux) pour une qualité de recherche complète. Si tu le pointes vers un Postgres simple qui n'a que `pgvector`, l'indexation et la recherche vectorielle fonctionnent toujours, mais la recherche hybride se réduit à du **vectoriel seul** — la moitié BM25 est silencieusement sautée. Le bouton **Tester la connexion** signale la disponibilité de `pgvector` et de `pg_search` pour que tu le voies avant de t'engager. La base de connaissances externe doit déjà exister (elle peut porter n'importe quel nom que tu saisis — `tale_knowledge` par convention) avec les schémas `private_knowledge` et `public_web` ; les migrations de schéma de base vivent dans [`services/db/migrations/`](https://github.com/tale-project/tale/tree/main/services/db/migrations) et sont appliquées via dbmate quand la base démarre.

## Bases de connaissances par organisation

Les banques ci-dessus sont au niveau du déploiement — chaque organisation les partage. Une organisation seule peut au contraire pointer **son propre** corpus de connaissances vers un Postgres que tu provisionnes pour elle, pendant que toutes les autres orgs gardent le `knowledge-db` fourni. Réserve cela aux cas où le contenu documentaire et web-crawlé d'un locataire doit résider sur une infrastructure isolée du reste — une exigence de résidence plus stricte que ce que le défaut du déploiement satisfait.

L'intégralité du corpus de connaissances de l'org se déplace — les deux schémas : `private_knowledge` (métadonnées des documents, texte des fragments, embeddings et cache sémantique) et `public_web` (les pages de sites web du crawler, leur texte de fragments et les embeddings). Rien dans la base de connaissances d'une organisation n'est partagé avec une autre organisation.

La connexion vit dans le répertoire de configuration propre à l'organisation, pas dans le fichier de déploiement :

- `$TALE_CONFIG_DIR/<orgSlug>/knowledge/connection.json` — hôte, port, base, utilisateur et sslmode.
- `$TALE_CONFIG_DIR/<orgSlug>/knowledge/connection.secrets.json` — le mot de passe, chiffré avec SOPS dès qu'une clé age SOPS est configurée (voir [Secrets avec SOPS](/fr/self-hosted/configuration/secrets-with-sops)).
- `$TALE_CONFIG_DIR/<orgSlug>/knowledge/embedding.json` — le modèle d'embedding de l'organisation : fournisseur, identifiants stockés optionnels, tag du modèle, largeur des vecteurs et URL de base optionnelle compatible OpenAI.

Le même prérequis ParadeDB s'applique. L'org valide sa base candidate avec un test de connexion à l'échelle de l'organisation qui signale la disponibilité de `pgvector` et `pg_search` avant de basculer ; une cible avec seulement pgvector réduit la recherche de cette org au vectoriel seul. La base peut démarrer vide — Tale crée les schémas `private_knowledge` et `public_web` au premier accès, tu n'appliques donc jamais les migrations de base à la main.

Ce chemin retombe sans risque. Une organisation sans `connection.json` garde le `knowledge-db` par défaut du déploiement exactement comme avant, la fonctionnalité ne change donc rien pour les orgs qui n'y adhèrent pas. Deux organisations qui pointent vers la même base partagent un seul pool de connexions et — contrairement aux banques au niveau du déploiement — un changement par org ne demande aucun redémarrage de conteneur : la prochaine requête de cette org est routée vers sa propre base.

Un propriétaire ou un admin de l'organisation peut aussi gérer cette connexion depuis l'UI : les sections par organisation de **Paramètres > Résidence des données** lisent et écrivent exactement ces fichiers, avec le même test de connexion avant de basculer. Ces sections restent modifiables pour un propriétaire ou un admin d'org, que l'allowlist d'opérateurs les nomme ou non, parce que les fichiers qu'elles touchent appartiennent à l'organisation et non au déploiement. Les fichiers JSON sur le disque restent la source de vérité — un opérateur qui préfère les éditer à la main n'a besoin d'aucune étape UI.

### Le modèle d'embedding de l'organisation

La recherche de connaissances demande un réglage de plus par organisation avant de pouvoir tourner : le **modèle d'embedding** — quel fournisseur et quel modèle transforment documents et requêtes en vecteurs, et à quelle largeur exacte. Sans lui, l'indexation et la recherche refusent avec une erreur actionnable plutôt que de deviner un modèle. Règle-le dans la section **Modèle d'embedding** de **Paramètres > Résidence des données** (ou écris `embedding.json` à la main) : choisis un fournisseur pour lequel des identifiants sont stockés, nomme le tag du modèle comme le fournisseur l'écrit, et déclare la largeur que produit le modèle — elle n'est jamais déduite du nom du modèle, parce qu'une mauvaise supposition écrit des vecteurs que la recherche ne peut silencieusement plus exploiter.

La largeur est fixée **par base de données** à l'écriture du premier vecteur. Sur le `knowledge-db` partagé du déploiement, toutes les organisations doivent donc s'accorder sur une largeur ; une organisation qui veut un autre modèle d'embedding à une autre largeur est exactement le cas de la base de connaissances dédiée ci-dessus.

## Stockage d'objets par organisation

Le même schéma par organisation couvre les fichiers téléversés. Une organisation seule peut pointer **ses propres** blobs de fichiers — documents du Knowledge Hub, pièces jointes de chat, audio et médias générés — vers un bucket compatible S3 que tu provisionnes pour elle (AWS S3, MinIO, Cloudflare R2, …), pendant que toutes les autres orgs gardent le défaut du déploiement. Le bucket est dédié à cette organisation ; rien de ce qu'il contient n'est partagé avec une autre.

La connexion vit à côté de celle des connaissances, dans le répertoire de configuration de l'organisation :

- `$TALE_CONFIG_DIR/<orgSlug>/object-storage/connection.json` — région, endpoint optionnel (pour MinIO/R2), indicateur path-style, bucket et un préfixe de clé optionnel.
- `$TALE_CONFIG_DIR/<orgSlug>/object-storage/connection.secrets.json` — la paire de clés d'accès, chiffrée avec SOPS dès qu'une clé age SOPS est configurée (voir [Secrets avec SOPS](/fr/self-hosted/configuration/secrets-with-sops)).

Contrairement au basculement S3 au niveau du déploiement ci-dessus, ce chemin n'est **pas** réservé aux installations neuves : dès que la configuration existe, les nouveaux téléversements vont dans le bucket de l'org, tandis que les fichiers stockés avant restent lisibles là où ils sont — les références mixtes sont prises en charge, tu peux donc basculer à tout moment. Les fichiers stockés plus tôt restent dans le store d'objets du déploiement jusqu'à ce que tu les relocalises avec le backfill de blobs ci-dessous. Si tu supprimes la configuration, les nouveaux téléversements retournent au défaut du déploiement ; les fichiers déjà écrits dans le bucket y restent, mais Tale ne peut plus les lire tant que la connexion n'est pas rétablie. Aucun redémarrage n'est nécessaire, dans un sens comme dans l'autre.

Les admins d'org gèrent aussi cette connexion dans les mêmes sections par organisation de **Paramètres > Résidence des données** ; son test de connexion effectue un aller-retour réel écriture-lecture-suppression contre le bucket avant que tu t'engages. Comme pour la connexion des connaissances, les fichiers JSON restent la source de vérité.

> **Autorise l'origine de l'app dans la politique CORS du bucket.** Les téléversements et les téléchargements passent directement du navigateur au bucket via des URL présignées : le bucket doit donc accepter les requêtes cross-origin depuis l'URL de ton déploiement — autorise cette origine avec les méthodes `GET`, `PUT` et `HEAD` et tous les en-têtes de requête (Cloudflare R2 : **Settings > CORS Policy** du bucket ; AWS S3 et MinIO : la configuration CORS du bucket). Le test de connexion dans l'app s'exécute côté serveur, pas dans le navigateur — une politique CORS manquante ne se montre donc que plus tard, sous la forme d'un téléversement échoué.

### Déplacer les fichiers pré-existants dans le bucket

Connecter le bucket ne réachemine que les **nouveaux** téléversements ; les blobs écrits avant la connexion restent dans le store d'objets par défaut du déploiement et continuent de fonctionner via les références mixtes ci-dessus. Pour amener aussi cet historique sur ta propre infrastructure — tout l'intérêt de la résidence des données — lance le **backfill de blobs** : il copie chaque blob pré-existant dans le bucket de l'org, vérifie qu'il revient identique octet pour octet, réécrit chaque ligne qui le référence et supprime la copie source.

Un admin d'org le lance depuis l'UI : une fois la connexion au bucket enregistrée, la section Stockage d'objets de **Paramètres > Résidence des données** affiche **Déplacer les fichiers existants** — confirme, et le déplacement tourne en arrière-plan pendant que les téléversements continuent ; une ligne de statut dans la même section rapporte la progression et l'issue du dernier lancement.

Le backfill est **idempotent** et **limité à l'org** : il ne déplace que les blobs de cette organisation, saute tout ce qui est déjà dans le bucket, et laisse chaque source en place tant que sa copie n'est pas vérifiée — un nouveau lancement après une interruption reprend donc sans risque. Il exige que la connexion au bucket soit déjà configurée. Ce n'est délibérément **pas** une migration de framework versionnée — il tourne à la demande, par organisation, quand tu choisis de relocaliser l'historique d'un locataire, pas à une frontière de version.

## Stockage de fichiers sur S3

Le stockage de fichiers externe utilise un seul bucket compatible S3 — un nom de bucket, une région, des identifiants et (pour MinIO ou Cloudflare R2) un endpoint avec l'adressage path-style activé. Ils correspondent aux variables `OBJECT_STORE_*` dans la [Référence d'environnement](/fr/self-hosted/configuration/environment-reference).

> **Greenfield uniquement.** Faire passer le stockage de fichiers au niveau du déploiement du store fourni à un bucket externe ne migre **pas** les blobs déjà sur le volume local — le backend les cherche dans le bucket et ne les trouve pas. Définis S3 au déploiement initial, ou copie le stockage local existant dans le bucket hors bande avant de basculer.

## Comment la configuration est stockée

Enregistrer écrit deux fichiers à la racine de configuration (pas sous un répertoire d'org) :

- `deployment.json` — la configuration non secrète (hôtes, ports, buckets, modes).
- `deployment.secrets.json` — les mots de passe de base de données et les clés S3, chiffrés avec SOPS (voir [Secrets avec SOPS](/fr/self-hosted/configuration/secrets-with-sops)).

Au démarrage, le backend les lit et en dérive ses connexions avant de démarrer. L'ingestion et la récupération de connaissances tournent dans le backend worker, c'est donc le backend qui ouvre la connexion à la base de connaissances — il n'y a pas de service de récupération séparé à configurer. Le contrat est **fail-closed** : un `deployment.json` présent mais impossible à parser, un secret indéchiffrable ou une configuration sans champs requis **interrompt le démarrage** au lieu de retomber silencieusement sur la base fournie — mal router des données réglementées est pire que ne pas démarrer. Un fichier absent est le chemin par défaut normal.

## Appliquer un changement : redémarrage

La configuration est lue au démarrage, donc un enregistrement ne prend effet qu'au redémarrage des conteneurs backend (`backend-api` et `backend-worker`). Lance `docker compose restart backend-api backend-worker`, ou `tale deploy` pour un roulement blue-green sans interruption — la page de réglages montre les mêmes commandes après un enregistrement.

La variable d'environnement pertinente est `TALE_DEPLOYMENT_CONFIG_ADMINS` (l'allowlist de courriels, séparés par des virgules, des opérateurs autorisés à modifier). Définis-la dans `.env`. Voir aussi [Référence des variables d'environnement](/fr/self-hosted/configuration/environment-reference) et [Secrets avec SOPS](/fr/self-hosted/configuration/secrets-with-sops).
