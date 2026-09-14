---
title: Choisir et déplacer les stockages
description: Distingue les stockages par défaut de ceux d’une organisation, configure les connexions et prépare la migration des données existantes.
---

Choisis le stockage de trois catégories : enregistrements applicatifs, connaissances recherchables et fichiers d’origine. Déplacer l’une ne déplace pas les autres. Le stockage ne détermine pas non plus où un fournisseur de modèles ou un connecteur traite une requête ; inclus ces destinations dans ton évaluation de résidence.

## Choisir la portée du changement

| Stockage | Paramètre du déploiement | Paramètre propre à une organisation |
| --- | --- | --- |
| Base applicative : utilisateurs, chats, exécutions et audit | `DATABASE_URL` | Aucun réglage de base applicative distincte sur cette page. |
| Base de connaissances : texte extrait, embeddings, index et contenu web | `KNOWLEDGE_DATABASE_URL` | **Paramètres > Résidence des données > Base de connaissances** |
| Fichiers d’origine : documents, pièces jointes, audio et médias générés | `OBJECT_STORE_*` | **Paramètres > Résidence des données > Stockage objet** |

Le stack fourni place `tale_app` et `tale_knowledge` dans un service Postgres tout en gardant deux bases distinctes. D’autres installations utilisent des services séparés. Les valeurs d’environnement générées choisissent les connexions par défaut ; un processus applicatif démarré seul ne crée pas des identifiants de stockage objet valides.

Les modifications d’organisation demandent les droits Admin ou Propriétaire. Sans connexion propre, Tale utilise le stockage par défaut et conserve l’isolation par organisation. Une connexion de connaissances configurée mais invalide échoue au lieu de basculer silencieusement vers une autre base.

## Préparer une base externe

Prépare base et identifiants avant de modifier Tale. La base applicative exige un rôle autorisé à appliquer ses migrations de schéma. La base de connaissances demande `vector` ; `pg_search` active la partie BM25 de la recherche hybride. Avec pgvector seul, la recherche vectorielle fonctionne sans cette composante par mots-clés. Tale crée schémas et tables de connaissances, mais n’installe pas d’extensions sur ta base.

Utilise une connexion Postgres directe ou compatible avec les sessions. Le pooling par transaction ne convient pas aux verrous de session, à `LISTEN` et aux requêtes préparées du stack. Pour `sslmode=verify-ca` ou `verify-full`, fournis les racines PEM requises via `POSTGRES_CA_FILE` et monte le fichier dans les rôles backend. Vérifie réseau et permissions depuis l’environnement de déploiement.

Avant la bascule, décide comment transférer les données applicatives ou connaissances existantes et prends des sauvegardes coordonnées. Enregistrer une connexion change seulement la destination des opérations suivantes ; cela ne copie pas les anciennes lignes et ne réindexe pas automatiquement les documents.

## Modifier les valeurs par défaut

Modifie `.env`, puis déploie ou recrée les services backend concernés. `docker compose restart` garde l’ancien environnement. Si tu déplaces les deux bases hors du service fourni, conserve son ancien volume jusqu’à l’acceptation des nouveaux stockages et du plan de reprise.

Pour le stockage objet par défaut, le backend synchronise `default/object-storage/connection.json` et son fichier de secrets depuis l’environnement au démarrage. Le résultat distingue `seeded`, `reconciled`, `skipped` si les identifiants manquent et `ignored` pour un fichier géré par l’opérateur. Avec `"managedBy": "operator"`, tu prends la responsabilité du fichier à la place de cette synchronisation.

Changer le bucket ou le point d’accès par défaut ne copie pas les objets existants. Transfère-les avec les outils du stockage en conservant clés et métadonnées nécessaires, puis coordonne la bascule avant de retirer l’ancien stockage. Bases et buckets externes ne sont pas couverts par les snapshots de volumes CLI. Mets à jour les procédures de [Sauvegardes et restauration](/fr/self-hosted/operate/backups-and-restore) lors du changement.

## Connecter la base de connaissances d’une organisation

1. Ouvre **Paramètres > Résidence des données** dans l’organisation cible et renseigne **Base de connaissances** : hôte, port, base, utilisateur, mode SSL et mot de passe.
2. Choisis **Tester la connexion**. Vérifie accès et extensions ; une connexion réussie ne prouve pas que l’ancien corpus a migré.
3. Enregistre lorsque la destination et le plan de transfert sont prêts. Les requêtes suivantes utilisent la connexion choisie sans redémarrage de conteneur.
4. Indexe un document contrôlé, cherche une expression connue et vérifie que les contenus antérieurs nécessaires restent disponibles.

Les fichiers se trouvent sous `$TALE_CONFIG_DIR/<orgSlug>/knowledge/` : `connection.json`, `connection.secrets.json` et `embedding.json`. Les secrets utilisent SOPS lorsqu’une clé age est configurée. Supprimer la connexion rétablit le routage par défaut ; les données externes restent en place, mais ne sont plus accessibles par la connexion retirée.

### Adapter le modèle d’embedding au corpus {#le-modele-dembedding-de-lorganisation}

Dans **Modèle d’embedding**, choisis fournisseur et identifiants enregistrés, saisis le tag exact du modèle et indique la largeur des vecteurs. Une URL de base facultative sélectionne un point d’accès compatible OpenAI. Sans modèle configuré, l’indexation et la recherche de connaissances ne peuvent pas fonctionner normalement.

La largeur est fixée par base à la première utilisation. Les organisations qui partagent cette base doivent utiliser la même largeur ; une autre largeur demande une base compatible séparée. Changer de modèle peut aussi rendre les anciens vecteurs incompatibles à largeur identique. Prévois une réindexation avec le modèle choisi au lieu de mélanger des embeddings sans vérification.

`embedding.json` accepte `minSimilarity`, le seuil du volet vectoriel de la recherche de l’assistant ; sa valeur par défaut est `0.45`. Le formulaire conserve ce réglage du fichier sans proposer de champ. Ajuste-le avec des requêtes représentatives. La recherche REST n’applique un seuil que si la requête en fournit un ; ce n’est pas une limite universelle pour toutes les recherches.

## Connecter le bucket d’une organisation

1. Prépare un bucket compatible S3 et les permissions objet nécessaires. Configure CORS pour les véritables origines du navigateur et les méthodes requises `GET`, `PUT` et `HEAD`.
2. Dans **Stockage objet**, saisis région, point d’accès si nécessaire, bucket, préfixe de clé facultatif et identifiants. Utilise l’adressage path-style si ton stockage le demande.
3. Lance **Tester la connexion**, puis enregistre. Le test serveur écrit, lit et supprime un objet de test ; il ne teste pas CORS dans le navigateur.
4. Envoie et télécharge un fichier contrôlé dans le navigateur avant de compter sur la nouvelle connexion.

Les nouveaux imports utilisent le bucket de l’organisation. Les anciens fichiers du stockage par défaut peuvent rester accessibles grâce aux références mixtes ; connecter le bucket ne suffit donc pas à relocaliser l’historique. La configuration réside dans `$TALE_CONFIG_DIR/<orgSlug>/object-storage/connection.json` et `connection.secrets.json`.

Supprimer la connexion envoie les nouveaux imports vers le stockage par défaut. Les objets existants restent dans le bucket de l’organisation ; Tale ne pourra les relire qu’après rétablissement de la connexion.

### Déplacer les fichiers existants

Après avoir enregistré le bucket, utilise **Déplacer les fichiers existants** dans la même section. Examine l’aperçu proposé, confirme le déplacement et suis sa progression. Garde la connexion stable jusqu’à la fin.

Le rattrapage parcourt les documents référencés et leur historique, fichiers importés, audio synthétisé et transcriptions vidéo de cette organisation. Il copie chaque objet avec son type de contenu, vérifie sa taille à destination, puis supprime la source. Les clés restent identiques et une copie déjà vérifiée peut être terminée après interruption. Il s’agit d’un déplacement, pas d’une sauvegarde supplémentaire ni d’un contrôle cryptographique du contenu.

La destination doit différer du stockage par défaut. En cas d’échec, examine dernière erreur et progression avant de lancer un autre passage. Conserve les deux stockages jusqu’à vérification du résultat et du téléchargement d’anciens fichiers représentatifs. [Secrets avec SOPS](/fr/self-hosted/configuration/secrets-with-sops) explique la protection des fichiers de connexion.
