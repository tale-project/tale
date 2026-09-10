---
title: Sandboxes
description: Fixe les limites de travail simultané et compare les quotas occupés aux environnements actifs et aux ressources de l’hôte.
---

Sandboxes indique combien de tâches ton organisation peut démarrer et quelles ressources sont déjà occupées. Ouvre **Paramètres > Sandboxes** en tant qu’Admin ou Propriétaire pour modifier les limites ; les Développeurs consultent les limites et la capacité globale, sans accéder aux détails des espaces privés.

<Frame caption="Le total des trois limites de travail se recalcule automatiquement. Il ne doit pas dépasser la capacité du déploiement.">

![La section des limites de l’organisation affiche trois limites de sessions modifiables et leur total calculé par rapport à la capacité du déploiement.](/images/platform/settings-sandboxes.webp)

</Frame>

## Limiter le travail simultané

Modifie une limite, puis clique sur **Enregistrer** en haut de la page. **Abandonner** rétablit les valeurs enregistrées. Chaque limite accepte un entier de 1 à 500 et s’applique aux prochains démarrages. La réduire n’interrompt pas le travail en cours.

**Total des sessions de ton organisation** compare la somme des trois limites à la capacité du déploiement et se met à jour pendant la saisie. Les valeurs par défaut donnent **2 + 2 + 2 = 6**. Avec une capacité de 8, tu peux enregistrer un total de 8 ; un total de 9 bloque l’enregistrement et demande de réduire une limite. Le serveur vérifie à nouveau la capacité actuelle au moment d’enregistrer. Si elle est indisponible, tu peux toujours abaisser les limites ; actualise les données de l’infrastructure avant d’en augmenter une. Si l’opérateur abaisse la capacité sous ton total enregistré, réduis les limites avant d’enregistrer à nouveau.

| Travail | Valeur par défaut | Ce qui occupe un quota |
| --- | --- | --- |
| Sessions d'agent de projet | 2 | L’espace d’un agent au démarrage ou pendant le travail ; le même agent le réutilise pour ses tâches suivantes. |
| Sessions de workflow | 2 | L’espace d’une exécution, partagé par ses étapes d’agent et de script. |
| Sessions de rendu | 2 | Les environnements temporaires qui rendent les pages web pendant l’exploration. |

Une exécution de workflow utilise une seule sandbox pour ses étapes d’agent et ses scripts exécutés en sandbox. Chaque exécution simultanée utilise sa propre sandbox et occupe une allocation de workflow, même si toutes lancent le même workflow.

L’indicateur d’allocation compare les places occupées à la limite enregistrée. Si les données d’allocation manquent, les champs restent indisponibles au lieu de proposer des valeurs par défaut modifiables.

## Lire la capacité réelle

La **Capacité de l'infrastructure** s’actualise toutes les 15 secondes. **Actualiser** demande une nouvelle observation. Ces chiffres décrivent une autre limite que les quotas de l’organisation :

<Frame caption="Sandboxes du déploiement indique le nombre actuel et la capacité partagée. Sandboxes de ton organisation compte aussi les environnements inactifs conservés pour être réutilisés.">

![La section de capacité affiche le nombre de sandboxes de toutes les organisations par rapport à la capacité totale, le nombre propre à l’organisation et les mesures du CPU et de la mémoire de l’hôte.](/images/platform/sandbox-infrastructure-capacity.webp)

</Frame>

| Mesure | Signification |
| --- | --- |
| Sandboxes du déploiement | Les environnements actifs ou au démarrage de toutes les organisations / capacité du déploiement. Sous Kubernetes, la carte s’intitule **Sandboxes du déploiement (namespace)**. |
| Sandboxes de ton organisation | Les environnements actifs ou au démarrage de ton organisation, tous types de travail confondus, y compris les environnements inactifs conservés pour être réutilisés. Ce nombre n’a pas de plafond d’exécution distinct pour l’organisation. |
| Utilisation du CPU de l’hôte | Les cœurs récemment utilisés et le nombre total de cœurs, y compris les autres services. |
| Mémoire de l’hôte utilisée | La mémoire utilisée et totale en Gio, y compris les autres services, en tenant compte des caches récupérables. |

L’heure de l’observation indique l’âge des données. Le CPU exige deux mesures récentes ; après une longue pause, son utilisation peut être indisponible. Un hôte distant peut fournir les totaux sans l’utilisation, et l’accès à un Namespace Kubernetes ne donne pas les mesures des hôtes. Un échec de lecture s’affiche comme indisponible, jamais comme une utilisation nulle.

## Comprendre l’allocation des espaces

Les Admins et Propriétaires voient aussi les **Espaces de travail**. Chaque ligne nomme l’agent ou l’exécution de Workflow à qui appartient l’espace, son état d’exécution et d’allocation, et chaque tâche qui y tourne en ce moment. Un agent de projet exécute ses tâches en parallèle dans le seul espace qui lui appartient : une ligne peut donc lister plusieurs tâches alors que la limite de l’organisation ne compte qu’une session. **Coût** additionne le coût mesuré des tours terminés de l’espace ; un tour encore en cours s’ajoute quand il se termine. Un quota libéré peut correspondre à un environnement encore actif : le travail est terminé et la place de l’organisation est libre, mais le conteneur reste prêt jusqu’au nettoyage des environnements inactifs. L’état d’exécution et l’allocation apparaissent donc séparément.

Lorsque la capacité du déploiement est pleine, Tale peut arrêter un environnement inactif, non épinglé et dont l’allocation est libérée pour faire place à un nouveau travail. Les fichiers de son espace persistant restent disponibles au prochain démarrage. L’environnement doit confirmer qu’aucun travail n’est en cours ; les environnements épinglés, occupés ou injoignables sont protégés de cet arrêt. Sans candidat sûr, le nouveau travail a toujours besoin de capacité libre.

Les environnements d’exploration sont temporaires. Ils comptent dans la capacité même sans ligne d’espace permanent.

## Choisir la limite à modifier

Augmente une limite d’organisation lorsque le quota concerné est plein et que le nouveau total respecte la capacité du déploiement. Les autres organisations partagent cette capacité ; tes limites ne réservent ni conteneurs, ni CPU, ni mémoire. Une place libre ne garantit pas les ressources nécessaires pour lancer davantage de travail. L’opérateur fixe la capacité partagée. Pour une installation auto-hébergée, consulte la [référence des variables d’environnement](/fr/self-hosted/configuration/environment-reference#infrastructure-sandbox). Les budgets de tokens et de dépenses restent dans [Politiques et limites](/fr/platform/admin/governance/policies-and-limits).
