---
title: Occuper les agents avec la répartition du travail
description: Laisse Tale lancer les tâches prêtes d’un projet sur les agents libres, exécuter des rôles permanents selon un horaire, retenir du travail derrière des signaux extérieurs et voir pourquoi un agent est inactif.
---

La répartition du travail lance les tâches prêtes d’un projet sur les agents de son pool dès qu’un agent est libre, et lance les rôles permanents — la tournée de routage d’un coordinateur, une vérification nocturne — selon leur horaire. Personne n’a à lancer chaque exécution, et aucune automatisation ni aucun agent coordinateur n’a à décider quand un agent peut commencer. Toute personne qui peut lire le projet voit ce que fait la répartition sous **Répartition du travail** dans le projet ; les administrateurs du projet la modifient.

La répartition décide quand et où le travail démarre. Ce qui vaut la peine d’être fait reste la décision d’une personne ou d’un agent coordinateur : fixe les priorités, ordonne le tableau et déplace les tâches entre les colonnes, et la répartition prend le travail dans cet ordre.

## Choisir ce que la répartition prend et qui y travaille

Ouvre le projet, choisis **Répartition du travail**, puis **Modifier**, ou **Configurer la répartition du travail** tant que le projet n’en a pas.

| Réglage | Ce qu’il décide |
| --- | --- |
| **Répartition activée** | Si la répartition lance quoi que ce soit. Désactivée, elle ne lance rien ; les exécutions en cours continuent. |
| **Agents du pool** | Les agents du projet que la répartition lance. Une tâche assignée à un agent hors du pool n’est jamais lancée par la répartition. |
| **Exécutions simultanées** | Le nombre maximal d’exécutions que le pool tient en même temps. Les exécutions que des personnes, des automatisations et des rôles permanents lancent sur les agents du pool comptent aussi ; un rôle permanent démarre tout de même à son horaire quand le pool est plein. |
| **Exécutions par agent** | Le nombre maximal d’exécutions qu’un agent du pool tient à la fois, 1 par défaut. Chaque exécution travaille dans son propre [worker d’agent](/fr/platform/projects/project-agents#run-one-agent-on-several-tasks). |
| **Prendre le travail prêt dans** | Les colonnes d’où vient le travail prêt, **À faire**, **Backlog** ou les deux, dans l’ordre où tu les indiques. |
| **Tâches non assignées** | **Les laisser**, ou **Les confier au pool** : une tâche non assignée est alors assignée à l’agent libre qui a le plus de place. |
| **Confier les tâches jamais lancées à un agent libre** | Une tâche n’attend un agent occupé du pool que jusqu’à ce qu’un autre soit libre. Une tâche qui a déjà été exécutée reste à son agent, pour que sa conversation et ses fichiers restent ensemble. |
| **Seulement les tâches avec l’étiquette** / **Jamais les tâches avec l’étiquette** | Restreint le travail prêt par étiquette. Une étiquette que le projet n’a pas est refusée à l’enregistrement. |
| **Hôte des sandbox** | Avec quelle prudence un démarrage est admis sur l’hôte des sandbox partagé : **Seuils du déploiement**, ou **Prudent**, qui attend aussi que la charge et la pression sur la mémoire et les entrées-sorties disque retombent. |
| **Délai entre deux démarrages (secondes)** | Le temps minimal entre deux démarrages, 30 secondes par défaut, pour qu’un hôte ne reçoive pas beaucoup de démarrages d’un coup. |
| **Redemander à un hôte occupé après (secondes)** | Quand l’hôte retient un démarrage, la répartition redemande après ces délais tour à tour, 60, 120 et 240 secondes par défaut, puis garde le dernier. |

Le travail prêt est classé par colonne, puis par priorité, puis par sa place sur le tableau, puis par ancienneté. Une tâche est prête lorsqu’elle se trouve dans une colonne choisie, n’est pas archivée, n’a pas de bloqueur ouvert et qu’aucune exécution n’y travaille.

## Comment la répartition lance le travail

La répartition fait un passage dès que quelque chose change : une exécution du projet se termine, un modèle répond de nouveau, quelqu’un enregistre la répartition ou une barrière s’ouvre — et au moins une fois par minute. Chaque passage :

1. lance les rôles permanents qui sont dus ;
2. compte les exécutions que tiennent les agents du pool, quelle que soit la personne qui les a lancées ;
3. laisse un agent de côté tant que le modèle d’IA qu’il utilise est [saturé](/fr/platform/projects/task-automation#handle-waiting-and-failed-runs) ;
4. interroge l’hôte des sandbox avant chaque démarrage, et s’arrête quand l’hôte est occupé ;
5. lance la tâche prête la mieux classée sur son propre agent libre.

Chaque démarrage passe les mêmes contrôles qu’un démarrage depuis le tableau : une tâche avec un bloqueur ouvert attend, une tâche accepte au plus trois démarrages automatiques par heure, et une tâche ne s’exécute qu’une fois à la fois. Une exécution lancée par la répartition indique **Lancée par la répartition du travail** dans l’historique de la tâche et agit au nom du projet, pas d’une personne.

Chaque exécution d’agent a besoin d’un worker d’agent. Quand le pool peut tenir en même temps plus d’exécutions que ton organisation n’a de workers d’agent, **Répartition du travail** le signale : les exécutions en trop ne feraient qu’attendre un worker libre. Les Propriétaires et les Admins relèvent la limite dans [Sandboxes](/fr/platform/admin/sandboxes#identifier-la-limite-concernee).

## Exécuter des rôles permanents selon un horaire

Un rôle permanent lance un agent sur sa propre tâche selon un horaire, pour un travail qui revient : un agent coordinateur qui répartit les relectures toutes les trente minutes, une vérification de qualité chaque nuit. Ajoute-le sous **Rôles permanents** dans **Modifier** :

| Champ | Ce que c’est |
| --- | --- |
| **Clé** | Un nom court comme `manager`, repris dans le libellé de chaque occurrence. |
| **Agent** et **Tâche** | Qui travaille, et la tâche qui porte les instructions et l’historique du rôle. |
| **Planification (cron)** et **Fuseau horaire** | Une expression cron à cinq champs, lue dans le fuseau horaire. |
| **Mode** | Un mot que l’agent reçoit à chaque occurrence, comme `full` ou `light`. |
| **Consigne** | Ce que l’agent traite en premier à chaque occurrence. |

À chaque occurrence, la répartition déplace la tâche vers **En cours** et lance l’agent avec la consigne, libellée par l’occurrence dans le fuseau horaire du rôle — par exemple `manager 2026-10-14 16:30 Europe/Zurich`. Une occurrence qui trouve le rôle encore au travail est fondue dans cette exécution au lieu d’en lancer une deuxième. Après une interruption, seule la dernière occurrence manquée s’exécute. Chaque occurrence est décidée une seule fois, même si deux passages la rencontrent, et la tâche d’un rôle n’est jamais lancée comme travail prêt.

## Retenir du travail derrière une barrière

Une barrière retient le travail prêt qu’elle régit tant qu’un signal extérieur le demande — par exemple tant que la file des runners de ton système de CI est pleine. Déclare la barrière sous **Barrières** dans **Modifier** : une **Clé**, les **Étiquettes retenues** (sans étiquette, elle retient tout le travail prêt), puis laisse une personne la fermer et l’ouvrir, ou laisse-la juger une valeur avec **Fermer à partir de** et **Rouvrir sous**. Une barrière fermée ne se rouvre que sous la seconde valeur — la moitié de la première si tu ne la fixes pas —, pour qu’un signal proche du seuil ne la fasse pas basculer sans cesse.

Un système externe signale l’état de la barrière par l’[API REST](/fr/develop/api-reference#dispatch) ; les administrateurs du projet peuvent aussi la **Fermer** et l’**Ouvrir** sous **Barrières**. Une barrière que personne ne signale pendant **Obsolète après (secondes)** — dix minutes par défaut — se rouvre, ou se ferme quand **Si obsolète** indique **Fermer**. **Délai entre ses démarrages (secondes)** laisse passer un démarrage de son travail, puis le suivant seulement après ce délai. Une barrière ne retient jamais les rôles permanents.

## Comprendre pourquoi un agent est inactif

**Agents** liste chaque agent du pool avec les exécutions sur lesquelles il travaille, et la raison de son inactivité quand il n’en a aucune :

| Inactif, car | Signification |
| --- | --- |
| **Son modèle est saturé** | Le fournisseur a déclaré le modèle de l’agent saturé ; l’agent reprend du travail dès que le modèle répond. |
| **L’hôte des sandbox est occupé** | L’hôte a retenu le dernier démarrage ; la répartition redemande après ses délais. |
| **Tous les workers d’agent sont occupés** | Chaque worker d’agent de ton organisation est occupé. |
| **Attend entre deux démarrages** | Le dernier passage a lancé une exécution et respecte le délai entre deux démarrages. |
| **Une barrière retient le travail prêt** | Le travail restant pour cet agent est retenu par une barrière. |
| **Aucun travail prêt** | Aucune tâche des colonnes choisies n’est prête pour cet agent. |
| **La répartition est désactivée** | La répartition, ou l’automatisation des tâches de ton organisation, est désactivée. |
| **Aucun passage encore** | La répartition n’a fait aucun passage depuis l’entrée de l’agent dans le pool. |

**Derniers passages** montre les 20 derniers passages : quand, ce qui les a demandés, combien d’exécutions ils ont lancées et retenues, et pourquoi ils se sont arrêtés. **Lancer un passage maintenant** en demande un aussitôt. Un déploiement auto-hébergé peut alerter quand une répartition ne fait plus de passages ; [Prometheus et Grafana](/fr/self-hosted/operate/observability/prometheus-grafana) montre la règle.

## Gérer la répartition comme configuration

Un déploiement qui tient sa configuration dans un dépôt déclare la répartition d’un projet comme ressource gérée `project-dispatch`, appliquée avec la [CLI Tale](/fr/self-hosted/install/cli-install#configurer-la-plateforme) comme les autres [réglages gérés](/fr/develop/mcp-settings). Ce qu’il déclare est ce qu’affiche **Modifier** ; une modification faite dans l’app est écrasée à la prochaine application.
