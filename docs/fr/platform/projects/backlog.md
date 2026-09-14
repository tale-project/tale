---
title: Trier le backlog du projet
description: Recueille les propositions, décide lesquelles retenir et distingue l’affectation du démarrage du travail.
---

Utilise **Backlog** pour les propositions sur lesquelles l’équipe ne s’est pas encore engagée. Ce statut ordinaire apparaît en premier dans le tableau et la liste. Une proposition peut déjà être affectée à quelqu’un ; cette affectation ne signifie pas que le travail a commencé.

## Enregistrer une proposition

Ouvre les **Tâches** du projet et crée une tâche. Choisis **Backlog** dans le sélecteur de statut ; sinon, une nouvelle tâche commence avec **À faire**. Donne-lui un titre qui décrit le résultat recherché et assez de contexte pour décider si la proposition mérite d’être suivie.

Par exemple, « Examiner l’erreur du paiement mobile » se juge mieux avec la page concernée, un symptôme reproductible et une capture d’écran qu’avec un titre seul. Attends de comprendre le problème avant de préciser la solution technique.

Un agent de projet équipé de l’outil de création de tâches peut aussi déposer une proposition. Cet outil autorise **Backlog** ou **À faire** comme statut initial, pas un statut de travail en cours ou terminé. La même limite s’applique aux automatisations qui utilisent les outils de tâches du projet.

## Décider de la suite

| Décision | Action |
| --- | --- |
| Il manque des informations | Garde **Backlog** et précise ce qui manque dans la description ou un commentaire. |
| L’équipe accepte le travail | Choisis **À faire** et affecte la tâche. |
| Le travail a commencé | Passe à **En cours**. |
| La proposition ne sera pas suivie | Choisis **Annulé** pour conserver la discussion. |

Change le statut dans le détail de la tâche ou déplace la carte entre les colonnes. Ce sont les commandes habituelles des tâches : le backlog n’a pas de procédure distincte d’acceptation ou de rejet.

## Confier la tâche à un agent

Choisis un agent du même projet et précise le résultat attendu avant de sélectionner **Démarrer l'agent**. L’affectation ne remplace pas cette action de démarrage. L’[automatisation des tâches](/fr/platform/projects/task-automation) explique les prérequis, le suivi et la vérification du résultat.

## Comprendre l’origine des propositions

L’automatisation fournie **Trier les issues GitHub** renvoie un rapport classé par priorité. Elle ne crée pas de tâches et ne remplit pas automatiquement le backlog. Une personne ou un agent correctement équipé doit transformer une issue retenue en tâche. Le rapport recommande ainsi du travail ; son acceptation reste une décision distincte.

Le guide [Gérer les tâches du projet](/fr/platform/projects/tasks) couvre les détails, les commentaires, les dépendances et les autres fonctions du tableau.
