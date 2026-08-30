---
title: Architecture auto-hébergée
description: Huit conteneurs, un fichier compose, deux bases Postgres. Cette page donne le modèle mental pour savoir ce que fait chaque conteneur, où vivent les données sur le disque et quels secrets comptent au premier boot.
---

Une instance Tale, ce sont huit conteneurs derrière un proxy Caddy, parlant à deux bases Postgres — une opérationnelle, une pour le corpus de connaissances ; deux d'entre eux sont des conteneurs sandbox sur le côté pour l'exécution de code. Le fichier compose est le contrat — ce qui tourne, ce qui est exposé, ce qui est monté. Cette page te donne le modèle mental pour que les pages installation, configuration et exploitation n'aient pas à le réexpliquer.

Lis ceci avant de `docker compose up`. Reviens-y quand tu débogues un incident et que tu dois savoir quel log de conteneur ouvrir en premier.

## Les huit conteneurs

**tale-proxy** est Caddy en bordure. Il termine TLS, route tout sous `/` vers le conteneur plateforme, et tout sous `/api/` et les chemins Convex vers le conteneur convex. Les healthchecks vivent ici.

**tale-platform** est le serveur React + TanStack Start. Il rend l'UI, sert les assets statiques et est le seul conteneur exposé au navigateur. Il ne porte pas d'état métier — tout ce qui doit persister parle à convex.

**tale-convex** est le backend : les actions, queries, mutations et la couche WebSocket à laquelle l'UI s'abonne. Clés de fournisseur, définitions d'agent, exécutions de workflow, journaux d'audit — tout cela vit ici. Il exécute aussi le travail de connaissances en in-process — l'ingestion de documents, le crawling web, la recherche RAG et la génération de documents sont des node-actions Convex, pas des services séparés. Le travail headless dont ces tâches ont besoin (rendre une page web, transformer du HTML en PDF ou en image) est délégué au runtime sandbox, qui embarque déjà Chromium et Playwright.

**tale-db** est le Postgres opérationnel (ParadeDB). Il porte les données du backend Convex — agents, runs, le log d'audit — et est l'un des deux conteneurs stateful qui comptent pour les sauvegardes.

**tale-knowledge-db** est le Postgres du corpus de connaissances (ParadeDB), la base `tale_knowledge` avec deux schémas : `private_knowledge` (fragments de documents téléversés, embeddings, index BM25, cache sémantique) et `public_web` (pages web crawlées). Il est séparé de `tale-db` pour que le corpus — la banque sensible à la résidence des données — puisse être relocalisé ou remplacé tout seul. Le backend Convex s'y connecte directement ; rien d'autre ne le fait.

**tale-sandbox-llm-gateway** est la gateway LLM pour les tours sur harness. C'est le seul chemin d'un harness en sandbox vers un fournisseur de modèles ; la plateforme le provisionne et frappe des clés par session.

**tale-sandbox** et **tale-sandbox-egress** exécutent du code en sandbox pour le compte de l'outil **Exécuter du code** et des scripts de compétence, et servent de runtime de navigateur headless que le backend convex appelle pour le rendu web et la génération de documents. Le conteneur egress est le seul chemin que la sandbox a vers le réseau. L'egress est ouvert par défaut — le code en sandbox atteint n'importe quel hôte public en HTTPS, tandis que les métadonnées cloud et les plages d'adresses privées restent bloquées au niveau IP ; restreins-le à une allowlist d'hôtes avec `SANDBOX_EGRESS_ALLOWLIST`, décrite dans [Durcissement](/fr/self-hosted/operate/security/hardening).

## Données sur le disque

Quatre volumes survivent à un `docker compose down` :

- `db-data` — le répertoire de données du Postgres opérationnel : la base derrière les agents, les runs et le log d'audit.
- `knowledge-db-data` — le répertoire de données du Postgres du corpus de connaissances : fragments de documents, embeddings, index de recherche et pages web crawlées. Se sauvegarde séparément de `db-data` parce que c'est une base distincte.
- `backups` — snapshots de volumes checksummés, écrits par `tale backup` et automatiquement avant les déploiements migrants ; [Backups et restauration](/fr/self-hosted/operate/backups-and-restore) est le drill.
- Le montage du magasin d'objets Convex — fichiers téléversés, documents générés, bundles exportés.

Tout le reste est éphémère. Les conteneurs peuvent être remplacés sans perte de données tant que les volumes survivent.

## Secrets de fournisseur et couche SOPS

Les clés de fournisseur (OpenAI, Anthropic, Azure, Ollama, etc.) vivent sur le disque dans un répertoire `providers/` monté dans le conteneur plateforme. Chaque fournisseur a un `<nom>.json` et un `<nom>.secrets.json` ; le fichier secrets est chiffré avec SOPS et la variable [`SOPS_AGE_KEY`](/fr/self-hosted/configuration/environment-reference).

Cette séparation existe pour deux raisons. Faire tourner une clé de fournisseur, c'est éditer un fichier, pas redémarrer la plateforme ; sauvegarder le fichier chiffré est sûr à committer aux côtés de l'infrastructure. Le mode clair (pas de SOPS, secrets en clair) est supporté pour des environnements étroitement contrôlés où le disque lui-même est chiffré au repos.

## Auth et sessions

Le sign-in est Better Auth tournant dans le conteneur convex. Quatre modes de sign-in sont fournis : mot de passe local, Microsoft Entra (OAuth/OIDC), OIDC générique et trusted headers (le reverse proxy fournit l'identité). Le conteneur plateforme lit le cookie, le passe à convex, et convex décide de ce que la session peut faire sur la base du rôle de l'utilisateur et de la matrice de permissions par ressource documentée dans [Membres et rôles](/fr/platform/admin/members-and-roles).

La [référence d'authentification](/fr/self-hosted/configuration/authentication) couvre les variables d'environnement et les arbitrages par mode.

## Quand tu sors du single-host

Le fichier compose par défaut fait tourner les huit conteneurs sur un hôte. L'architecture est mono-tenant : rien dans le design ne répartit le travail entre hôtes. La première chose que tu peux sortir de la boîte sans réarchitecturer, c'est le corpus de connaissances — `tale-knowledge-db` est un Postgres autonome, donc le pointer vers une infrastructure gérée (pour la capacité ou pour une exigence de résidence) est un changement de chaîne de connexion, couvert dans [Résidence des données](/fr/self-hosted/configuration/data-residency). La couche Convex reste mono-instance ; la scalabilité horizontale du backend n'est pas une fonctionnalité v1.

## Où cela s'inscrit

Cette page d'architecture est la carte que présuppose chaque autre page auto-hébergée. La lecture suivante naturelle est [Quickstart](/fr/self-hosted/install/quickstart) si tu montes une instance neuve, ou [Architecture des conteneurs](/fr/self-hosted/operate/container-architecture) si tu en exploites une et que tu veux la même image superposée aux modes de défaillance.
