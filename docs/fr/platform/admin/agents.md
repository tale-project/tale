---
title: Agents (vue Admin)
description: Quels agents existent dans cette version et comment un admin les gouverne — les agents de projet sur l’onglet Agents de chaque projet, et les personas d’agent sous forme de fichiers dans la configuration de l’organisation.
---

Il n’y a pas d’annuaire **Paramètres > Agents** à l’échelle de l’organisation dans cette version de Tale, ni d’écran de politique ou de propriété par agent. Les agents vivent à deux endroits : les **agents de projet**, l’équipe nommée qu’un projet constitue sur son onglet **Agents** et met au travail sur les tâches du tableau, et les **personas d’agent**, des fichiers de configuration que la plateforme lit dans l’arbre de configuration de l’organisation et sert par sa propre API. Cette page est la carte de l’admin pour les deux — où vit chaque sorte, qui peut la modifier, et quels leviers un Propriétaire ou un Admin tient réellement.

Construire un agent se lit ailleurs : [Agents de projet](/fr/platform/projects/project-agents) parcourt le dialogue, et [Concepts d’agent](/fr/platform/agents/concepts) explique ce qu’une persona porte. Ce qui suit, c’est le versant gouvernance.

## Agents de projet — les agents qui ont un écran

L’onglet **Agents** d’un projet liste ses agents : chaque ligne nomme un [harness](/fr/platform/agents/harnesses) de code, le fournisseur qui sert son modèle, le modèle lui-même et l’étendue de son équipement. Quiconque a le droit d’éditer le projet les crée, les modifie et les supprime — jusqu’à 50 par projet — et la liste d’équipement suit l’accès d’équipe du projet, pas la visibilité personnelle de l’éditeur. Un agent se met au travail quand tu lui assignes une tâche du tableau et cliques sur **Démarrer l'agent** ; il travaille dans une sandbox isolée et gare le résultat en **En revue** jusqu’à ce qu’une personne l’accepte.

Les leviers de l’admin sont un niveau au-dessus, sur l’organisation :

- **Les fournisseurs** décident sur quels modèles et quels accès un agent peut être créé ; un modèle dont le fournisseur ne peut plus le servir fait échouer l’exécution avec la raison, au lieu de changer de facture en silence. Gère-les sous **Paramètres > Fournisseurs IA** — voir [Fournisseurs](/fr/platform/admin/providers).
- **Les connectors et les skills** décident de ce dont un agent peut être équipé. Connecte des services sous **Paramètres > Connectors**, entretiens les bundles sous **Paramètres > Skills**.
- **Les secrets** qu’un agent reçoit en variables d’environnement appartiennent à l’organisation : chiffrés, jamais réaffichés, réutilisés d’un agent à l’autre — tu en fais tourner un à un seul endroit.
- **Les budgets et les politiques** plafonnent la dépense et filtrent les actions à l’échelle de l’organisation ; voir [Politiques et limites](/fr/platform/admin/governance/policies-and-limits).
- **L’appartenance au projet** décide qui peut éditer l’équipe d’un projet — [Membres et rôles](/fr/platform/admin/members-and-roles) couvre les rôles, [Équipes](/fr/platform/admin/teams) les accès d’équipe.

## Personas d’agent — de la configuration, pas un écran

Une persona est un fichier YAML dans la configuration de l’organisation : un slug, un nom affiché et une description, leurs versions par langue en option, des instructions, une liste d’autorisation d’outils et une de skills, une portée de connaissances, et une **visibilité** `private` ou `org` avec un propriétaire enregistré. Chaque organisation en reçoit une, `coding-agent`. Aucun écran de cette version ne liste, n’édite ni ne choisit une persona — le composer du chat n’a pas de sélecteur d’agent, et l’assistant de chat tourne avec un jeu d’outils fixe, en lecture seule — les personas passent donc par l’arbre de configuration et par l’API propre de la plateforme.

Les règles que l’API applique sont celles qu’un admin doit connaître :

- **Qui voit quoi.** Une persona `org` est visible de chaque membre. Une persona `private` n’est visible que de son propriétaire — un Propriétaire ou un Admin ne peut pas la lire, et la demander répond comme si elle n’existait pas.
- **Qui modifie quoi.** Le propriétaire, toujours. Les Propriétaires et les Admins — quiconque peut écrire les paramètres de l’organisation — modifient et suppriment chaque persona `org`, pour qu’un membre qui part ne laisse pas de configuration partagée orpheline.
- **La propriété par adoption.** Une nouvelle persona appartient à qui l’a créée et démarre `private` ; repasser en `private` une persona partagée sans propriétaire enregistré fait de l’éditeur son propriétaire, parce qu’une persona privée que personne ne possède ne serait joignable par personne.
- **L’historique.** Chaque enregistrement garde le fichier remplacé dans une piste d’historique, et restaurer une entrée antérieure sauvegarde d’abord l’actuelle — une restauration s’ajoute, elle ne détruit jamais. Une persona qui ne se parse pas est signalée avec son chemin plutôt que retirée en silence de la liste.

Les opérateurs auto-hébergés atteignent les fichiers directement — la disposition du projet est sur [Développement assisté par IA](/fr/develop/ai-assisted-development) et la CLI sur [Installer la CLI tale](/fr/self-hosted/install/cli-install).

## Où cela se place

La gouvernance des agents est indirecte à dessein dans cette version : tu façonnes ce que chaque agent peut utiliser — fournisseurs, connectors, skills, secrets, budgets — et qui peut éditer chaque projet, au lieu d’éditer les agents un par un. Le travail quotidien se passe sur l’onglet **Agents** de chaque projet, parcouru dans [Agents de projet](/fr/platform/projects/project-agents) ; le modèle de persona est dans [Concepts d’agent](/fr/platform/agents/concepts) ; et les rôles derrière les règles ci-dessus, dans [Membres et rôles](/fr/platform/admin/members-and-roles).
