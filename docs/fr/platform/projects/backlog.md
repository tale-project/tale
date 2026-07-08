---
title: Backlog du projet
description: L’onglet Backlog garde les tâches qu’une automatisation ou un coéquipier a proposées mais que personne n’a encore validées — Démarrer en met une sur le tableau, Fermer l’écarte, et ni l’une ni l’autre ne touche aux automatisations qui l’ont alimentée.
---

L’onglet **Backlog** d’un projet garde chaque tâche au statut `backlog` — du travail proposé que personne n’a encore validé, le plus souvent synchronisé par une automatisation comme [Trier les issues GitHub](/fr/platform/automations/builtin). Cette page couvre l’onglet lui-même : à quoi ressemble une tâche de backlog, les deux actions de tri, et ce qui la distingue des vues Tableau et Liste. [Automatisation des tâches](/fr/platform/projects/task-automation) couvre ce qui se passe une fois qu’une tâche quitte le backlog et entre dans la boucle d’affectation.

## Une tâche synchronisée

Trier les issues GitHub propose une tâche par issue ouverte exploitable, rattachée à l’issue pour qu’une synchronisation ultérieure ne la crée jamais en double : le titre est `#<numéro> <titre>` — par exemple `#482 Bouton de connexion mal aligné sur Safari` —, la description s’ouvre sur l’URL GitHub de l’issue elle-même, et ses étiquettes reflètent celles de l’issue sur GitHub. Une tâche que tu crées toi-même n’atterrit jamais ici — le Backlog ne se remplit qu’à partir des automatisations et des coéquipiers qui y proposent explicitement du travail ; une tâche que tu ajoutes depuis le tableau démarre sur le tableau.

## Démarrer et Fermer

Chaque ligne de backlog porte deux actions. **Démarrer** déplace la tâche vers **À faire** et sur le tableau — de là, elle suit le même [pack task-ops](/fr/platform/projects/task-automation) que toute autre tâche, y compris le triage des non-affectées qui lui choisit un agent si personne ne la réclame à la main. **Fermer** la déplace directement vers **Annulé** sans jamais toucher au tableau — le bon choix pour une tâche proposée qui ne vaut pas la peine d’être faite. Cliquer sur la ligne ouvre la même fiche de tâche que le tableau et la liste ; Démarrer et Fermer sont aussi accessibles depuis là.

## Tableau et Liste excluent le backlog

Tableau et Liste ne montrent jamais une tâche au statut `backlog` — tout l’intérêt de l’onglet est de garder les propositions non validées hors des vues où ton équipe travaille au quotidien. Une tâche n’apparaît sur le tableau qu’une fois Démarrée, donc un Backlog chargé n’encombre jamais le tableau.

## Où cela s’inscrit

Backlog est l’étape de tri entre une automatisation qui propose du travail et un humain qui s’engage dessus : Démarrer fait entrer une tâche dans la même boucle d’exécution que toute autre, Fermer écarte ce qui ne vaut pas la peine. La lecture suivante naturelle est [Automatisation des tâches](/fr/platform/projects/task-automation) pour ce que déclenche vraiment Démarrer, ou [Automatisations livrées](/fr/platform/automations/builtin) pour ce qui propose des tâches en premier lieu.
