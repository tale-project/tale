---
title: Configuration contributeur
description: La source unique de vérité pour mettre en place le code source de Tale en développement local — prérequis, bun install, la vérification pré-vol, ce que fait bun run dev, les conflits de port et la checklist pré-PR.
---

Cette page est pour les contributeurs qui veulent faire tourner Tale depuis le code source et renvoyer une modification. Elle couvre les prérequis, la mise en place unique, la vérification pré-vol qui détecte une machine cassée avant un long démarrage, et ce que tu peux attendre de `bun run dev`. Ce n'est pas le chemin de l'opérateur — si tu veux faire tourner Tale pour l'utiliser, pas le modifier, le [démarrage rapide auto-hébergé](/fr/self-hosted/install/quickstart) installe la stack empaquetée avec la CLI à la place.

Le code source est un seul workspace Bun, de bout en bout — toute la stack est TypeScript, sans Python ni second gestionnaire de paquets à installer. Un seul `bun install` câble chaque service, et `bun run dev` démarre la plateforme avec un backend Convex local, des secrets de dev générés et Vite — pas de compte cloud, pas de `.env` édité à la main. Le travail de connaissances qui vivait autrefois dans des services autonomes (recherche RAG, ingestion de documents, crawling web, génération de documents) tourne désormais dans le backend Convex, donc il n'y a rien de plus à démarrer pour lui.

## Une configuration qui marche, de bout en bout

Le chemin le plus court d'un clone neuf à une app qui tourne fait quatre commandes. La vérification pré-vol entre install et dev est celle qui t'épargne un échec déroutant dix couches en profondeur :

```bash
bun install            # câbler chaque workspace
bun run setup:check    # valider Bun, les ports de dev et la CLI Convex
bun run dev            # démarrer Convex + Vite (guette la bannière READY)
```

Si `setup:check` affiche tout en vert et que `bun run dev` atteint sa bannière `READY`, ton environnement est sain. Le reste de cette page explique chaque pièce et quoi faire quand l'une d'elles se plaint.

## Prérequis

Un seul outil doit être sur ton `PATH` avant tout le reste, parce que toute la stack est du TypeScript sur une seule runtime :

- **Bun 1.3 ou plus** — la runtime de workspace et le gestionnaire de paquets. Installe-le depuis [bun.sh](https://bun.sh/docs/installation), puis confirme avec `bun --version`. Tout le reste dont le code source a besoin (la CLI Convex, chaque dépendance de service) est résolu par `bun install`.

Tu n'as pas besoin de Docker pour le développement local avec `bun run dev` — il lance Convex directement sur ta machine. Docker n'entre en jeu que pour le mode hybride conteneurisé plus bas et pour l'installation de l'opérateur.

## Installation et pré-vol

Une seule installation couvre chaque workspace, parce que le dépôt est un graphe de workspaces Bun unique :

```bash
bun install
```

Avant le premier `bun run dev`, lance la vérification pré-vol. Elle valide ta version de Bun, que les ports 3000 et 3210 sont libres et que la CLI Convex est joignable — et imprime la correction exacte pour tout ce qui manque, pour que tu ne découvres pas une mauvaise version de Bun à mi-chemin d'un démarrage à froid :

```bash
bun run setup:check
```

Chaque ligne en échec porte sa correction : un `bun upgrade` pour un vieux Bun, une paire `lsof`/`kill` pour un port occupé. Un passage propre se termine à zéro et te dit d'avancer avec `bun run dev`.

## Ce que fait `bun run dev`

`bun run dev` est l'orchestrateur de développement. Il charge tes fichiers `.env`, génère des valeurs par défaut locales non sécurisées pour chaque secret que tu n'as pas réglé, lance un backend Convex local en mode anonyme, y synchronise l'environnement, exécute le codegen Convex, attend que les routes d'auth répondent, puis démarre Vite. La plateforme est le serveur le plus lent à monter parce qu'elle attend Convex, donc un démarrage à froid prend de 30 à 90 secondes.

Tant que l'orchestrateur n'imprime pas sa bannière `READY`, le fait que l'app refuse les connexions sur `http://localhost:3000` est attendu, pas un échec — Vite n'a pas encore lié le port. Quand tu vois la bannière, l'app est joignable et l'auth est saine. Arrête toute la stack avec `Ctrl-C` ; elle ferme proprement Convex et Vite.

L'orchestrateur de dev génère tout ce dont il a besoin, donc une copie locale de `.env.example` est optionnelle pour le développement local — les valeurs par défaut non sécurisées (`INSTANCE_SECRET`, `BETTER_AUTH_SECRET`, la clé HMAC WebDAV) sont remplies au démarrage et imprimées comme avertissements. Règle de vraies valeurs dans `services/platform/.env.local` seulement quand tu as besoin d'un comportement façonné pour la production ou veux surcharger une valeur par défaut.

## Quand un port est occupé

`bun run dev` lie deux ports : 3000 pour l'app Vite et 3210 pour le backend Convex local. Il échoue tout de suite avec un message actionnable quand l'un est pris, parce qu'un repli silencieux vers un autre port casserait le proxy Convex et chaque lien `localhost:3000`. Le coupable habituel est un `bun run dev` ou `tale dev` précédent qui n'a pas complètement quitté.

Libère le port et relance. La commande qui trouve et arrête le détenteur est celle que `setup:check` et l'orchestrateur suggèrent :

```bash
lsof -nP -iTCP:3000 -sTCP:LISTEN   # montrer la PID qui tient le port de l'app
kill <PID>                         # l'arrêter
```

Pour faire tourner l'app sur un autre port à la place, règle `PORT` : `PORT=3005 bun run dev`. Si le déploiement Convex reste dans un mauvais état après la maintenance automatique — schéma périmé après migration avortée, SQLite locale corrompue — voir [Réinitialiser les données Convex de dev locales](#réinitialiser-les-données-convex-de-dev-locales) ci-dessous ; ne supprime pas `.convex/local/` à la légère.

## Maintenance du stockage Convex local

Chaque push `convex dev` stocke un nouveau bundle de fonctions sous `services/platform/.convex/local/default/convex_local_storage/modules/`. La CLI Convex ne garbage-collecte jamais les anciens blobs en local — des mois de dev quotidien peuvent accumuler des dizaines de milliers de fichiers (10+ Go) et faire échouer les cold starts dans la fenêtre de 30 secondes de la CLI.

`bun run dev` lance la maintenance automatiquement avant de spawner Convex :

- **Prune** quand le stockage modules dépasse 1 500 blobs ou 2 Go — ne supprime que les blobs historiques non référencés sous `convex_local_storage/modules/`, en gardant chaque blob que le déploiement actuel charge encore (packages source des modules et leurs parents deps node via `externalPackageId`, plus jusqu'à 1 000 restes non référencés les plus récents). La base SQLite, les fichiers uploadés et la config org restent intacts. Si les références live ne peuvent pas être lues, ou semblent vides alors que des blobs restent sur disque, le prune est ignoré plutôt que de deviner.
- **Contrôle d'intégrité** — si un blob de module live manque déjà sur disque, `bun run dev` s'arrête avec une erreur claire qui pointe vers `setup:clean`. Continuer démarrerait un backend à moitié mort (chat et crons échouent avec des erreurs serveur opaques).
- **Supprime les artefacts d'export snapshot** quand la version binaire Convex en cache ne correspond plus à celle enregistrée dans le déploiement local — retire `export.zip` et les restes d'import/export qui peuvent déclencher un ré-import raté au cold start, sans effacer les données de dev.

Règle `TALE_DEV_SKIP_CONVEX_MAINTENANCE=1` pour désactiver le prune/nettoyage snapshot (le contrôle d'intégrité tourne quand même). `bun run setup:check` avertit (sans bloquer) quand le stockage modules dépasse déjà le seuil de prune.

## Réinitialiser les données Convex de dev locales

En dernier recours seulement — `bun run setup:clean` efface **toutes** les données Convex de dev locales : chaque table du SQLite local, chaque upload dans `convex_local_storage/files/`, chaque bundle de fonctions. La config org sur disque et `.env.local` restent intacts.

**Traverser la baseline 0.4 :** les données de dev locales et les arborescences de config par org créées par des checkouts pré-0.4 n'ont aucun chemin de migration — la remise à zéro de la baseline 0.4 a vidé l'historique des migrations, et l'aller-retour export/import ci-dessous ne peut pas non plus faire le pont (l'ancien export ne correspond pas au nouveau schéma). Faire passer une machine de dev de l'autre côté de la baseline, c'est réinitialiser les données Convex locales et recréer tes orgs de dev ; traite les répertoires d'org `$TALE_CONFIG_DIR` pré-0.4 de la même façon.

**Garde tes données à travers le reset.** Même quand la barrière d'intégrité se déclenche (le bundle d'un module actif manque), le backend lui-même démarre encore — tu peux donc exporter tes données avant et les restaurer après, et le reset ne perd alors rien :

```bash
# 1. Démarre le backend (cela contourne la barrière d'intégrité de
#    `bun run dev`), puis exporte dans un second terminal :
bun run --filter @tale/platform convex:dev
cd services/platform && npx convex export --path convex-backup.zip

# 2. Réinitialise (protégé — voir ci-dessous), bootstrappe un déploiement
#    neuf, puis restaure :
bun run setup:clean            # tape : delete local convex
bun run dev                    # attends la bannière READY
cd services/platform && npx convex import --replace-all convex-backup.zip
```

`bun run setup:clean` est volontairement protégé (les agents de code ne doivent pas l'exécuter sauf demande explicite de ta part) :

1. Lance-le toi-même dans un terminal — pas via un agent.
2. Au prompt, tape la phrase exacte `delete local convex` (un simple `y` est refusé).
3. Les exécutions non interactives (CI) exigent `TALE_CONFIRM_DESTROY_LOCAL_CONVEX=delete-local-convex` — ne jamais le définir dans les shells d'agents.

Essaie d'abord la maintenance automatique et un `bun run dev` normal. S'il faut vraiment réinitialiser, **exporte d'abord** (ci-dessus) pour garder tes données — ne saute l'export que si tu n'as réellement pas besoin des conversations locales, des uploads et du reste de l'état du déploiement anonyme.

## Mode hybride contre un Convex conteneurisé

`bun run dev` lance par défaut un backend Convex éphémère, ce qui est la bonne chose pour l'essentiel du travail. Quand tu veux des reloads Vite rapides contre un Convex stable qui reflète la production, fais tourner le conteneur `convex` dédié et pointe Vite vers lui à la place :

```bash
docker compose up convex                 # un terminal : le backend stable
CONVEX_EXTERNAL=true bun run dev          # un autre : Vite contre le conteneur
```

Règle `CONVEX_URL` si ton conteneur expose Convex sur un hôte ou un port non standard. C'est le seul chemin de dev local qui a besoin de Docker, et il est optionnel — le backend éphémère par défaut n'a besoin de rien au-delà des trois prérequis.

## Avant d'ouvrir une PR

Chaque PR passe par un gate : `bun run check`, c'est-à-dire format, lint, typecheck et la suite de tests complète sur chaque workspace touché. Un passage vert est le signal de merge ; un rouge bloque. La checklist pré-PR dans [`AGENTS.md`](https://github.com/tale-project/tale/blob/main/AGENTS.md) liste le reste — la doc et les traductions arrivent dans la même PR que le code qui les a modifiées.

Si ta modification touche `services/docs/`, lance aussi le gate de la doc (`bun run --filter @tale/docs test`) pour que la parité structurelle, la terminologie et les vérifications de prose passent avant la revue. Tout ce qu'un utilisateur peut voir, configurer ou appeler a besoin de sa doc mise à jour dans les trois locales de base dans le même commit.

## Où cela s'inscrit

La configuration contributeur est le sol sur lequel se tient chaque autre tâche de développeur : mets les prérequis en place, laisse `setup:check` confirmer la machine, et `bun run dev` te donne toute la plateforme avec un backend local en moins de deux minutes une fois les images chaudes. La vérification pré-vol et la correction de port existent parce que les échecs de premier passage les plus courants sont une mauvaise version d'outil ou un processus résiduel qui tient un port — deux corrections de cinq secondes une fois que tu peux les voir.

Une fois la stack en marche, l'[aperçu Développement](/fr/develop/overview) cadre la surface externe contre laquelle tu construis, et [Développement assisté par IA](/fr/develop/ai-assisted-development) couvre l'usage des agents Tale pour écrire des configurations Tale. Si tu contribues une modification de conteneur plutôt qu'une modification de code source, [Contribuer](/fr/self-hosted/contributing-docker) sous l'onglet Auto-hébergé est le parcours build-and-test pour ce chemin.
