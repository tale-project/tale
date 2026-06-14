---
title: Configuration contributeur
description: La source unique de vérité pour mettre en place le code source de Tale en développement local — prérequis, bun install, la vérification pré-vol, ce que fait bun run dev, les conflits de port, les services Python et la checklist pré-PR.
---

Cette page est pour les contributeurs qui veulent faire tourner Tale depuis le code source et renvoyer une modification. Elle couvre les prérequis, la mise en place unique, la vérification pré-vol qui détecte une machine cassée avant un long démarrage, et ce que tu peux attendre de `bun run dev`. Ce n'est pas le chemin de l'opérateur — si tu veux faire tourner Tale pour l'utiliser, pas le modifier, le [démarrage rapide auto-hébergé](/fr/self-hosted/install/quickstart) installe la stack empaquetée avec la CLI à la place.

Le code source tourne sur des workspaces Bun. Un seul `bun install` câble chaque service, et `bun run dev` démarre la plateforme avec un backend Convex local, des secrets de dev générés et Vite — pas de compte cloud, pas de `.env` édité à la main. Les services Python (`rag`, `crawler`) sont gérés à part avec `uv` et ne comptent que lorsque tu les touches.

## Une configuration qui marche, de bout en bout

Le chemin le plus court d'un clone neuf à une app qui tourne fait quatre commandes. La vérification pré-vol entre install et dev est celle qui t'épargne un échec déroutant dix couches en profondeur :

```bash
bun install            # câbler chaque workspace
bun run setup:check    # valider Bun, Python, uv, les ports et la CLI Convex
bun run dev            # démarrer Convex + Vite (guette la bannière READY)
```

Si `setup:check` affiche tout en vert et que `bun run dev` atteint sa bannière `READY`, ton environnement est sain. Le reste de cette page explique chaque pièce et quoi faire quand l'une d'elles se plaint.

## Prérequis

Trois outils doivent être sur ton `PATH` avant tout le reste. La plateforme tourne sur Bun ; les services `rag` et `crawler` tournent sur Python, géré par `uv`.

- **Bun 1.3 ou plus** — la runtime de workspace et le gestionnaire de paquets. Installe-le depuis [bun.sh](https://bun.sh/docs/installation), puis confirme avec `bun --version`.
- **Python 3.12** — les services `rag` et `crawler` en ont besoin. Installe-le depuis [python.org](https://www.python.org/downloads/) ; un 3.x plus récent marche aussi.
- **uv** — le gestionnaire de paquets Python qui résout et installe les dépendances des services. Installe-le depuis [la doc uv](https://github.com/astral-sh/uv).

Tu n'as pas besoin de Docker pour le développement local avec `bun run dev` — il lance Convex directement sur ta machine. Docker n'entre en jeu que pour le mode hybride conteneurisé plus bas et pour l'installation de l'opérateur.

## Installation et pré-vol

Une seule installation couvre chaque workspace, parce que le dépôt est un graphe de workspaces Bun unique :

```bash
bun install
```

Avant le premier `bun run dev`, lance la vérification pré-vol. Elle valide Bun, Python, uv, que les ports 3000 et 3210 sont libres et que la CLI Convex est joignable — et imprime la correction exacte pour tout ce qui manque, pour que tu ne découvres pas une mauvaise version de Bun à mi-chemin d'un démarrage à froid :

```bash
bun run setup:check
```

Chaque ligne en échec porte sa correction : un `bun upgrade` pour un vieux Bun, un lien d'installation pour un Python ou un uv manquant, une paire `lsof`/`kill` pour un port occupé. Un passage propre se termine à zéro et te dit d'avancer avec `bun run dev`.

## Ce que fait `bun run dev`

`bun run dev` est l'orchestrateur de développement. Il charge tes fichiers `.env`, génère des valeurs par défaut locales non sécurisées pour chaque secret que tu n'as pas réglé, lance un backend Convex local en mode anonyme, y synchronise l'environnement, exécute le codegen Convex, attend que les routes d'auth répondent, puis démarre Vite. La plateforme est le serveur le plus lent à monter parce qu'elle attend Convex, donc un démarrage à froid prend de 30 à 90 secondes.

Tant que l'orchestrateur n'imprime pas sa bannière `READY`, le fait que l'app refuse les connexions sur `http://localhost:3000` est attendu, pas un échec — Vite n'a pas encore lié le port. Quand tu vois la bannière, l'app est joignable et l'auth est saine. Arrête toute la stack avec `Ctrl-C` ; elle ferme proprement Convex et Vite.

L'orchestrateur de dev génère tout ce dont il a besoin, donc une copie locale de `.env.example` est optionnelle pour le développement local — les valeurs par défaut non sécurisées (`INSTANCE_SECRET`, `BETTER_AUTH_SECRET`, la clé HMAC WebDAV) sont remplies au démarrage et imprimées comme avertissements. Règle de vraies valeurs dans `services/platform/.env.local` seulement quand tu as besoin d'un comportement façonné pour la production ou veux surcharger une valeur par défaut.

## Quand un port est occupé

`bun run dev` lie deux ports : 3000 pour l'app Vite et 3210 pour le backend Convex local. Il échoue tout de suite avec un message actionnable quand l'un est pris, parce qu'un repli silencieux vers un autre port casserait le proxy Convex et chaque lien `localhost:3000`. Le coupable habituel est un `bun run dev` ou `tale start` précédent qui n'a pas complètement quitté.

Libère le port et relance. La commande qui trouve et arrête le détenteur est celle que `setup:check` et l'orchestrateur suggèrent :

```bash
lsof -nP -iTCP:3000 -sTCP:LISTEN   # montrer la PID qui tient le port de l'app
kill <PID>                         # l'arrêter
```

Pour faire tourner l'app sur un autre port à la place, règle `PORT` : `PORT=3005 bun run dev`. Si le déploiement Convex lui-même tombe dans un mauvais état — un schéma périmé après une migration avortée, un fichier SQLite local corrompu — `bun run setup:clean` supprime le répertoire `services/platform/.convex/local/`, pour que le prochain démarrage amorce un backend neuf.

## Les services Python

Les services `rag` et `crawler` vivent en dehors du graphe Bun et sont gérés avec `uv`. Tu ne les mets en place que lorsque ta modification les touche ; la plateforme démarre sans eux pour l'essentiel du travail front-end et Convex. Chaque service installe ses propres dépendances :

```bash
cd services/rag && uv sync --extra dev
cd services/crawler && uv sync --extra dev
```

`bun run check` et `bun run test` exécutent les suites Python aux côtés des suites TypeScript via Turbo, donc une modification de l'un des services Python fait tourner ses tests dans le cadre du gate standard. Quand tu n'as touché que du TypeScript, les suites Python tournent quand même mais passent intactes ; quand tu touches `services/rag` ou `services/crawler`, lance les tests de ce service directement avec `uv run pytest` depuis le répertoire du service pendant que tu itères.

## Mode hybride contre un Convex conteneurisé

`bun run dev` lance par défaut un backend Convex éphémère, ce qui est la bonne chose pour l'essentiel du travail. Quand tu veux des reloads Vite rapides contre un Convex stable qui reflète la production, fais tourner le conteneur `convex` dédié et pointe Vite vers lui à la place :

```bash
docker compose up convex                 # un terminal : le backend stable
CONVEX_EXTERNAL=true bun run dev          # un autre : Vite contre le conteneur
```

Règle `CONVEX_URL` si ton conteneur expose Convex sur un hôte ou un port non standard. C'est le seul chemin de dev local qui a besoin de Docker, et il est optionnel — le backend éphémère par défaut n'a besoin de rien au-delà des trois prérequis.

## Avant d'ouvrir une PR

Chaque PR passe par un gate : `bun run check`, c'est-à-dire format, lint, typecheck et la suite de tests complète (TypeScript et Python) sur chaque workspace touché. Un passage vert est le signal de merge ; un rouge bloque. La checklist pré-PR dans [`AGENTS.md`](https://github.com/tale-project/tale/blob/main/AGENTS.md) liste le reste — la doc et les traductions arrivent dans la même PR que le code qui les a modifiées.

Si ta modification touche `services/docs/`, lance aussi le gate de la doc (`bun run --filter @tale/docs test`) pour que la parité structurelle, la terminologie et les vérifications de prose passent avant la revue. Tout ce qu'un utilisateur peut voir, configurer ou appeler a besoin de sa doc mise à jour dans les trois locales de base dans le même commit.

## Où cela s'inscrit

La configuration contributeur est le sol sur lequel se tient chaque autre tâche de développeur : mets les prérequis en place, laisse `setup:check` confirmer la machine, et `bun run dev` te donne toute la plateforme avec un backend local en moins de deux minutes une fois les images chaudes. La vérification pré-vol et la correction de port existent parce que les échecs de premier passage les plus courants sont une mauvaise version d'outil ou un processus résiduel qui tient un port — deux corrections de cinq secondes une fois que tu peux les voir.

Une fois la stack en marche, l'[aperçu Développement](/fr/develop/overview) cadre la surface externe contre laquelle tu construis, et [Développement assisté par IA](/fr/develop/ai-assisted-development) couvre l'usage des agents Tale pour écrire des configurations Tale. Si tu contribues une modification de conteneur plutôt qu'une modification de code source, [Contribuer](/fr/self-hosted/contributing-docker) sous l'onglet Auto-hébergé est le parcours build-and-test pour ce chemin.
