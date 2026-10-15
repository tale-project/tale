---
title: Occuper les agents avec la répartition du travail
description: Laisse Tale lancer les tâches prêtes d’un projet sur les agents libres, exécuter des rôles permanents selon un horaire, desservir les tableaux d’autres projets, retenir du travail derrière des signaux extérieurs et voir pourquoi un agent est inactif.
---

La répartition du travail lance les tâches prêtes d’un projet sur les agents de son pool dès qu’un agent est libre, et lance les rôles permanents — la tournée de routage d’un coordinateur, une vérification nocturne — selon leur horaire. Personne n’a à lancer chaque exécution, et aucune automatisation ni aucun agent coordinateur n’a à décider quand un agent peut commencer. Toute personne qui peut lire le projet voit ce que fait la répartition sous **Répartition du travail** dans le projet ; les administrateurs du projet la modifient.

La répartition décide quand et où le travail démarre. Ce qui vaut la peine d’être fait reste la décision d’une personne ou d’un agent coordinateur : fixe les priorités, ordonne le tableau et déplace les tâches entre les colonnes, et la répartition prend le travail dans cet ordre.

<Frame caption="L’onglet Répartition du travail montre si la répartition est activée, combien d’exécutions son pool tient et pourquoi chaque agent du pool est inactif.">

![L’onglet Répartition du travail du projet Website relaunch : la répartition est désactivée, aucune exécution n’est tenue, les deux agents du pool sont inactifs parce que la répartition est désactivée, et aucun passage n’a encore eu lieu.](/images/platform/project-dispatch.webp)

</Frame>

## Choisir ce que la répartition prend et qui y travaille

Ouvre le projet, choisis **Répartition du travail**, puis **Modifier**, ou **Configurer la répartition du travail** tant que le projet n’en a pas.

| Réglage | Ce qu’il décide |
| --- | --- |
| **Répartition activée** | Si la répartition lance quoi que ce soit. Désactivée, elle ne lance rien ; les exécutions en cours continuent. |
| **Agents du pool** | Les agents du projet que la répartition lance. Une tâche assignée à un agent hors du pool n’est jamais lancée par la répartition. |
| **Exécutions simultanées** | Le nombre maximal d’exécutions que le pool tient en même temps, de 1 à 500. Les exécutions que des personnes, des automatisations et des rôles permanents lancent sur les agents du pool comptent aussi ; un rôle permanent démarre tout de même à son horaire quand le pool est plein. |
| **Exécutions par agent** | Le nombre maximal d’exécutions qu’un agent du pool tient à la fois, 1 par défaut et jamais plus que **Exécutions simultanées**. Chaque exécution travaille dans son propre [worker d’agent](/fr/platform/projects/project-agents#run-one-agent-on-several-tasks). |
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
3. laisse un agent de côté tant que le modèle d’IA qu’il utilise est [saturé](/fr/platform/projects/task-automation#handle-waiting-and-failed-runs), et lance le travail sur ce modèle par vagues dès qu’il répond de nouveau ;
4. interroge l’hôte des sandbox avant chaque démarrage, et s’arrête quand l’hôte est occupé ;
5. lance la tâche prête la mieux classée — sur le tableau de ce projet ou sur un tableau qu’elle [dessert](#sources) — sur son propre agent libre.

Chaque démarrage passe les mêmes contrôles qu’un démarrage depuis le tableau : une tâche avec un bloqueur ouvert attend, une tâche accepte au plus trois démarrages automatiques par heure, et une tâche ne s’exécute qu’une fois à la fois. Une exécution lancée par la répartition indique **Lancée par la répartition du travail** dans l’historique de la tâche et agit au nom du projet, pas d’une personne.

Chaque exécution d’agent a besoin d’un worker d’agent. Quand le pool peut tenir en même temps plus d’exécutions que ton organisation n’a de workers d’agent, **Répartition du travail** le signale : les exécutions en trop ne feraient qu’attendre un worker libre. Les Propriétaires et les Admins relèvent la limite dans [Sandboxes](/fr/platform/admin/sandboxes#identifier-la-limite-concernee).

## Faire travailler un agent sur des centaines de tâches {#limits}

La répartition peut occuper un agent sur autant de tâches à la fois que ton organisation peut avoir de workers d’agent : jusqu’à 500. Pour que l’agent Coder travaille sur 256 tâches à la fois, place Coder seul dans le pool, règle **Exécutions simultanées** et **Exécutions par agent** sur 256, et donne à ton organisation au moins 256 **Workers d’agent** dans [Sandboxes](/fr/platform/admin/sandboxes#identifier-la-limite-concernee), dans la limite de ce que le déploiement peut exécuter. Chaque exécution travaille toujours dans son propre worker, avec son propre espace de travail.

| Réglage | Valeurs admises |
| --- | --- |
| **Exécutions simultanées** | De 1 à 500 |
| **Exécutions par agent** | De 1 à 500, jamais plus que **Exécutions simultanées** ; 1 par défaut |
| **Agents du pool** | Jusqu’à 50 |
| **Seulement les tâches avec l’étiquette** / **Jamais les tâches avec l’étiquette** | Jusqu’à 20 étiquettes chacun |
| **Délai entre deux démarrages (secondes)** | De 0 à 3 600 ; 30 par défaut |
| **Redemander à un hôte occupé après (secondes)** | De 1 à 10 délais, chacun de 10 à 3 600 |
| **Rôles permanents** | Jusqu’à 20 |
| **Barrières** | Jusqu’à 10 |
| **Tableaux desservis** | Jusqu’à 20 autres projets |
| **Relecteurs** | Jusqu’à 10 agents |

Un enregistrement qui permettrait à un agent de tenir plus d’exécutions que **Exécutions simultanées** est refusé sous **Exécutions par agent**. Une répartition enregistrée avant cette règle continue de fonctionner telle quelle ; le prochain enregistrement la corrige.

La vitesse à laquelle un grand pool se remplit dépend de **Délai entre deux démarrages (secondes)**. Avec un délai, chaque passage lance une tâche et le passage suivant vient ce délai plus tard : la 256e exécution démarre donc 255 fois ce délai après la première, soit 2 heures 7 minutes 30 secondes avec les 30 secondes par défaut, et 21 minutes 15 secondes avec 5 secondes. Avec 0, un passage lance chaque tâche prête que l’hôte des sandbox admet, pendant deux minutes au plus, et le passage suivant prend aussitôt le relais ; quand l’hôte est occupé, ses délais avant de redemander ralentissent le démarrage. Un passage lit jusqu’à 500 tâches prêtes, assez pour remplir le plus grand pool.

Quand un modèle d’IA répond de nouveau après avoir été saturé, les exécutions qui l’attendaient démarrent par vagues espacées de 15 secondes : une exécution, puis deux, puis quatre, et ainsi de suite, jamais plus d’un seizième d’entre elles à la fois. Même 256 exécutions en attente ont ainsi toutes démarré en cinq minutes au plus. Le nouveau travail que la répartition lance sur ce modèle monte en charge de la même façon, pour que le travail prêt qu’elle a retenu pendant la saturation n’atteigne pas le modèle d’un coup : une exécution dès que le modèle répond, deux de plus 15 secondes plus tard, puis quatre, huit et seize, et ensuite jusqu’à 32 toutes les 15 secondes. Chaque exécution lancée sur le modèle depuis qu’il répond compte, d’où qu’elle vienne. Un pool de 256 exécutions sur ce modèle est ainsi rempli en trois minutes au plus ; au bout de cinq minutes, la montée en charge est terminée. Un **Délai entre deux démarrages (secondes)** plus lent que cette montée en charge s’applique toujours.

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

## Desservir les tableaux d’autres projets {#sources}

La répartition du travail d’un projet peut travailler sur les tableaux d’autres projets de ton organisation. Un projet « Développement », par exemple, tient un pool d’agents de développement qui prend le travail prêt arrivé sur les tableaux des projets « Site web », « Facturation » et « Application mobile ». Ces autres projets sont les sources de la répartition. Déclare-les dans la ressource gérée `project-dispatch` ou avec les [outils de paramètres](/fr/develop/mcp-settings) : chaque source nomme l’ID du projet et, si tu le souhaites, les colonnes d’où vient son travail prêt (sinon celles de la répartition) ainsi que les étiquettes de ce projet à prendre ou à laisser. **Modifier** garde les sources telles quelles ; il ne les change pas.

Tant qu’une répartition dessert un projet :

- son travail prêt rejoint celui de la répartition dans un seul ordre — colonne, priorité, place sur le tableau, ancienneté —, et les exécutions de chaque agent sur tous les tableaux comptent pour **Exécutions par agent** et **Exécutions simultanées** ;
- les agents du pool, des rôles permanents et les relecteurs peuvent se voir attribuer les tâches de ce projet et y être lancés ; avec leurs outils de tâches, ils trouvent, lisent, commentent, déplacent et relisent ces tâches, selon leurs autorisations. Ils n’y créent aucune tâche, n’y lancent aucun autre agent et ne lisent rien d’autre de ce projet. Le tableau de ce projet les affiche par leur nom, et ses listes de responsables et de relecteurs les proposent, avec le projet dont la répartition les envoie ; une mention à cet endroit ne les atteint pas ;
- une exécution sur l’une de ses tâches appartient à cette tâche : elle apparaît sur le tableau de ce projet et dans l’historique de la tâche, pour les personnes qui lisent ce projet. L’agent lit les instructions des deux projets : le projet du tableau décide de la façon dont ses tâches sont rédigées, étiquetées, déplacées, relues et rapportées, et le projet de l’agent de la façon dont l’agent travaille.

Enregistrer une répartition avec des sources exige le droit de modifier chacun de ces projets, en plus d’administrer le projet de la répartition. Tale vérifie de nouveau ce droit à chaque passage, chaque démarrage et chaque appel d’outil, pour la dernière personne à avoir enregistré la répartition : un projet supprimé ou archivé, ou que cette personne ne peut plus modifier, est ignoré. La répartition n’en prend alors plus rien, et ses agents ne peuvent plus agir sur ses tâches, jusqu’à ce qu’une personne qui peut le modifier enregistre de nouveau la répartition. Ses tâches restent assignées à ces agents jusqu’à ce que quelqu’un les réassigne, mais **Démarrer l'agent** y est refusé, et ni un passage à **En cours**, ni une nouvelle tentative, ni un commentaire ne les y lance. **Tableaux desservis**, sur la page **Répartition du travail**, affiche chaque source comme **Desservi** ou ignorée, avec la raison. L’onglet **Répartition du travail** d’un projet qu’une autre répartition dessert l’indique, avec un lien vers elle — que le projet ait ou non sa propre répartition.

### Relire ce que le pool a produit {#reviewers}

Les **Relecteurs** de la répartition sont des agents de son propre projet autorisés à [relire des tâches](/fr/platform/projects/task-automation#agent-review) ; ils relisent ce que son pool a produit sur chaque tableau qu’elle dessert. Quand un agent du pool termine une tâche, la relecture va au relecteur que la tâche désigne, si elle en désigne un. Sinon, elle va au premier relecteur de la répartition qui n’a pas produit le travail, avant le relecteur par défaut du projet. Un relecteur ne relit jamais son propre travail.

## Comprendre pourquoi un agent est inactif

**Agents** liste chaque agent du pool avec les exécutions sur lesquelles il travaille, et la raison de son inactivité quand il n’en a aucune :

| Inactif, car | Signification |
| --- | --- |
| **Son modèle est saturé** | Le fournisseur a déclaré le modèle de l’agent saturé ; l’agent reprend du travail dès que le modèle répond. |
| **L’hôte des sandbox est occupé** | L’hôte a retenu le dernier démarrage ; la répartition redemande après ses délais. |
| **Tous les workers d’agent sont occupés** | Chaque worker d’agent de ton organisation est occupé. |
| **Attend entre deux démarrages** | Le prochain démarrage attend le délai entre deux démarrages, la prochaine vague d’un modèle qui répond de nouveau, ou le passage suivant, qui suit aussitôt quand un passage a manqué de temps. |
| **Une barrière retient le travail prêt** | Le travail restant pour cet agent est retenu par une barrière. |
| **Aucun travail prêt** | Aucune tâche des colonnes choisies n’est prête pour cet agent. |
| **La répartition est désactivée** | La répartition, ou l’automatisation des tâches de ton organisation, est désactivée. |
| **Aucun passage encore** | La répartition n’a fait aucun passage depuis l’entrée de l’agent dans le pool. |

Une exécution sur un tableau que la répartition dessert nomme le projet de ce tableau à côté de sa tâche. Un agent qui tient plus de cinq exécutions affiche combien il en tient — **En cours**, **En file d’attente** et chaque raison pour laquelle ses exécutions attendent, comme **En attente du modèle** — ainsi que ses cinq premières exécutions, les plus anciennes d’abord. Un bouton comme **Afficher 45 exécutions de plus** en liste jusqu’à 50 ; au-delà, la page indique combien d’autres ne sont pas listées ici. L’[API REST](/fr/develop/api-reference#dispatch) les compte et les liste de la même façon.

**Derniers passages** montre les 20 derniers passages : quand, ce qui les a demandés, combien d’exécutions ils ont lancées et retenues, et pourquoi ils se sont arrêtés. **Lancer un passage maintenant** en demande un aussitôt. Un déploiement auto-hébergé peut alerter quand une répartition ne fait plus de passages ; [Prometheus et Grafana](/fr/self-hosted/operate/observability/prometheus-grafana) montre la règle.

## Gérer la répartition comme configuration

Un déploiement qui tient sa configuration dans un dépôt déclare la répartition d’un projet comme ressource gérée `project-dispatch`, appliquée avec la [CLI Tale](/fr/self-hosted/install/cli-install#configurer-la-plateforme) comme les autres [réglages gérés](/fr/develop/mcp-settings). Ce qu’il déclare est ce qu’affiche **Modifier** ; une modification faite dans l’app est écrasée à la prochaine application. Avant d’écrire quoi que ce soit d’une déclaration, la CLI demande à Tale si la répartition déclarée serait enregistrée. Si la répartition nomme ce que le projet ne peut pas utiliser — un agent, une tâche, une étiquette ou une planification —, un relecteur sans autorisation de relecture ou une source que la clé déclarante ne peut pas modifier, la CLI refuse le plan à ce champ, et rien de la déclaration n’est appliqué, pas même les planifications qu’elle désactiverait. La même déclaration peut créer le projet, ses agents, ses tâches permanentes et ses étiquettes : la vérification compte ce qu’elle crée, et la répartition est écrite une fois que tout cela existe.
