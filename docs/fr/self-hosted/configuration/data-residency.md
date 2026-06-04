---
title: Résidence des données
description: Pointe la base de connaissances, la base de données applicative et le stockage des fichiers téléversés d'une installation Tale auto-hébergée vers une infrastructure que tu contrôles — configuré par les administrateurs dans Paramètres > Résidence des données et appliqué au redémarrage.
---

Une installation Tale auto-hébergée tourne sur une infrastructure que tu contrôles déjà, donc ses données vivent sur tes hôtes par défaut. La **résidence des données** sert au cas où tu veux pointer des banques de données précises vers ton propre Postgres géré ou ton stockage objet plutôt que vers les conteneurs fournis — par exemple pour garder le texte des documents dans une base que ton équipe exploite, ou les fichiers téléversés dans ton propre bucket S3. Les administrateurs configurent cela dans **Paramètres > Résidence des données** ; le changement est écrit dans un seul fichier de configuration au niveau du déploiement et **prend effet au redémarrage des conteneurs concernés**.

Cette page couvre ce qui peut être déplacé, le seul prérequis qui mord (ParadeDB), comment la configuration est stockée et appliquée, et comment redémarrer sans risque.

## Activer la modification

Voir la page est ouvert à tout owner ou admin d'une organisation, mais **modifier** — repointer une banque de données, enregistrer des secrets, lancer un test de connexion ou appliquer un redémarrage — est réservé à une allowlist nommée d'opérateurs. Liste leurs courriels de connexion (séparés par des virgules) dans `.env` et redémarre :

```bash
TALE_DEPLOYMENT_CONFIG_ADMINS=alice@example.com,bob@example.com
```

Si l'allowlist est vide ou non définie, **Paramètres > Résidence des données** montre toujours la configuration actuelle aux administrateurs, mais en lecture seule — Enregistrer, Tester et Appliquer & redémarrer refusent pour tout le monde. Seul un admin connecté dont le courriel figure sur la liste obtient une page modifiable ; la page t'indique quel courriel ajouter. Les entrypoints consomment le fichier de configuration quelle que soit l'allowlist, donc un opérateur qui préfère éditer le fichier à la main sur le disque peut le faire sans nommer d'éditeurs UI.

## Ce que tu peux relocaliser

Trois banques de données, chacune indépendante et optionnelle. Un réglage absent signifie « utilise le défaut fourni » — une installation neuve sans configuration reste donc inchangée.

- **Base de connaissances** — la banque RAG : métadonnées des documents, texte des fragments extraits, embeddings, index BM25 et cache sémantique. C'est la banque qui compte le plus pour les exigences de résidence, car elle détient le contenu de tes documents.
- **Stockage de fichiers** — où vivent les fichiers téléversés (les blobs d'origine). Par défaut ils résident sur le volume Convex local ; tu peux les pointer vers un bucket externe compatible S3.
- **Base de données applicative** (avancé) — la base de métadonnées Convex. Le backend Convex déduit le nom de cette base de `INSTANCE_NAME` (`tale_platform`) et se connecte uniquement via hôte:port, donc le Postgres externe doit contenir une base nommée exactement `tale_platform`. Son mode TLS est fixé par le pilote Convex et n'est pas configurable.

> Note : relocaliser la base de connaissances déplace le texte extrait et les embeddings. Les fichiers téléversés d'origine ne suivent que si tu relocalises aussi le **stockage de fichiers** vers S3.

## Le prérequis ParadeDB

La base de connaissances utilise deux extensions Postgres : `vector` (pgvector) pour les embeddings et `pg_search` (ParadeDB) pour la recherche hybride plein texte/BM25. Un Postgres de connaissances externe **doit faire tourner ParadeDB** (qui regroupe les deux) pour une qualité de recherche complète. Si tu le pointes vers un Postgres simple qui n'a que `pgvector`, l'indexation et la recherche vectorielle fonctionnent toujours, mais la recherche hybride se réduit à du **vectoriel seul** — la moitié BM25 est silencieusement sautée. Le bouton **Tester la connexion** signale la disponibilité de `pgvector` et de `pg_search` pour que tu le voies avant de t'engager. La base de connaissances externe doit déjà exister (elle peut porter n'importe quel nom que tu saisis — `tale_knowledge` par convention) ; le service RAG exécute ses migrations contre elle au démarrage.

## Stockage de fichiers sur S3

Le stockage de fichiers externe est tout-ou-rien à travers les cas d'usage de stockage de Convex, donc tu fournis **cinq buckets** — files, exports, snapshot-imports, modules et search — plus une région et des identifiants. Pour les services compatibles S3 (MinIO, Cloudflare R2), définis l'endpoint et active l'adressage path-style.

> **Greenfield uniquement.** Faire passer le stockage de fichiers de local à S3 ne migre **pas** les blobs déjà sur le volume local — Convex les cherche dans le bucket et ne les trouve pas. Définis S3 au déploiement initial, ou copie le stockage local existant dans le bucket hors bande avant de basculer.

## Comment la configuration est stockée

Enregistrer écrit deux fichiers à la racine de configuration (pas sous un répertoire d'org) :

- `deployment.json` — la configuration non secrète (hôtes, ports, buckets, modes).
- `deployment.secrets.json` — les mots de passe de base de données et les clés S3, chiffrés avec SOPS (voir [Secrets avec SOPS](/fr/self-hosted/configuration/secrets-with-sops)).

Au démarrage, les entrypoints `rag` et `convex` les lisent et en dérivent leurs connexions avant de démarrer. Le contrat est **fail-closed** : un `deployment.json` présent mais impossible à parser, un secret indéchiffrable ou une configuration sans champs requis **interrompt le démarrage** au lieu de retomber silencieusement sur la base fournie — mal router des données réglementées est pire que ne pas démarrer. Un fichier absent est le chemin par défaut normal.

## Appliquer un changement : redémarrage

La configuration est lue au démarrage, donc un enregistrement ne prend effet qu'au redémarrage des conteneurs **`rag` et `convex`** (la plateforme elle-même n'a pas besoin de redémarrer). Deux façons :

- **Manuel** — `docker compose restart rag convex`, ou `tale deploy --services rag` pour un roulement blue-green sans interruption.
- **Un clic** — active le service `controller` à activer explicitement (`docker compose --profile controller up -d`). C'est un petit sidecar uniquement interne qui redémarre les deux services autorisés sur une requête signée par HMAC venant de l'app, pour que la plateforme exposée au navigateur n'ait jamais besoin d'accéder au socket Docker. Quand il tourne, le bouton **Appliquer & redémarrer** fait le redémarrage pour toi ; définis `CONTROLLER_TOKEN` (partagé avec la plateforme) et `CONTROLLER_URL` dans `.env`. Sans lui, le bouton montre la commande manuelle.

Les variables d'environnement pertinentes sont `TALE_DEPLOYMENT_CONFIG_ADMINS` (l'allowlist de courriels, séparés par des virgules, des opérateurs autorisés à modifier) et — seulement avec le `controller` en un clic — `CONTROLLER_TOKEN` (le secret HMAC partagé) et `CONTROLLER_URL` (p. ex. `http://controller:8004`). Définis-les dans `.env`. Voir aussi [Référence des variables d'environnement](/fr/self-hosted/configuration/environment-reference) et [Secrets avec SOPS](/fr/self-hosted/configuration/secrets-with-sops).
