---
title: Architecture auto-hébergée
description: Onze conteneurs dans un fichier compose, dont deux bases Postgres et un blob store compatible S3. Cette page donne le modèle mental pour savoir ce que fait chaque conteneur, où vivent les données sur le disque et quels secrets comptent au premier boot.
---

Une instance Tale, ce sont onze conteneurs derrière un proxy Caddy, parlant à deux bases Postgres — une opérationnelle, une pour le corpus de connaissances — et à un blob store compatible S3 ; deux d'entre eux sont des conteneurs sandbox sur le côté pour l'exécution de code. Le fichier compose est le contrat — ce qui tourne, ce qui est exposé, ce qui est monté. Cette page te donne le modèle mental pour que les pages installation, configuration et exploitation n'aient pas à le réexpliquer.

Lis ceci avant de `docker compose up`. Reviens-y quand tu débogues un incident et que tu dois savoir quel log de conteneur ouvrir en premier.

## Les onze conteneurs

**tale-proxy** est Caddy en bordure. Il termine TLS, sert le HTML et les assets statiques depuis le conteneur plateforme, et route tout ce qui est sous `/api/` — plus `/events`, `/dav` et l'API machine — vers le backend. Il publie aussi le chemin du bucket du blob store pour que les URL présignées d'upload et de download marchent dans le navigateur. Les healthchecks vivent ici.

**tale-platform** est le serveur React + TanStack Start. Il rend l'UI, sert les assets statiques et termine le socket de screencast de la vue navigateur en direct. Il ne porte pas d'état métier et n'atteint aucune base — tout ce qui persiste passe par le backend.

**backend-api** est le backend applicatif : un processus Node qui fait tourner une app Hono servant chaque porte dont l'UI et l'API machine ont besoin — connexion, API d'app, WebDAV, le flux de mises à jour en direct. Clés de fournisseur, définitions d'agent, exécutions de workflow et journaux d'audit vivent derrière. La *recherche* de connaissances tourne dans ce processus et interroge directement la base du corpus, pas via un service de récupération séparé.

**backend-worker** est la même image dans le rôle worker. Il fait tourner les jobs de fond — ingestion et embedding de documents, crawl web, runs d'automation, sweeps de rétention — depuis une file pg-boss qui vit dans la base applicative, si bien qu'un job se commit dans la même transaction que l'écriture qui l'a planifié. Le travail headless dont certains de ces jobs ont besoin (rendre une page web, transformer du HTML en PDF ou en image) est délégué au runtime sandbox, qui embarque déjà Chromium et Playwright. Le worker ne sert aucun HTTP.

**tale-db** est le Postgres opérationnel (ParadeDB). Il porte la base `tale_app` — agents, runs, sessions, le log d'audit et la file de jobs — et le backend y applique ses migrations de schéma au boot, sous un advisory lock, pour qu'un déploiement roulant migre exactement une fois.

**tale-object-store** est le blob store : une instance MinIO compatible S3 qui contient chaque document téléversé, chaque pièce jointe de chat, chaque fichier audio et chaque média généré. Le stockage compatible S3 est le seul backend de blobs, donc un déploiement sans lui refuse chaque upload. Il est interne seulement ; le backend signe des URL présignées et le proxy les relaie.

**tale-knowledge-db** est le Postgres du corpus de connaissances (ParadeDB), la base `tale_knowledge` avec deux schémas : `private_knowledge` (fragments de documents téléversés, embeddings, index BM25, cache sémantique) et `public_web` (pages web crawlées). Le fait qu'il reste adressable par sa propre chaîne de connexion est précisément ce qui permet de relocaliser ou de remplacer le corpus — la banque sensible à la résidence des données — tout seul. Sur un stack `tale deploy` mono-hôte, il est replié dans `tale-db`, qui porte l'alias réseau `knowledge-db` pour que la chaîne de connexion résolve dans les deux cas.

**tale-sandbox-llm-gateway** est la gateway LLM pour les tours sur harness. C'est le seul chemin d'un harness en sandbox vers un fournisseur de modèles ; la plateforme le provisionne et frappe des clés par session.

**bgutil-provider** est un utilitaire tiers pour l'ingestion des liens vidéo : il émet les jetons que YouTube exige avant qu'une transcription puisse être récupérée. C'est la seule image du stack que Tale ne construit pas, elle n'est joignable qu'en interne, et un déploiement qui n'ingère jamais de liens vidéo peut l'arrêter sans rien casser.

**tale-sandbox** et **tale-sandbox-egress** exécutent du code en sandbox pour le compte de l'outil **Exécuter du code** et des scripts de compétence, et servent de runtime de navigateur headless que le backend appelle pour le rendu web et la génération de documents. Le conteneur egress est le seul chemin que la sandbox a vers le réseau. L'egress est ouvert par défaut — le code en sandbox atteint n'importe quel hôte public en HTTPS, tandis que les métadonnées cloud et les plages d'adresses privées restent bloquées au niveau IP ; restreins-le à une allowlist d'hôtes avec `SANDBOX_EGRESS_ALLOWLIST`, décrite dans [Durcissement](/fr/self-hosted/operate/security/hardening).

## Données sur le disque

Cinq volumes survivent à un `docker compose down` :

- `db-data` — le répertoire de données du Postgres opérationnel : la base derrière les agents, les runs, les sessions, le log d'audit et la file de jobs.
- `knowledge-db-data` — le répertoire de données du Postgres du corpus de connaissances : fragments de documents, embeddings, index de recherche et pages web crawlées. Distinct de `db-data` parce que c'est une base distincte, et absent sur un stack qui a replié le corpus dans `tale-db`.
- `object-store-data` — le blob store : chaque document téléversé, chaque pièce jointe de chat, chaque fichier audio et chaque média généré.
- `convex-data` — l'arbre de config d'org : agents, automations, connecteurs, fournisseurs, skills, policies de gouvernance, connexions SSO, branding. Le nom est historique et délibérément inchangé, pour que la mise hors service du backend Convex n'ait forcé aucun opérateur à migrer un volume juste pour un renommage.
- `backups` — snapshots de volumes checksummés, écrits par `tale backup` et automatiquement avant les déploiements migrants ; [Backups et restauration](/fr/self-hosted/operate/backups-and-restore) est le drill.

`object-store-data` est celui à remarquer : un snapshot `tale backup` ne l'inclut **pas**, donc les fichiers téléversés ont besoin de leur propre place dans ton job de backup. Tout le reste est éphémère. Les conteneurs peuvent être remplacés sans perte de données tant que les volumes survivent.

## Secrets de fournisseur et couche SOPS

Les secrets des fichiers de config — les sidecars de secrets des fournisseurs, les mots de passe des connexions au corpus et au stockage objet, les secrets de la config de déploiement elle-même — vivent sur le disque dans l'arbre de config d'org, chiffrés avec SOPS et la variable [`SOPS_AGE_KEY`](/fr/self-hosted/configuration/environment-reference). Les conteneurs backend montent cet arbre en lecture-écriture et sont les seuls processus à détenir la clé age ; la couche web monte le même volume en lecture seule pour les images de branding et ne déchiffre jamais rien.

Cette séparation existe pour deux raisons. Faire tourner un secret, c'est éditer un fichier, pas redémarrer la plateforme ; sauvegarder le fichier chiffré est sûr à committer aux côtés de l'infrastructure. Le mode clair (pas de SOPS, secrets en clair) est supporté pour des environnements étroitement contrôlés où le disque lui-même est chiffré au repos.

## Auth et sessions

Le sign-in est Better Auth tournant dans le backend. Quatre modes de sign-in sont fournis : mot de passe local, Microsoft Entra (OAuth/OIDC), OIDC générique et trusted headers (le reverse proxy fournit l'identité). Le proxy envoie tout ce qui est sous `/api/auth/` directement à `backend-api`, donc la couche web n'est pas du tout sur le chemin de connexion : le navigateur porte un cookie de session, le backend le résout à chaque requête, et le backend décide de ce que la session peut faire d'après le rôle de l'utilisateur et la matrice de permissions par ressource documentée dans [Membres et rôles](/fr/platform/admin/members-and-roles). Les sessions vivent dans Postgres, et c'est pourquoi redémarrer un conteneur backend ne déconnecte personne.

La [référence d'authentification](/fr/self-hosted/configuration/authentication) couvre les variables d'environnement et les arbitrages par mode.

## Quand tu sors du single-host

Le fichier compose par défaut fait tourner les onze conteneurs sur un hôte. La première chose que tu peux sortir de la boîte sans réarchitecturer, c'est le corpus de connaissances — il est adressé par sa propre chaîne de connexion, donc le pointer vers une infrastructure gérée (pour la capacité ou pour une exigence de résidence) est un changement de `KNOWLEDGE_DATABASE_URL`, couvert dans [Résidence des données](/fr/self-hosted/configuration/data-residency). Le blob store se déplace de la même façon : tu repointes la connexion de stockage objet du déploiement vers un bucket qui t'appartient.

La couche backend scale horizontalement plutôt que verticalement. `backend-api` et `backend-worker` prennent tous deux `--scale` : chaque conteneur api interroge l'outbox d'indices et diffuse les mises à jour à ses propres clients, donc il n'y a aucune coordination entre conteneurs et aucune sticky session à arranger, et chaque worker se dispute la même file pg-boss. Ce qui reste unique, c'est Postgres — un primaire, et le blob store à côté.

## Où cela s'inscrit

Cette page d'architecture est la carte que présuppose chaque autre page auto-hébergée. La lecture suivante naturelle est [Quickstart](/fr/self-hosted/install/quickstart) si tu montes une instance neuve, ou [Architecture des conteneurs](/fr/self-hosted/operate/container-architecture) si tu en exploites une et que tu veux la même image superposée aux modes de défaillance.
