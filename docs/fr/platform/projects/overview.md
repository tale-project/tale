---
title: Projets
description: Réunis les références, les conversations et les tâches de ton équipe autour d’un travail commun.
---

Un projet regroupe les fichiers, instructions, conversations et tâches d’un même travail. Utilise-le lorsque le contexte doit durer au-delà d’un chat ou qu’un résultat a besoin d’un responsable et d’une relecture. Commence par [Utiliser les projets](/fr/tutorials/member/use-projects) pour créer un projet et poser une question sur son fichier de référence.

<Video src="/videos/fr/tutorials/ep6-projects/ep6-projects.fr.mp4" poster="/videos/fr/tutorials/ep6-projects/ep6-projects.fr.webp" captions="/videos/fr/tutorials/ep6-projects/ep6-projects.fr.vtt" lang="fr" title="Épisode 6 — Les projets avec l'IA" caption="Épisode 6 — Les projets avec l'IA (2:21)">

</Video>

<Frame caption="Le tableau réunit les propositions, le travail en cours et les résultats à relire.">

![Website relaunch présente des tâches dans les colonnes Backlog, À faire, En cours, En revue, Terminé et Annulé.](/images/platform/projects-task-board.webp)

</Frame>

## Trouver la prochaine étape

<CardGroup cols="2">

<Card title="Comprendre l’accès au projet" icon="compass" href="/fr/platform/projects/concepts">
Distingue ce qui est partagé, les chats personnels et les accès accordés par les équipes.
</Card>

<Card title="Gérer les fichiers de référence" icon="folder-open" href="/fr/platform/projects/manage-files">
Importe et classe les fichiers, vérifie l’indexation et gère les révisions maîtrisées.
</Card>

<Card title="Créer et suivre les tâches" icon="list-checks" href="/fr/platform/projects/tasks">
Définis le responsable, le relecteur, les dates et les critères d’acceptation, puis suis l’avancement.
</Card>

<Card title="Configurer un agent de projet" icon="bot" href="/fr/platform/projects/project-agents">
Choisis l’environnement d’agent, le modèle, les outils et les instructions d’un agent capable de prendre des tâches.
</Card>

<Card title="Lancer et relire le travail d’un agent" icon="workflow" href="/fr/platform/projects/task-automation">
Démarre une tâche, relis le résultat, demande une reprise et traite les échecs d’exécution.
</Card>

<Card title="Examiner les propositions" icon="gauge" href="/fr/platform/projects/backlog">
Utilise le Backlog pour étudier les idées avant de les intégrer au travail prévu de l’équipe.
</Card>

</CardGroup>

Tous les projets que tu peux ouvrir figurent sous **Projets** dans [Accueil](/fr/platform#home), où **Tous les projets** ouvre la liste complète. Un projet s’ouvre sur son tableau des tâches ; **Général**, **Chats**, **Connaissances** et **Agents** complètent les vues des tâches. Pour les propriétaires, les admins et les développeurs, une automatisation liée au projet ajoute l’espace **Automatisations** ; les administrateurs du projet peuvent configurer l’[**Environnement**](#environment-credentials). Les applications installées peuvent ajouter d’autres onglets. Elles ne sont pas nécessaires pour commencer avec les fichiers, les chats et les tâches.

## Identifiants du projet {#environment-credentials}

Ouvre l’onglet **Environnement** du projet pour y stocker des identifiants chiffrés. Seuls les administrateurs du projet voient cet onglet et peuvent consulter les noms enregistrés ou gérer les identifiants. Dans un projet archivé, l’onglet est en lecture seule. Restaure le projet avant de modifier les identifiants.

Choisis **Ajouter une variable**, saisis un nom comme `SERVICE_TOKEN` et sa valeur, puis choisis **Enregistrer**. L’éditeur exige des noms uniques conformes à `^[A-Za-z_][A-Za-z0-9_]*$` : lettres, chiffres et tirets bas, sans chiffre au début. Le serveur convertit aussi les noms en majuscules et exige une lettre au début et un maximum de 64 caractères. Utilise donc des noms en majuscules commençant par une lettre. Deux noms qui ne diffèrent que par la casse désignent le même identifiant enregistré.

Les valeurs enregistrées ne sont jamais réaffichées. Pour en remplacer une, saisis la nouvelle valeur dans la ligne existante et choisis **Enregistrer**. Pour en supprimer une, choisis **Supprimer**, confirme, puis choisis **Enregistrer**.

L’onglet décrit des identifiants destinés aux runtimes de tâches comme Hermes et OpenClaw. Cependant, les identifiants du projet sont actuellement stockés sans être injectés dans les exécutions d’agents. Pour fournir des variables d’environnement à un agent en cours d’exécution, utilise les identifiants de l’organisation accordés sous **Secrets** lors de la [configuration de l’agent](/fr/platform/projects/project-agents#configurer-lagent). Ces autorisations fournissent les valeurs au runtime à l’exécution, y compris aux nœuds d’agent d’une automatisation disposant de leurs propres autorisations. Une exécution démarrée par un Membre n’en reçoit aucune. L’assistant Chat ordinaire ne reçoit pas ces variables d’environnement.

Si la liste des identifiants ne peut pas être chargée à l’ouverture, l’éditeur reste masqué. Choisis **Réessayer** avant de modifier quoi que ce soit. Si une actualisation échoue, la dernière liste et ton brouillon restent affichés, avec un avertissement indiquant que l’affichage peut être périmé.
