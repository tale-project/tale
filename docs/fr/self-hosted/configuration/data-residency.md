---
title: Résidence des données
description: Pointe la base de connaissances, la base de données applicative et le stockage des fichiers téléversés d'une installation Tale auto-hébergée vers une infrastructure que tu contrôles — configuré par les administrateurs dans Paramètres > Résidence des données et appliqué au redémarrage.
---

Une installation Tale auto-hébergée tourne sur une infrastructure que tu contrôles déjà, donc ses données vivent sur tes hôtes par défaut. La **résidence des données** sert au cas où tu veux pointer des banques de données précises vers ton propre Postgres géré ou ton stockage objet plutôt que vers les conteneurs fournis — par exemple pour garder le texte des documents dans une base que ton équipe exploite, ou les fichiers téléversés dans ton propre bucket S3. Le corpus de connaissances est une base à part, adressée par sa propre chaîne de connexion, précisément pour pouvoir être relocalisé ou remplacé indépendamment de la base opérationnelle — c'est la banque qui compte le plus pour la majorité des exigences de résidence.

Deux mécanismes se cachent derrière. Une banque **à l'échelle du déploiement** se repointe sur l'hôte, dans `.env` et l'arbre de config, et prend effet au redémarrage des conteneurs backend. Une banque **propre à une organisation** se configure par un owner ou un admin de l'organisation dans **Paramètres > Résidence des données**, atterrit dans le répertoire de config de cette organisation, et prend effet à la requête suivante. Cette page couvre les deux, le seul prérequis qui mord (ParadeDB), comment la configuration est stockée, et comment redémarrer sans risque.

## Activer la modification

**Paramètres > Résidence des données** est une seule page avec deux familles de sections : les banques à l'échelle du déploiement que toutes les organisations partagent, et celles qu'une organisation apporte pour elle seule. Chaque section s'affiche en lecture seule ou modifiable selon ce que la personne qui la lit a le droit de changer, et la page nomme l'état dans lequel tu te trouves. Voir la page est ouvert à tout owner ou admin d'une organisation ; **modifier les banques du déploiement** — repointer une banque de données, enregistrer des secrets, lancer un test de connexion — est réservé à une allowlist nommée d'opérateurs. Liste leurs courriels de connexion (séparés par des virgules) dans `.env` et redémarre :

```bash
TALE_DEPLOYMENT_CONFIG_ADMINS=alice@example.com,bob@example.com
```

Si l'allowlist est vide ou non définie, les sections de déploiement montrent toujours la configuration actuelle aux administrateurs, mais en lecture seule — l'action d'en-tête **Enregistrer le déploiement** n'apparaît que pour les opérateurs de l'allowlist. Seul un admin connecté dont le courriel figure sur la liste rend ces sections modifiables ; la page t'indique quel courriel ajouter. Il n'y a pas de bouton de redémarrage : un enregistrement affiche les deux commandes qui l'appliquent, et la section plus bas les répète. Un opérateur qui préfère travailler sur l'hôte saute l'allowlist entièrement et édite `.env` et les fichiers de config directement.

## Ce que tu peux relocaliser

Trois banques de données, chacune indépendante et optionnelle. Un réglage absent signifie « utilise le défaut fourni » — une installation neuve sans configuration reste donc inchangée.

<Warning>

**Enregistrer les sections à l'échelle du déploiement ne repointe aucune banque.** Le backend ouvre la base applicative depuis `DATABASE_URL`, le corpus de connaissances depuis `KNOWLEDGE_DATABASE_URL`, et le blob store depuis le `object-storage/connection.json` de l'arbre de config `default`. Rien ne lit au démarrage le bloc `dataStores` que ces sections écrivent dans `deployment.yml`. Relocalise une banque à l'échelle du déploiement avec la variable d'environnement ou le fichier nommé sous elle ci-dessous, et lis les sections de déploiement comme une note de la topologie visée plutôt que comme l'interrupteur qui l'applique. Les sections **propres à une organisation**, plus bas, sont un mécanisme différent et prennent bien effet.

</Warning>

- **Base de connaissances** — le corpus de connaissances : métadonnées des documents, texte des fragments extraits, embeddings, index BM25, cache sémantique et pages web crawlées. Elle est livrée comme la base `tale_knowledge`, avec les schémas `private_knowledge` et `public_web`, joignable à l'hôte `knowledge-db`, et c'est la banque qui compte le plus pour les exigences de résidence, car elle détient le contenu de tes documents. Pointe-la vers ton propre Postgres géré avec `KNOWLEDGE_DATABASE_URL` dans `.env` pour garder le corpus sur une infrastructure que ton équipe exploite.
- **Stockage de fichiers** — où vivent les fichiers téléversés (les blobs d'origine). Par défaut ils résident dans le magasin d'objets fourni avec la pile (le service `object-store`, sur son propre volume). Pointe-les vers un bucket externe compatible S3 en éditant `$TALE_CONFIG_DIR/default/object-storage/connection.json` et son sidecar `connection.secrets.json` ; le backend seede ce fichier contre le store fourni au premier démarrage et n'écrase jamais celui qui existe.
- **Base de données applicative** (avancé) — la banque opérationnelle : chats, tâches, runs d'automation, l'audit log, la file de jobs. Elle est livrée comme la base `tale_app` sur le conteneur `db` fourni, et le backend l'atteint par une seule chaîne de connexion, `DATABASE_URL`. Pointe-la vers ton propre Postgres géré pour la relocaliser ; le backend applique ses migrations de schéma à ce qu'il y trouve, au démarrage, sous un advisory lock.

> Note : la base de connaissances et la base de données applicative sont deux bases séparées — déplacer l'une ne touche pas l'autre. Sur un stack `tale deploy` mono-hôte elles partagent un conteneur Postgres, donc une exigence de résidence qui les sépare est une raison de relocaliser au moins l'une des deux. Relocaliser la base de connaissances déplace le texte extrait et les embeddings ; les fichiers téléversés d'origine ne suivent que si tu relocalises aussi le **stockage de fichiers**.

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

Ce chemin n'est **pas** réservé aux installations neuves : dès que la configuration existe, les nouveaux téléversements vont dans le bucket de l'org, tandis que les fichiers stockés avant restent lisibles dans le store par défaut du déploiement — tu peux donc basculer à tout moment et relocaliser les fichiers plus anciens ensuite avec le backfill de blobs ci-dessous. Si tu supprimes la configuration, les nouveaux téléversements retournent au défaut du déploiement ; les fichiers déjà écrits dans le bucket y restent, mais Tale ne peut plus les lire tant que la connexion n'est pas rétablie. Aucun redémarrage n'est nécessaire, dans un sens comme dans l'autre : le resolver met une connexion en cache quinze secondes, donc un changement est live presque immédiatement.

Les admins d'org gèrent aussi cette connexion dans les mêmes sections par organisation de **Paramètres > Résidence des données** ; son test de connexion effectue un aller-retour réel écriture-lecture-suppression contre le bucket avant que tu t'engages. Comme pour la connexion des connaissances, les fichiers JSON restent la source de vérité.

> **Autorise l'origine de l'app dans la politique CORS du bucket.** Les téléversements et les téléchargements passent directement du navigateur au bucket via des URL présignées : le bucket doit donc accepter les requêtes cross-origin depuis l'URL de ton déploiement — autorise cette origine avec les méthodes `GET`, `PUT` et `HEAD` et tous les en-têtes de requête (Cloudflare R2 : **Settings > CORS Policy** du bucket ; AWS S3 et MinIO : la configuration CORS du bucket). Le test de connexion dans l'app s'exécute côté serveur, pas dans le navigateur — une politique CORS manquante ne se montre donc que plus tard, sous la forme d'un téléversement échoué.

### Déplacer les fichiers pré-existants dans le bucket

Connecter le bucket ne réachemine que les **nouveaux** téléversements ; les blobs écrits avant la connexion restent dans le store par défaut du déploiement et continuent de fonctionner, parce qu'une référence stockée nomme la clé de l'objet et que c'est le resolver qui décide de quel store il la lit. Pour amener aussi cet historique sur ta propre infrastructure — tout l'intérêt de la résidence des données — lance le **backfill de blobs** : il parcourt les documents de l'organisation (les fichiers courants et chaque version de leur historique) et ses métadonnées de fichiers, et copie chaque objet depuis le store par défaut du déploiement vers le bucket de l'org, sous la même clé.

Un admin d'org le lance depuis l'UI : une fois la connexion au bucket enregistrée, la section Stockage d'objets de **Paramètres > Résidence des données** affiche **Déplacer les fichiers existants** — confirme, et le déplacement tourne comme job de fond pendant que les téléversements continuent ; une ligne de statut dans la même section rapporte la progression et l'issue du dernier lancement.

Deux propriétés le rendent sûr à relancer. Les clés ne changent jamais, donc aucune ligne n'est réécrite et aucune référence ne peut rancir en cours de route : un objet passe d'une lecture dans le store par défaut à une lecture dans le bucket à l'instant où sa copie atterrit. Et tout objet déjà présent dans le bucket est sauté, donc un lancement interrompu reprend au lieu de recopier. Le lancement est limité à l'org, et il exige que la connexion au bucket soit déjà enregistrée.

Ce qu'il ne fait pas, c'est supprimer. L'objet source reste dans le store par défaut du déploiement, donc un backfill relocalise une copie plutôt que de déplacer les octets — prévois une passe de nettoyage séparée si l'exigence de résidence est que l'ancienne copie cesse d'exister. Ce n'est délibérément **pas** une migration de framework versionnée : il tourne à la demande, par organisation, quand tu choisis de relocaliser l'historique d'un locataire, pas à une frontière de version.

## Comment la configuration est stockée

Enregistrer les sections de déploiement écrit deux fichiers à la racine de configuration (pas sous un répertoire d'org) :

- `deployment.yml` — la configuration non secrète (hôtes, ports, buckets, modes). Un déploiement qui porte encore le `deployment.json` retiré est lu tel quel et converti au prochain enregistrement.
- `deployment.secrets.json` — les mots de passe de base de données et les clés S3, chiffrés avec SOPS (voir [Secrets avec SOPS](/fr/self-hosted/configuration/secrets-with-sops)).

Les sections propres à une organisation écrivent dans le répertoire de cette organisation à la place, aux chemins listés plus haut. Ce sont ces fichiers dont le backend résout réellement une connexion, et la lecture est **fail-closed** : une config d'org présente mais impossible à parser, ou dont le secret refuse de se déchiffrer, refuse les lectures de cette organisation au lieu de retomber silencieusement sur la banque fournie — mal router des données réglementées est pire qu'échouer bruyamment. Un fichier absent est le chemin par défaut normal.

## Appliquer un changement : redémarrage

Une connexion à l'échelle du déploiement est lue au démarrage, donc un changement dans `.env` ou dans l'arbre de config `default` ne prend effet qu'au redémarrage des conteneurs backend (`backend-api` et `backend-worker`). Lance `docker compose restart backend-api backend-worker`, ou `tale deploy` pour un roulement blue-green sans interruption — la page de réglages montre les mêmes commandes après un enregistrement. Une connexion propre à une organisation ne demande aucun redémarrage.

La variable d'environnement pertinente est `TALE_DEPLOYMENT_CONFIG_ADMINS` (l'allowlist de courriels, séparés par des virgules, des opérateurs autorisés à modifier). Définis-la dans `.env`. Voir aussi [Référence des variables d'environnement](/fr/self-hosted/configuration/environment-reference) et [Secrets avec SOPS](/fr/self-hosted/configuration/secrets-with-sops).
