---
title: Architecture auto-hébergée
description: Huit conteneurs, un fichier compose, une base Postgres. Cette page donne le modèle mental pour savoir ce que fait chaque conteneur, où vivent les données sur le disque et quels secrets comptent au premier boot.
---

Une instance Tale, ce sont huit conteneurs derrière un proxy Caddy, parlant à une base Postgres ; deux d'entre eux sont des conteneurs sandbox sur le côté pour l'exécution de code. Le fichier compose est le contrat — ce qui tourne, ce qui est exposé, ce qui est monté. Cette page te donne le modèle mental pour que les pages installation, configuration et exploitation n'aient pas à le réexpliquer.

Lis ceci avant de `docker compose up`. Reviens-y quand tu débogues un incident et que tu dois savoir quel log de conteneur ouvrir en premier.

## Les huit conteneurs

**tale-proxy** est Caddy en bordure. Il termine TLS, route tout sous `/` vers le conteneur plateforme, et tout sous `/api/` et les chemins Convex vers le conteneur convex. Les healthchecks vivent ici.

**tale-platform** est le serveur React + TanStack Start. Il rend l'UI, sert les assets statiques et est le seul conteneur exposé au navigateur. Il ne porte pas d'état métier — tout ce qui doit persister parle à convex.

**tale-convex** est le backend : les actions, queries, mutations et la couche WebSocket à laquelle l'UI s'abonne. Clés de fournisseur, définitions d'agent, exécutions d'automatisation, journaux d'audit — tout cela vit ici et est écrit dans Postgres.

**tale-db** est Postgres. Il porte les données Convex et est le seul conteneur stateful qui compte pour les sauvegardes.

**tale-rag** est le service de récupération : il extrait le texte des documents téléversés, les chunke, embed les chunks et sert l'index vectoriel à l'agent en cours d'exécution.

**tale-crawler** est le crawler de connaissances web : il récupère et indexe les URL déclarées comme entités Site web.

**tale-sandbox** et **tale-sandbox-egress** exécutent du code en sandbox pour l'outil **Exécuter du code** et les scripts de compétence. Le conteneur egress est le seul chemin que la sandbox a vers le réseau ; la politique d'allowlist vit dans la [politique run-code](/fr/platform/admin/governance/run-code-policy).

## Données sur le disque

Trois volumes survivent à un `docker compose down` :

- `db-data` — répertoire de données Postgres. Le seul volume que les sauvegardes doivent capturer.
- `db-backup` — destination des dumps Postgres que le conteneur écrit selon une planification.
- Le montage du magasin d'objets de la plateforme — fichiers téléversés, images générées, bundles exportés.

Tout le reste est éphémère. Les conteneurs peuvent être remplacés sans perte de données tant que les volumes survivent.

## Secrets de fournisseur et couche SOPS

Les clés de fournisseur (OpenAI, Anthropic, Azure, Ollama, etc.) vivent sur le disque dans un répertoire `providers/` monté dans le conteneur plateforme. Chaque fournisseur a un `<nom>.json` et un `<nom>.secrets.json` ; le fichier secrets est chiffré avec SOPS et la variable [`SOPS_AGE_KEY`](/fr/self-hosted/configuration/environment-reference).

Cette séparation existe pour deux raisons. Faire tourner une clé de fournisseur, c'est éditer un fichier, pas redémarrer la plateforme ; sauvegarder le fichier chiffré est sûr à committer aux côtés de l'infrastructure. Le mode clair (pas de SOPS, secrets en clair) est supporté pour des environnements étroitement contrôlés où le disque lui-même est chiffré au repos.

## Auth et sessions

Le sign-in est Better Auth tournant dans le conteneur convex. Quatre modes de sign-in sont fournis : mot de passe local, Microsoft Entra (OAuth/OIDC), OIDC générique et trusted headers (le reverse proxy fournit l'identité). Le conteneur plateforme lit le cookie, le passe à convex, et convex décide de ce que la session peut faire sur la base du rôle de l'utilisateur et de la matrice de permissions par ressource documentée dans [Membres et rôles](/fr/platform/admin/members-and-roles).

La [référence d'authentification](/fr/self-hosted/configuration/authentication) couvre les variables d'environnement et les arbitrages par mode.

## Quand tu sors du single-host

Le fichier compose par défaut fait tourner les huit conteneurs sur un hôte. L'architecture est mono-tenant : rien dans le design ne répartit le travail entre hôtes. Quand tu sors de là — typiquement parce que tale-rag ou tale-crawler ont besoin de leurs propres ressources, ou parce que tu veux un standby chaud — le mouvement est d'extraire ces conteneurs sur un second hôte et de pointer la plateforme dessus via les variables d'environnement. La couche Convex reste mono-instance ; la scalabilité horizontale du backend n'est pas une fonctionnalité v1.

## Où cela s'inscrit

Cette page d'architecture est la carte que présuppose chaque autre page auto-hébergée. La lecture suivante naturelle est [Quickstart](/fr/self-hosted/install/quickstart) si tu montes une instance neuve, ou [Architecture des conteneurs](/fr/self-hosted/operate/container-architecture) si tu en exploites une et que tu veux la même image superposée aux modes de défaillance.
