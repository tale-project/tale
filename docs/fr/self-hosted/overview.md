---
title: Architecture auto-hébergée
description: Neuf conteneurs derrière un proxy Caddy, un Postgres, un stockage d'objets compatible S3. Cette page donne le modèle mental pour savoir ce que fait chaque conteneur, où vivent les données sur le disque et quels secrets comptent au premier boot.
---

Une instance Tale, ce sont neuf conteneurs derrière un proxy Caddy : le tier web, un backend applicatif à deux rôles, un Postgres, un stockage d'objets compatible S3, et le plan sandbox à trois conteneurs sur le côté pour l'exécution de code. Un petit sidecar `bgutil-provider` complète l'ensemble pour l'ingestion de liens vidéo. Le fichier compose est le contrat — ce qui tourne, ce qui est exposé, ce qui est monté. Cette page te donne le modèle mental pour que les pages installation, configuration et exploitation n'aient pas à le réexpliquer.

Lis ceci avant de déployer. Reviens-y quand tu débogues un incident et que tu dois savoir quel log de conteneur ouvrir en premier.

## Les conteneurs

**tale-proxy** est Caddy en bordure. Il termine TLS, sert la SPA et les routes propres à la plateforme depuis le conteneur plateforme, et transfère la surface applicative — tout sous `/api/` sauf `/api/health`, plus `/events` et la porte WebDAV — vers le backend. Les healthchecks vivent ici.

**tale-platform** est le tier web : une SPA Vite + TanStack Router avec le serveur Bun qui la sert. Il rend l'UI, sert les assets statiques et le branding, surveille le magasin de config pour les changements à chaud et possède quelques routes à lui (la sonde de santé, l'aperçu canvas/screencast, le repli WebDAV). C'est le seul conteneur auquel le navigateur parle directement, et il ne porte aucun état métier — tout ce qui persiste passe par le backend.

**tale-backend-api** est le backend applicatif dans le rôle `api` (`TALE_ROLE=api`) : chaque porte applicative — l'API de l'app, Better Auth, le flux SSE de hints, les portes machine et les ponts in-sandbox. Clés de fournisseur, définitions d'agent, exécutions d'automatisation et journaux d'audit passent tous par lui. C'est un singleton — les deux couleurs de plateforme pointent vers la même api — et il est aussi rattaché au réseau sandbox pour qu'un conteneur de session l'atteigne directement.

**tale-backend-worker** est la même image dans le rôle `worker` (`TALE_ROLE=worker`) : l'exécuteur de jobs derrière les schedules, les watchdogs et les tours d'agent. Il exécute aussi le travail de connaissances — ingestion de documents, crawling web, indexation RAG et génération de documents — comme des jobs en arrière-plan plutôt que comme des services séparés. Le travail headless dont ces jobs ont besoin (rendre une page web, transformer du HTML en PDF ou en image) est délégué au runtime sandbox, qui embarque déjà Chromium et Playwright. Le worker n'expose aucun HTTP et scale horizontalement (`--scale backend-worker=N`).

**tale-db** est le Postgres opérationnel (ParadeDB, avec `pg_search` + `pgvector`). Le stack single-host y replie deux bases : `tale_app` — le magasin applicatif derrière les agents, les runs et le log d'audit — et `tale_knowledge`, le corpus de connaissances avec deux schémas, `private_knowledge` (fragments de documents téléversés, embeddings, index BM25, cache sémantique) et `public_web` (pages web crawlées). Le service porte l'alias `knowledge-db` sur le réseau interne, si bien que le corpus se résout vers le même Postgres sans câblage supplémentaire. Le `compose.yml` de développement sépare plutôt le corpus dans un service `knowledge-db` dédié, pour qu'il puisse être relocalisé tout seul — voir [Résidence des données](/fr/self-hosted/configuration/data-residency).

**tale-object-store** est MinIO, le backend de blobs compatible S3. Documents téléversés, pièces jointes de chat, audio et médias générés vivent ici — c'est le seul backend de blobs, donc un déploiement qui ne l'atteint pas refuse le moindre téléversement. Il est purement interne : les blobs atteignent le navigateur via des URLs présignées que le backend signe et que le proxy transfère, jamais en exposant le magasin lui-même.

**tale-sandbox-llm-gateway** est la passerelle LLM pour les tours d'agent de code in-sandbox (harness). C'est le seul chemin d'un harness sandboxé vers un fournisseur de modèle ; le backend le provisionne et frappe des clés par session.

**tale-sandbox** et **tale-sandbox-egress** exécutent du code sandboxé pour le compte de l'outil `Run code` et des scripts de skill, et servent de runtime navigateur headless que le backend appelle pour le rendu web et la génération de documents. Le conteneur egress est le seul chemin de la sandbox vers le réseau. L'egress est ouvert par défaut — le code sandboxé atteint n'importe quel hôte public en HTTPS tandis que les cibles cloud-metadata et de plages privées restent bloquées à la couche IP ; verrouille-le sur une allowlist de noms d'hôtes avec `SANDBOX_EGRESS_ALLOWLIST`, décrit dans [Durcissement](/fr/self-hosted/operate/security/hardening).

Un dixième conteneur, **tale-bgutil-provider**, est un sidecar tiers best-effort qui fournit les PO-tokens dont l'ingestion de liens vidéo a besoin pour passer le mur anti-bot de YouTube — voir [Ingestion vidéo](/fr/self-hosted/configuration/video-ingestion).

## Données sur le disque

Ces volumes survivent à un `docker compose down` :

- `db-data` — le répertoire de données du Postgres opérationnel : le magasin applicatif _et_ le corpus de connaissances (fragments de documents, embeddings, index de recherche, pages crawlées), puisque le stack single-host replie les deux dans une seule base.
- `convex-data` — le magasin de config de l'org : agents, skills, fournisseurs, politiques de gouvernance, fichiers de connexion SSO et branding téléversé. Le nom précède le retrait de Convex et est conservé pour qu'aucun opérateur n'ait à migrer un volume pour un renommage ; le backend possède chaque écriture, et la plateforme le monte en lecture seule.
- `object-store-data` — le store de blobs : fichiers téléversés, pièces jointes de chat, documents générés, bundles exportés.
- `caddy-data`, `caddy-config` — certificats TLS et état du proxy.
- `backups` — snapshots de volumes vérifiés par somme de contrôle, écrits par `tale backup` et automatiquement avant les déploiements qui migrent ; [Sauvegardes et restauration](/fr/self-hosted/operate/backups-and-restore) est l'exercice.

Tout le reste est éphémère. Les conteneurs se remplacent sans perte de données tant que les volumes survivent. `tale backup` snapshotte les volumes de données ci-dessus — `object-store-data` compris, tant que les blobs vivent dans le magasin d'objets fourni. Les blobs d'un bucket S3 externe, qu'il s'agisse d'un défaut du déploiement repointé ou du propre bucket d'une organisation, sont à toi de sauvegarder, et le backup te le dit ; [Sauvegardes et restauration](/fr/self-hosted/operate/backups-and-restore) a la liste et l'exercice.

## Secrets de fournisseur et couche SOPS

Les clés de fournisseur (OpenAI, Anthropic, Azure, Ollama, etc.) vivent sur le disque dans un répertoire `providers/` à l'intérieur du magasin de config. Chaque fournisseur a un `<name>.json` et un `<name>.secrets.json` ; le fichier de secrets est chiffré avec SOPS et la variable [`SOPS_AGE_KEY`](/fr/self-hosted/configuration/environment-reference).

Cette séparation existe pour deux raisons. Faire tourner une clé de fournisseur, c'est éditer un fichier, pas relancer le backend ; sauvegarder le fichier chiffré est sûr à committer aux côtés de l'infrastructure. Le mode texte clair (pas de SOPS, secrets en clair au mode 0600) est pris en charge pour les environnements strictement contrôlés où le disque lui-même est chiffré at rest.

## Auth et sessions

La connexion est Better Auth, tournant dans le conteneur backend-api. Les modes livrés sont l'e-mail/mot de passe local (avec second facteur et passkeys optionnels), le SSO — Microsoft Entra et OIDC générique — et les en-têtes de confiance (trusted headers), où le reverse-proxy fournit l'identité. Le conteneur plateforme lit le cookie et transfère la requête ; backend-api valide la session et décide ce qu'elle peut faire selon le rôle de l'utilisateur et la matrice de permissions par ressource documentée dans [Membres et rôles](/fr/platform/admin/members-and-roles).

La [référence d'authentification](/fr/self-hosted/configuration/authentication) couvre les variables d'environnement et les compromis par mode.

## Quand tu sors du single-host

Le stack par défaut fait tourner chaque conteneur sur un seul hôte. L'architecture est mono-locataire, mais les tiers se séparent déjà proprement : `tale-backend-worker` scale horizontalement, et le magasin opérationnel et celui des connaissances sont des bases distinctes même quand ils partagent un seul processus Postgres. La première chose que tu peux sortir de la machine sans ré-architecturer, c'est le corpus de connaissances — pointe `KNOWLEDGE_DATABASE_URL` vers un ParadeDB managé (pour la capacité ou une exigence de résidence), et il se relocalise indépendamment, traité dans [Résidence des données](/fr/self-hosted/configuration/data-residency). Le store de blobs est le deuxième — une org qui apporte son propre bucket S3 sous **Paramètres > Résidence des données** contourne entièrement l'`object-store` embarqué.

## Où cela s'inscrit

Cette page d'architecture est la carte que toute autre page auto-hébergée présuppose. La lecture suivante naturelle est [Démarrage rapide](/fr/self-hosted/install/quickstart) si tu montes une instance fraîche, ou [Architecture des conteneurs](/fr/self-hosted/operate/container-architecture) si tu en exploites une et qu'il te faut la même image avec les modes de défaillance superposés.
