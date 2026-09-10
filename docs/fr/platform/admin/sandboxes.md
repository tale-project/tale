---
title: Sandboxes
description: Fixe les limites de travail simultané et compare les quotas occupés aux environnements actifs et aux ressources de l’hôte.
---

Sandboxes indique combien de tâches ton organisation peut démarrer et quelles ressources sont déjà occupées. Ouvre **Paramètres > Sandboxes** en tant qu’Admin ou Propriétaire pour modifier les limites ; les Développeurs consultent les limites et la capacité globale, sans accéder aux détails des espaces privés.

<Frame caption="Les limites de l’organisation se modifient ici. Sans connexion à l’infrastructure sandbox, les mesures manquantes restent signalées comme indisponibles.">

![Les paramètres Sandboxes affichent les trois limites de l’organisation, leurs quotas occupés et des cartes distinctes dont les mesures d’infrastructure sont indisponibles.](/images/platform/settings-sandboxes.webp)

</Frame>

## Limiter le travail simultané

Modifie une limite, puis clique sur **Enregistrer** en haut de la page. **Abandonner** rétablit les valeurs enregistrées. Chaque limite accepte un entier de 1 à 500 et s’applique aux prochains démarrages. La réduire n’interrompt pas le travail en cours.

| Travail | Valeur par défaut | Ce qui occupe un quota |
| --- | --- | --- |
| Agents de projet | 2 | L’espace d’un agent au démarrage ou pendant le travail ; le même agent le réutilise pour ses tâches suivantes. |
| Workflows | 4 | L’espace d’une exécution, partagé par ses étapes d’agent et de script. |
| Rendu | 4 | Les environnements temporaires qui rendent les pages web pendant l’exploration. |

L’indicateur d’allocation compare les places occupées à la limite enregistrée. Si les données d’allocation manquent, les champs restent indisponibles au lieu de proposer des valeurs par défaut modifiables.

## Lire la capacité réelle

La capacité de l’infrastructure s’actualise toutes les 15 secondes. **Actualiser** demande une nouvelle observation. Ces chiffres décrivent une autre limite que les quotas de l’organisation :

| Mesure | Signification |
| --- | --- |
| Places de session sur l’hôte | Les environnements actifs ou en démarrage de toutes les organisations, comparés au plafond du déploiement. Sous Kubernetes, le périmètre est le Namespace. |
| Places d’exécution de ton organisation | Les environnements actifs ou en démarrage de ton organisation, tous types de travail confondus, comparés au plafond du déploiement. |
| Utilisation du CPU de l’hôte | Les cœurs récemment utilisés et le nombre total de cœurs, y compris les autres services. |
| Mémoire de l’hôte utilisée | La mémoire utilisée et totale en Gio, y compris les autres services, en tenant compte des caches récupérables. |

L’heure de l’observation indique l’âge des données. Le CPU exige deux mesures récentes ; après une longue pause, son utilisation peut être indisponible. Un hôte distant peut fournir les totaux sans l’utilisation, et l’accès à un Namespace Kubernetes ne donne pas les mesures des hôtes. Un échec de lecture s’affiche comme indisponible, jamais comme une utilisation nulle.

## Comprendre l’allocation des espaces

Les Admins et Propriétaires voient aussi les espaces de travail, leur agent ou Workflow et l’opération courante. Un quota libéré peut correspondre à un environnement encore actif : le travail est terminé et la place de l’organisation est libre, mais le conteneur reste prêt jusqu’au nettoyage des environnements inactifs. L’état d’exécution et l’allocation apparaissent donc séparément.

Les environnements d’exploration sont temporaires. Ils comptent dans la capacité même sans ligne d’espace permanent.

## Choisir la limite à modifier

Augmente une limite d’organisation lorsque le quota concerné est plein et que le déploiement dispose encore de ressources. Cela n’ajoute ni CPU ni mémoire ; une place d’exécution libre ne garantit pas non plus les ressources nécessaires. L’opérateur fixe les plafonds d’exécution. Pour une installation auto-hébergée, consulte la [référence des variables d’environnement](/fr/self-hosted/configuration/environment-reference). Les budgets de tokens et de dépenses restent dans [Politiques et limites](/fr/platform/admin/governance/policies-and-limits).
