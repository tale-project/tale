---
title: Personnaliser Compose
description: Scaler l'étage app, superposer le fichier compose livré, et savoir quels conteneurs restent des singletons.
---

Chaque processus qui sert une requête dans Tale est remplaçable : les sessions sont des lignes en base, l'avancement d'un chat est une ligne de génération, les hints passent par une outbox, et les écritures dans le magasin de config sont sérialisées par un verrou que tient la base. C'est ce qui permet à `platform`, `backend-api` et `backend-worker` de tourner en plusieurs conteneurs chacun. Cette page est pour l'opérateur dont la queue s'accumule ou dont l'API sature — les boutons de replicas, ce que monter l'un d'eux coûte réellement, quels conteneurs ne doivent jamais être répliqués, et comment changer ce que la CLI n'expose pas sans forker des fichiers que `git pull` écrasera.

## Scaler un rôle

Les trois rôles de l'étage app lisent chacun une variable d'environnement dans le `.env` du déploiement. Le défaut est d'une replica par rôle ; les valeurs hors de `1`–`16` sont ramenées dans la plage avec un avertissement, pas refusées.

| Variable                       | Scale                                            | Monte-la quand                                                                                                     |
| ------------------------------ | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `TALE_BACKEND_WORKER_REPLICAS` | Le runner de jobs                                | L'ingestion, les crawls, les automations ou les tours d'agent s'empilent les uns derrière les autres. La plus sûre et la moins chère. |
| `TALE_BACKEND_API_REPLICAS`    | Chaque porte d'API, l'auth et le flux de hints   | La latence monte sous la concurrence, ou les connexions SSE sont le plafond.                                            |
| `TALE_PLATFORM_REPLICAS`       | L'étage web qui sert la coquille de l'app        | Rarement — il sert des assets statiques et injecte l'env ; le goulot est presque toujours l'API d'abord.                |

Pose-les et déploie. Les nombres prennent effet au prochain `tale deploy`, qui monte toute la couleur à la nouvelle taille :

```bash
# Dans le .env du projet
TALE_BACKEND_WORKER_REPLICAS=3
TALE_BACKEND_API_REPLICAS=2

tale deploy
```

Sous `Blue (active) Services:`, `tale status` liste ensuite une ligne par replica — `backend-api #1`, `backend-api #2`, et ainsi de suite, chacune avec sa santé et sa version. Un rôle à une seule replica garde son nom simple. C'est voulu : une couleur montée à deux sur trois se voit dans la liste au lieu d'être moyennée en une ligne saine.

<Warning>

Compte la fenêtre de déploiement, pas le régime normal. Un déploiement fait tourner les deux couleurs en même temps : `TALE_BACKEND_API_REPLICAS=4` veut donc dire **huit** conteneurs d'API le temps du drain. Chaque conteneur backend porte un plafond mémoire de 12 Go pour ses sous-processus d'ingestion ; c'est un plafond, pas une réservation, mais le pic est réel. Dimensionne pour lui avant de monter un nombre sur une machine déjà juste.

</Warning>

## Ce que scaler ne répare pas

Plus de replicas déplacent un goulot ; elles n'en suppriment aucun.

- **Une base saturée.** Toutes les replicas partagent un seul Postgres. Si les requêtes sont le plafond, plus de clients aggravent la chose. Sors d'abord le corpus de connaissances de la machine — [Résidence des données](/fr/self-hosted/configuration/data-residency) est ce chemin.
- **Un fournisseur de modèle lent.** Les tours d'agent attendent le fournisseur, pas le CPU. Des workers en plus attendent en parallèle.
- **Un seul gros job.** Les replicas divisent une queue, pas un job. Un crawl de 4 heures prend toujours 4 heures.

## Ceux-là restent des singletons

Quatre services ne peuvent pas être répliqués, et la raison diffère pour chacun.

| Service                     | Pourquoi un seul                                                                                                       |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `db`, `object-store`        | Ils **sont** l'état durable. Deux seraient deux copies de la vérité.                                                      |
| `proxy`                     | Il possède les ports de l'hôte et le magasin de certificats.                                                              |
| `sandbox`, `sandbox-egress` | Le spawner tient le socket Docker et le répertoire de sessions sur le système de fichiers de l'hôte ; les sessions y sont épinglées. |
| `sandbox-llm-gateway`       | Il possède l'unique volume `llm-gateway-data`, où vivent les clés virtuelles émises par session.                          |

Scaler l'un d'eux n'est pas une topologie supportée, et `tale deploy` ne le fera pas.

## Superposer un changement que la CLI n'expose pas

De l'env en plus, un mount en plus, un sidecar à toi — tout ce pour quoi la CLI n'a pas de flag va dans un fichier d'overlay, pour que `git pull` ne l'écrase jamais. Quel fichier, et si Compose le lit du tout, dépend de ton mode d'installation.

| Installé avec                | Fichier d'overlay                              | Lu automatiquement                |
| ---------------------------- | ---------------------------------------------- | --------------------------------- |
| `tale init` puis `tale dev`  | `compose.override.yml` à la racine du projet   | Oui — `tale dev` le superpose     |
| Un clone de ce dépôt         | `compose.local.yml`, passé avec `-f`           | Non — tu le passes toi-même       |
| `tale deploy`                | Aucun                                          | La CLI génère compose en interne  |

<Note>

`tale deploy` construit le stack à partir de fichiers générés et ignore les deux noms d'overlay. Sur une installation CLI de production, les boutons supportés sont les variables d'environnement du `.env` — les nombres de replicas ci-dessus et la [Référence d'environnement](/fr/self-hosted/configuration/environment-reference). Un overlay, c'est pour le clone et pour `tale dev`.

</Note>

Pose le fichier à côté du `compose.yml` livré. Compose fusionne les clés en dernier-fichier-gagne : c'est donc le seul fichier que tu touches après un pull.

```yaml
# compose.local.yml — plus de concurrence worker, des logs platform plus bavards
services:
  backend-worker:
    environment:
      WORKER_CONCURRENCY: '8'
  platform:
    environment:
      LOG_LEVEL: debug
```

Monte le stack avec l'overlay en dernier, et vérifie la fusion avant de démarrer des conteneurs :

```bash
docker compose -f compose.yml -f compose.local.yml config --services
docker compose -f compose.yml -f compose.local.yml up -d
```

<Check>

`config --services` liste chaque service du graphe fusionné. Sur les mêmes fichiers, `config --format json` montre `WORKER_CONCURRENCY` à `8` sur `backend-worker` et aucun `container_name` sur `backend-api` ni `backend-worker` — c'est précisément ce qui permet à Compose de les y répliquer.

</Check>

Sur un clone, `--scale` est l'équivalent direct des variables de replicas — pour les deux rôles backend. Le `platform` du clone garde un `container_name` épinglé (`tale-platform`), parce que les runbooks de dépannage l'adressent sous ce nom : il y reste un singleton ; sur un stack `tale deploy`, il scale comme le reste.

```bash
docker compose -f compose.yml -f compose.local.yml up -d --scale backend-worker=3
```

## Ce qu'un overlay ne doit pas changer

Ces modifications ont l'air locales et cassent le stack.

| Changement                                                                | Pourquoi ça casse                                                                                                        |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Épingler `container_name` sur `backend-api` ou `backend-worker`           | `--scale` échoue alors — deux conteneurs ne peuvent pas partager un nom                                                     |
| Scaler n'importe quel service du tableau des singletons ci-dessus          | Chacun tient un volume, un socket ou un port d'hôte que le reste du stack code en dur                                       |
| Renommer le volume `config-data`                                          | Docker ne sait pas renommer un volume ; le nouveau nom monte un volume **vide** et chaque organisation perd sa configuration |
| Éditer `compose.yml` sur place                                            | Le prochain `git pull` l'écrase                                                                                             |
| Publier `5432` ou `8003` sur un hôte public                               | Ces ports servent la boucle interne du clone, pas la production                                                             |

## Où ça s'inscrit

Tu as maintenant une taille par rôle, un fichier qui t'appartient au-dessus du graphe livré, et la liste des conteneurs qui restent uniques quelle que soit la charge. [Montées de version](/fr/self-hosted/operate/upgrades) est ce qu'un déploiement fait de ces replicas — y compris pourquoi l'hôte fait brièvement tourner deux de tout. [Architecture des conteneurs](/fr/self-hosted/operate/container-architecture) est ce que fait chaque conteneur quand l'un d'eux meurt, et la [Référence d'environnement](/fr/self-hosted/configuration/environment-reference) est chaque variable qu'un overlay ou un `.env` pourrait poser. La capacité qui ne vient pas de plus de replicas est un déménagement de store : [Résidence des données](/fr/self-hosted/configuration/data-residency) pour le corpus de connaissances et pour le bucket propre d'une organisation sous **Paramètres > Résidence des données**.
