---
title: Gérer la capacité des sandboxes
description: Ajuste les limites de travail simultané, interprète les mesures et examine un démarrage de sandbox bloqué.
---

Ouvre **Paramètres > Sandboxes** lorsqu’un agent ou une analyse de site ne peut pas obtenir d’environnement d’exécution. La page distingue les limites de travail de ton organisation de l’infrastructure réelle du déploiement. Les Propriétaires et Admins peuvent modifier les limites. Les Développeurs lisent les limites et la capacité globale, sans accéder aux détails privés des espaces de travail.

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

Les valeurs initiales totalisent 6. Avec une capacité de déploiement de 8, un total de 8 est accepté et 9 est refusé. Le serveur vérifie à nouveau la capacité à l’enregistrement ; sa valeur peut donc différer de la première observation.

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

Les mesures s’actualisent toutes les 15 secondes. **Actualiser** demande une nouvelle observation ; vérifie sa date avant de l’interpréter. Le CPU nécessite deux relevés et peut manquer après une longue interruption. Un hôte distant peut fournir les totaux sans l’utilisation. L’accès au namespace Kubernetes ne fournit pas les mesures de l’hôte. **Indisponible** signifie inconnu, pas zéro.

## Distinguer allocation et environnement inactif

Les Propriétaires et Admins peuvent examiner les espaces de travail. Chaque ligne identifie l’agent ou l’exécution, l’état de l’environnement, celui de l’allocation et les tâches en cours. Ces états répondent à des questions différentes : un conteneur peut rester actif pour être réutilisé après avoir libéré sa place dans l’organisation. L’espace de travail d’un agent de projet reste affiché tant que l’agent est inactif, avec l’état **Arrêtée** et **Quota libéré**, et ne disparaît que lorsque tu le supprimes. L’espace d’une exécution de workflow est récupéré peu après la fin de l’exécution.

Les dépenses additionnent le coût mesuré des échanges terminés. Un échange en cours est ajouté lorsqu’il se termine. Les environnements temporaires du crawler comptent dans la capacité même sans ligne d’espace de travail permanent.

Si le déploiement est plein, Tale peut récupérer un environnement inactif non épinglé, dont l’allocation est libérée et qui confirme n’avoir aucun travail en cours. Ses fichiers persistants restent disponibles au prochain démarrage. Les environnements occupés, épinglés ou sans réponse sont exclus. Sans candidat approprié, le nouveau travail doit attendre de la capacité.

## Gérer un espace de travail existant

Les Propriétaires et Admins disposent du menu de chaque ligne :

| Action | Effet |
| --- | --- |
| **Arrêter la tâche** | Annule toutes les opérations en cours dans cet espace. Vérifie les tâches affichées : un agent peut en traiter plusieurs. |
| **Épingler** / **Détacher** | Exempte l’espace du nettoyage automatique pour inactivité ou expiration, ou rétablit ce nettoyage. Une allocation épinglée peut continuer à occuper de la capacité. |
| **Supprimer** | Demande confirmation, annule le travail et retire la sandbox avec ses fichiers. Le prochain démarrage de l’agent crée un environnement neuf. |

Arrête la tâche si le travail doit cesser mais que ses fichiers doivent rester. Avant une suppression, conserve les résultats nécessaires et lis la confirmation. La récupération automatique de capacité inactive préserve les fichiers ; la suppression explicite les retire.

## Résoudre un démarrage bloqué

Augmente une limite uniquement lorsque ses allocations sont occupées et que le nouveau total tient dans la capacité partagée. Si le déploiement est plein, augmenter la limite de l’organisation ne crée pas d’infrastructure. Demande à l’opérateur d’examiner la capacité et les ressources de l’hôte. Une place libre ne garantit pas assez de CPU ou de mémoire.

Pour un refus d’identifiants ou de modèle, consulte [Fournisseurs IA](/fr/platform/admin/providers). Pour un refus de dépense, consulte [Politiques et limites](/fr/platform/admin/governance/policies-and-limits). Les opérateurs auto-hébergés trouveront le réglage du déploiement dans la [référence d’environnement](/fr/self-hosted/configuration/environment-reference#sandbox-infrastructure).
