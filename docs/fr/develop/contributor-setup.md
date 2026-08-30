---
title: Configuration contributeur
description: La source unique de vérité pour mettre en place le code source de Tale en développement local — prérequis, bun install, la vérification pré-vol, ce que fait bun run dev, les conflits de port et la checklist pré-PR.
---

Cette page est pour les contributeurs qui veulent faire tourner Tale depuis le code source et renvoyer une modification. Elle couvre les prérequis, la mise en place unique, la vérification pré-vol qui détecte une machine cassée avant un long démarrage, et ce que tu peux attendre de `bun run dev`. Ce n'est pas le chemin de l'opérateur — si tu veux faire tourner Tale pour l'utiliser, pas le modifier, le [démarrage rapide auto-hébergé](/fr/self-hosted/install/quickstart) installe la stack empaquetée avec la CLI à la place.

Le code source est un seul workspace Bun, de bout en bout — toute la stack est TypeScript, sans Python ni second gestionnaire de paquets à installer. Un seul `bun install` câble chaque service, et `bun run dev` démarre les conteneurs de support, le backend de la plateforme et Vite avec des secrets de dev générés — pas de compte cloud, pas de `.env` édité à la main. Le travail de connaissances qui vivait autrefois dans des services autonomes (recherche RAG, ingestion de documents, crawling web, génération de documents) tourne dans le backend, donc il n'y a rien de plus à démarrer pour lui.

## Une configuration qui marche, de bout en bout

Le chemin le plus court d'un clone neuf à une app qui tourne fait trois commandes. La vérification pré-vol entre install et dev est celle qui t'épargne un échec déroutant dix couches en profondeur :

```bash
bun install            # câbler chaque workspace
bun run setup:check    # valider Bun et les ports de dev
bun run dev            # démarrer la stack (guette la bannière READY)
```

Si `setup:check` affiche tout en vert et que `bun run dev` atteint sa bannière `READY`, ton environnement est sain. Le reste de cette page explique chaque pièce et quoi faire quand l'une d'elles râle.

## Prérequis

Deux choses doivent être sur ta machine, parce que toute la stack est du TypeScript sur un seul runtime — plus une vraie base de données :

- **Bun 1.3 ou plus** — le runtime du workspace et le gestionnaire de paquets. Installe-le depuis [bun.sh](https://bun.sh/docs/installation), puis confirme avec `bun --version`. Toutes les dépendances de service sont résolues par `bun install`.
- **Docker** — `bun run dev` fait tourner le backend sur ton hôte mais ses services de support dans des conteneurs : Postgres (la base de l'application), ParadeDB (le corpus de connaissances), la passerelle LLM et l'étage sandbox. Docker Desktop ou n'importe quel daemon ciblé par le contexte Docker de ton shell fait l'affaire.

## Installation et pré-vol

Une seule installation couvre chaque workspace, parce que le dépôt est un seul graphe de workspace Bun :

```bash
bun install
```

Avant le premier `bun run dev`, lance la vérification pré-vol. Elle valide ta version de Bun et que les ports 3000 et 3005 sont libres — et affiche le correctif exact pour tout ce qui manque, pour que tu ne découvres pas une mauvaise version de Bun au milieu d'un démarrage à froid :

```bash
bun run setup:check
```

Chaque ligne en échec porte son correctif : un `bun upgrade` pour un Bun trop vieux, un couple `lsof`/`kill` pour un port occupé. Un passage propre sort en zéro et te dit d'enchaîner sur `bun run dev`.

## Ce que fait `bun run dev`

`bun run dev` est l'orchestrateur de développement. Il charge tes fichiers `.env`, génère des valeurs par défaut locales non sécurisées pour chaque secret non défini, lève les services de support Docker, puis démarre le **backend de la plateforme** — le même point d'entrée `backend/main.ts` que fait tourner le conteneur, dans le rôle combiné `all` (API HTTP et worker de jobs dans un seul processus) — et attend qu'il se lie à son port. Vite démarre en dernier et proxifie `/api`, `/events`, `/dav` et `/scim` vers lui. Un démarrage à froid prend 20 à 60 secondes ; à chaud, bien moins.

Le backend applique lui-même ses migrations de base au démarrage, sous un verrou consultatif : un clone neuf obtient donc une base entièrement migrée sans étape supplémentaire. Une sonde de santé le surveille : s'il cesse de répondre, l'orchestrateur le redémarre jusqu'à un plafond et te dit quand il abandonne.

Tant que l'orchestrateur n'a pas affiché sa bannière `READY`, une connexion refusée sur `http://localhost:3000` est attendue, pas un échec — Vite n'a pas encore lié le port. À la bannière, l'app est joignable et l'authentification est saine. Arrête toute la stack avec `Ctrl-C` ; elle éteint proprement le backend et Vite.

L'orchestrateur de dev génère tout ce dont il a besoin, donc une copie locale de `.env.example` est optionnelle en développement local — les valeurs par défaut non sécurisées (`INSTANCE_SECRET`, `BETTER_AUTH_SECRET`, la clé HMAC WebDAV) sont remplies au démarrage et affichées en avertissement. Ne mets de vraies valeurs dans `services/platform/.env.local` que si tu as besoin d'un comportement proche de la production ou veux écraser une valeur par défaut.

Les conteneurs tournent déjà, ou tu veux itérer uniquement sur le code frontend ? `bun run dev:fast` (`TALE_DEV_SKIP_DOCKER=1`) saute la levée Docker et va droit au backend et à Vite.

## Un login de dev prêt à l'emploi

Une stack neuve amorce un compte owner pour t'éviter de passer par l'assistant `/setup` avant de tester : `dev@tale.test` / `TaleDev!Passw0rd`, propriétaire d'une organisation « Dev Workspace » déjà échafaudée. L'amorçage est idempotent (il tourne à chaque démarrage et ne fait rien si le compte existe déjà) et refuse de s'exécuter si `SITE_URL` n'est pas un hôte loopback — un mot de passe connu sur un nom d'hôte joignable serait une prise de contrôle de compte, pas un confort. Désactive avec `TALE_DEV_SEED_USER=0`, ou surcharge l'identité avec `TALE_DEV_SEED_USER_EMAIL` / `TALE_DEV_SEED_USER_PASSWORD`.

## Quand un port est occupé

`bun run dev` lie deux ports : 3000 pour l'app Vite et 3005 pour le backend. Il échoue vite avec un message actionnable quand l'un est pris, parce qu'un repli silencieux sur un autre port casserait le proxy Vite et tous les liens `localhost:3000`. Le coupable habituel est un `bun run dev` ou `tale dev` précédent qui n'est pas complètement sorti.

Libère le port et relance. La commande qui trouve et arrête le détenteur est la même que celle suggérée par `setup:check` et l'orchestrateur :

```bash
lsof -nP -iTCP:3000 -sTCP:LISTEN   # montrer le PID qui tient le port de l'app
kill <PID>                         # l'arrêter
```

## Réinitialiser les données de dev locales

L'état de dev local vit dans les volumes Docker des services de support : une réinitialisation est donc une commande compose plutôt qu'un script dédié :

```bash
docker compose -f compose.yml -f compose.dev.yml down -v db knowledge-db
```

Cela détruit les bases locales — chaque organisation, conversation et fichier téléversé de ta stack de dev. Les arborescences de config d'organisation sur le disque (`$TALE_CONFIG_DIR`) et `.env.local` ne sont pas touchées. Le `bun run dev` suivant remigre depuis le vide et réamorce le login de dev.

## Mode hybride contre un backend conteneurisé

`bun run dev` fait tourner le backend sur ton hôte, ce qui convient à la plupart du travail. Pour pointer Vite vers un backend qui tourne ailleurs — un conteneur, ou la stack d'un collègue — définis `TALE_BACKEND_URL` :

```bash
TALE_BACKEND_URL=http://localhost:3105 bun run dev:fast
```

Vite proxifie chaque voie backend là-bas, et l'orchestrateur attend cette URL au lieu de démarrer son propre enfant.

## Avant d'ouvrir une PR

Chaque PR passe par une porte : `bun run check` — format, lint, typecheck et la suite de tests complète sur chaque workspace touché. Un passage vert est le signal de merge ; un rouge bloque. La checklist pré-PR dans [`AGENTS.md`](https://github.com/tale-project/tale/blob/main/AGENTS.md) liste le reste — docs et traductions partent dans la même PR que le code qui les a changées.

Si ta modification touche `services/docs/`, lance aussi la porte docs (`bun run --filter @tale/docs test`) pour que la parité structurelle, la terminologie et les vérifications de prose passent avant la revue. Tout ce qu'un utilisateur peut voir, configurer ou appeler a besoin de ses docs mises à jour dans les trois locales de base, dans le même commit.

## Où ça se situe

La configuration contributeur est le sol sur lequel se tient toute autre tâche de développement : mets les prérequis en place, laisse `setup:check` confirmer la machine, et `bun run dev` te donne toute la plateforme en moins de deux minutes une fois les images chaudes. La vérification pré-vol et le correctif de port existent parce que les échecs de premier lancement les plus courants sont une mauvaise version d'outil ou un processus resté sur un port — deux correctifs de cinq secondes une fois qu'on les voit.

Une fois la stack lancée, l'[aperçu Develop](/fr/develop/overview) cadre la surface externe contre laquelle tu construis, et le [développement assisté par IA](/fr/develop/ai-assisted-development) couvre l'utilisation des propres agents de Tale pour écrire des configs Tale. Si tu contribues une modification de conteneur plutôt qu'une modification de source, [Contribuer](/fr/self-hosted/contributing-docker) sous l'onglet auto-hébergé est le parcours build-and-test pour ce chemin.
