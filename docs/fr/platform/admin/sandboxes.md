---
title: Gérer la capacité des sandboxes
description: Ajuste les limites de travail simultané, interprète les mesures et examine un démarrage de sandbox bloqué.
---

Ouvre **Paramètres > Sandboxes** lorsqu’un agent ou une analyse de site ne peut pas obtenir d’environnement d’exécution. La page distingue les limites de travail de ton organisation de l’infrastructure réelle du déploiement. Les Propriétaires et Admins peuvent modifier les limites et décider quand les espaces de travail inutilisés sont supprimés. Les Développeurs lisent les limites et la capacité globale, sans accéder aux détails privés des espaces de travail.

## Identifier la limite concernée

| Activité | Valeur par défaut | Ce qui occupe une place |
| --- | --- | --- |
| Sessions d’agent de projet | 2 | Un espace de travail d’agent en démarrage ou au travail, réutilisé entre ses tâches. |
| Sessions de workflow | 2 | La sandbox d’une exécution. Des exécutions simultanées occupent des places distinctes. |
| Sessions de rendu | 2 | Une sandbox temporaire qui rend les pages pendant l’analyse des sites. |

Ces valeurs limitent le travail simultané, pas le nombre de tâches ni les dépenses. Un agent peut travailler sur plusieurs tâches dans son unique espace. Les limites ne réservent pas d’infrastructure : toutes les organisations partagent la capacité du déploiement.

<Frame caption="Le total des trois limites de travail se recalcule automatiquement. Il ne doit pas dépasser la capacité du déploiement.">

![La section des limites de l’organisation affiche trois limites de sessions modifiables et leur total calculé par rapport à la capacité du déploiement.](/images/platform/settings-sandboxes.webp)

</Frame>

## Modifier une limite d’activité

1. Vérifie les places allouées à l’activité et les mesures d’infrastructure en dessous.
2. Saisis un entier de 1 à 500 pour la limite concernée. Le total affiché recalcule la somme des trois champs.
3. Maintiens cette somme dans la capacité du déploiement, puis choisis **Enregistrer** dans l’en-tête. **Abandonner** rétablit les valeurs enregistrées.
4. Rouvre la page pour vérifier les limites enregistrées, puis observe si de nouvelles tâches obtiennent une allocation.

Les valeurs initiales totalisent 6. Avec une capacité de déploiement de 8, un total de 8 est accepté et 9 est refusé. Le serveur vérifie à nouveau la capacité à l’enregistrement ; sa valeur peut donc différer de la première observation. Les [appareils](/fr/platform/admin/sandbox-devices) connectés de ton organisation ajoutent au plafond les sandboxes qu’ils exécutent : avec un appareil qui en exécute 4, le total peut atteindre 12.

Une baisse concerne les prochains démarrages et n’interrompt pas le travail en cours. Si les mesures d’infrastructure manquent, les réductions restent possibles, mais une augmentation demande une nouvelle observation de capacité. Si l’opérateur a abaissé la capacité sous ton total actuel, réduis les limites avant d’enregistrer à nouveau. Lorsque les allocations de l’organisation elles-mêmes ne peuvent pas être chargées, les champs restent indisponibles au lieu de présenter des valeurs par défaut modifiables.

## Lire les mesures d’infrastructure

<Frame caption="Sandboxes du déploiement indique le nombre actuel et la capacité partagée. Sandboxes de ton organisation compte aussi les environnements inactifs conservés pour être réutilisés.">

![La section de capacité affiche le nombre de sandboxes de toutes les organisations par rapport à la capacité totale, le nombre propre à l’organisation et les mesures du CPU et de la mémoire de l’hôte.](/images/platform/sandbox-infrastructure-capacity.webp)

</Frame>

| Mesure | Signification |
| --- | --- |
| Sandboxes du déploiement | Environnements actifs ou au démarrage de toutes les organisations, rapportés à la capacité partagée. Kubernetes mesure le namespace. |
| Sandboxes de ton organisation | Environnements actifs ou au démarrage de ton organisation, y compris les environnements inactifs conservés pour réutilisation. C’est un nombre, pas une seconde limite. |
| Utilisation du CPU de l’hôte | Cœurs récemment utilisés et total des cœurs, autres services de l’hôte compris. |
| Mémoire de l’hôte utilisée | Mémoire utilisée et totale, autres services compris et cache récupérable pris en compte. |

Les mesures s’actualisent toutes les 15 secondes. **Actualiser** demande une nouvelle observation ; vérifie sa date avant de l’interpréter. L’utilisation du CPU est la différence entre deux relevés ; la première observation après une longue interruption prend environ une seconde de plus. Un hôte distant peut fournir les totaux sans l’utilisation. L’accès au namespace Kubernetes ne fournit pas les mesures de l’hôte. **Indisponible** signifie inconnu, pas zéro.

## Distinguer allocation et environnement inactif

Les Propriétaires et Admins peuvent examiner les espaces de travail. Chaque ligne identifie l’agent ou l’exécution, l’état de l’environnement, celui de l’allocation et les tâches en cours. Ces états répondent à des questions différentes : un conteneur peut rester actif pour être réutilisé après avoir libéré sa place dans l’organisation. L’espace de travail d’un agent de projet reste affiché tant que l’agent est inactif, avec l’état **Arrêtée** et **Quota libéré**, jusqu’à ce que tu le supprimes ou que Tale le supprime : quand personne ne l’a utilisé pendant [le nombre de jours fixé par ton organisation](#delete-unused-workspaces-automatically), ou quand [son agent, son projet ou le membre concerné est retiré](#explain-why-a-workspace-disappeared). Si l’agent lui-même a été supprimé, la ligne indique **Agent supprimé** jusqu’à ce que Tale ait supprimé l’espace. L’espace d’une exécution de workflow est récupéré peu après la fin de l’exécution.

Les dépenses additionnent le coût mesuré des échanges terminés. Un échange en cours est ajouté lorsqu’il se termine. Les environnements temporaires du crawler comptent dans la capacité même sans ligne d’espace de travail permanent.

Si le déploiement est plein, Tale peut récupérer un environnement inactif non épinglé, dont l’allocation est libérée et qui confirme n’avoir aucun travail en cours. Ses fichiers persistants restent disponibles au prochain démarrage. Les environnements occupés, épinglés ou sans réponse sont exclus. Sans candidat approprié, le nouveau travail doit attendre de la capacité.

## Gérer un espace de travail existant

Les Propriétaires et Admins disposent du menu de chaque ligne :

| Action | Effet |
| --- | --- |
| **Arrêter la tâche** | Annule toutes les opérations en cours dans cet espace. Vérifie les tâches affichées : un agent peut en traiter plusieurs. |
| **Épingler** / **Détacher** | Exempte l’espace du nettoyage automatique pour inactivité ou expiration et de la suppression pour cause d’inutilisation, ou rétablit ce nettoyage. Une allocation épinglée peut continuer à occuper de la capacité. Si l’environnement d’un espace épinglé disparaît, par exemple après un redémarrage de l’hôte, Tale le relance avec ses fichiers, et l’espace reste épinglé. |
| **Supprimer** | Demande confirmation, puis retire la sandbox avec ses fichiers en arrière-plan : l’espace est d’abord détaché et le travail en cours annulé. Tant que l’espace n’a pas disparu, sa ligne indique **Suppression…** et tu peux continuer à utiliser la page. Si Tale ne parvient toujours pas à le retirer après plusieurs tentatives, il reste dans la liste, détaché, et indique **Non supprimée** ; choisis alors de nouveau **Supprimer** pour le retirer complètement. Tant que la ligne indique **Suppression…**, rien de nouveau ne démarre dans cet espace : l’exécution d’un agent attend et indique **En attente d’une place de sandbox**, et une étape d’exécution de workflow qui a besoin de l’espace échoue en indiquant la raison. Une fois la ligne disparue, le démarrage suivant crée un environnement neuf ; si elle indique **Non supprimée** à la place, le travail en attente reprend dans les anciens fichiers. |

Arrête la tâche si le travail doit cesser mais que ses fichiers doivent rester. Avant une suppression, conserve les résultats nécessaires et lis la confirmation. La récupération automatique de capacité inactive préserve les fichiers ; la suppression explicite ou automatique les retire.

## Supprimer automatiquement les espaces de travail inutilisés {#delete-unused-workspaces-automatically}

Un agent de projet garde ses fichiers d’une exécution à l’autre dans des espaces de travail : celui qu’il réutilise pour toutes ses tâches, et un espace distinct pour chaque Membre qui [démarre ses exécutions](/fr/platform/projects/tasks#executions-demarrees-par-un-membre). Tale supprime un espace de travail que personne n’a utilisé pendant le nombre de jours fixé par ton organisation ; **Supprimer** retire toujours un espace immédiatement. Les Propriétaires et Admins définissent cette règle dans **Nettoyage des espaces de travail**, juste au-dessus de la liste **Espaces de travail**. Les Développeurs ne voient pas cette section.

<Frame caption="Quand Supprimer les espaces de travail inutilisés est activé, Tale supprime un espace de travail que personne n’a utilisé pendant le nombre de jours fixé. Les espaces épinglés sont conservés.">

![La section Nettoyage des espaces de travail montre l’interrupteur Supprimer les espaces de travail inutilisés activé et la valeur 30 dans Jours sans utilisation, chacun accompagné de l’explication de son effet.](/images/platform/sandbox-workspace-cleanup.webp)

</Frame>

1. Laisse **Supprimer les espaces de travail inutilisés** activé, comme par défaut. Tant que ce réglage est désactivé, Tale ne supprime aucun espace de travail pour cause d’inutilisation.
2. Dans **Jours sans utilisation**, saisis un entier de 1 à 3650 ; la valeur par défaut est 30. Les jours se comptent à partir de la dernière fois que l’agent a travaillé dans l’espace de travail, ou de son détachement.
3. Choisis **Enregistrer** dans l’en-tête. **Abandonner** rétablit les valeurs enregistrées.

Une modification ne fait jamais disparaître un espace de travail avant l’heure. Quand tu actives la suppression ou raccourcis la période, aucun espace de travail n’est supprimé pour cause d’inutilisation avant que ce nombre de jours ne se soit entièrement écoulé depuis la modification. La même attente suit la mise à jour qui a introduit ce réglage. Allonger la période ne relance pas cette attente ; désactiver puis réactiver la suppression la relance.

Dans la liste **Espaces de travail**, un espace d’agent arrêté affiche sous son état le jour de sa suppression : **Suppression prévue le …, sauf nouvelle utilisation**. Une nouvelle exécution dans l’espace relance le décompte. Un espace épinglé, ou protégé par une [conservation juridique](/fr/platform/admin/governance/legal-hold), n’affiche aucune date et n’est jamais supprimé pour cause d’inutilisation.

## Comprendre pourquoi un espace de travail a disparu {#explain-why-a-workspace-disappeared}

En plus des espaces inutilisés, Tale supprime un espace de travail dès que ce à quoi il appartient est retiré, quel que soit le réglage de nettoyage :

- La suppression d’un agent de projet efface tous ses espaces de travail, y compris ceux des Membres. La suppression d’un projet fait de même pour chacun de ses agents.
- [Retirer un membre](/fr/platform/admin/members-and-roles#retirer-ou-retablir-lacces) de l’organisation supprime ses propres espaces de travail avec tous les agents. Si tu le passes plutôt en **Désactivé**, ils sont conservés.
- [Effacer les données d’une personne](/fr/platform/admin/governance/data-subject-requests) supprime ses propres espaces de travail sans attendre la fin du travail qui s’y exécute.
- La suppression de l’organisation efface toutes ses sandboxes et leurs fichiers, révoque les clés de passerelle qui leur ont été remises, déconnecte ses [appareils](/fr/platform/admin/sandbox-devices) et retire les caches de compilation et de paquets conservés pour elle.

Cela se produit en une minute environ ou, si une tâche s’exécute encore dans l’espace, après la fin de celle-ci. Un espace épinglé est supprimé lui aussi, mais une [conservation juridique](/fr/platform/admin/governance/legal-hold) garde tous les espaces de travail qu’elle couvre : celle de l’organisation les garde tous, celle qui vise une personne garde les espaces de travail propres à cette personne. Un nettoyage exécuté toutes les heures supprime aussi les restes que plus rien ne possède, comme l’espace d’une exécution de workflow jamais récupéré.

Chaque espace de travail que Tale supprime de lui-même, pour l’une de ces raisons ou pour cause d’inutilisation, apparaît dans le [journal d’audit](/fr/platform/admin/governance/audit-logs), sous **Paramètres > Gouvernance > Journaux**, avec l’action **Espace de travail de sandbox supprimé**. C’est un événement système de la catégorie **Données**, dont les métadonnées indiquent la raison : `agent_deleted`, `member_removed`, `member_erased`, `unused` ou `orphaned`. L’événement est enregistré une fois que Tale a confirmé la suppression des fichiers de l’espace, ce qui peut prendre un moment pour un grand espace. Si leur suppression échoue, l’événement apparaît avec le statut **Échec**, et Tale réessaie au nettoyage suivant jusqu’à ce que les fichiers aient disparu.

## Résoudre un démarrage bloqué

Augmente une limite uniquement lorsque ses allocations sont occupées et que le nouveau total tient dans la capacité partagée. Si le déploiement est plein, augmenter la limite de l’organisation ne crée pas d’infrastructure. Pour ajouter ta propre capacité, [connecte un appareil](/fr/platform/admin/sandbox-devices) : les nouveaux espaces de travail y démarrent. Sinon, demande à l’opérateur d’examiner la capacité et les ressources de l’hôte. Une place libre ne garantit pas assez de CPU ou de mémoire.

Pour un refus d’identifiants ou de modèle, consulte [Fournisseurs IA](/fr/platform/admin/providers). Pour un refus de dépense, consulte [Politiques et limites](/fr/platform/admin/governance/policies-and-limits). Les opérateurs auto-hébergés trouveront le réglage du déploiement dans la [référence d’environnement](/fr/self-hosted/configuration/environment-reference#sandbox-infrastructure).
