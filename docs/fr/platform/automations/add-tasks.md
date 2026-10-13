---
title: Ajouter des tâches depuis une automatisation
description: Crée une tâche dans un projet avec l’étape task.create — titre, personne assignée, statut, échéance et libellés — une fois à chaque exécution de l’étape, liste les tâches d’un projet avec task.list, et sache ce qui est refusé.
---

Utilise une étape `task.create` quand une automatisation doit confier du travail à une personne ou à un agent : une réponse que demande un e-mail, un formulaire à relancer, une vérification qui a échoué. Elle crée la tâche dans un projet où l’automatisation est installée, et la tâche nomme l’automatisation comme sa créatrice. Une exécution en direct la crée ; une exécution de test répond avec un mock.

## Créer une tâche

```yaml
nodes:
  - id: ticket
    type: task.create
    input:
      projectId: '{{ input.projectId }}'
      title: 'Reply to {{ input.from }}'
      description: '{{ input.body }}'
      assignee: ada@example.com
      status: todo
      dueDate: '2026-10-17'
      labels: [support]
```

| Entrée        | Ce qu’elle contient                                                                                                                                                                  |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `projectId`   | Le projet où va la tâche. L’automatisation doit y être installée, et une exécution lancée dans un projet ne crée des tâches que dans celui-ci.                                       |
| `title`       | Le titre de la tâche. Un titre de plus de 200 caractères est coupé et se termine par « … ».                                                                                          |
| `description` | La description de la tâche, en Markdown.                                                                                                                                             |
| `assignee`    | L’e-mail ou l’identifiant d’un membre, ou un agent du projet par son nom ou son identifiant de mention.                                                                              |
| `status`      | `backlog`, par défaut, `todo` ou `in_progress`. La tâche d’un agent créée à `in_progress` lance son exécution.                                                                       |
| `dueDate`     | Une date comme `2026-10-17`, ou une date et une heure ISO. Une date seule tombe ce jour-là dans presque tous les fuseaux horaires.                                                   |
| `labels`      | Des noms de libellés. Le catalogue du projet reçoit ceux qu’il n’a pas encore quand la personne qui a lancé l’exécution peut modifier le projet, ou quand un déclencheur l’a lancée. |

L’étape renvoie `{ taskId, number, title, url }` ; `url` ouvre la tâche dans Tale.

<Frame caption="Une exécution en direct dans Customer onboarding portal : l’étape a lu l’expéditeur et l’objet de l’e-mail dans l’entrée de l’exécution, et a créé la tâche.">

![La page d’une exécution réussie en direct de Follow up on support emails, avec l’étape Ticket sélectionnée, une étape Tasks · Create task. Son onglet Last run indique qu’elle a exécuté task.create et lu from, subject et projectId dans l’entrée de l’exécution ; sous Received figurent le titre de la tâche, une liste de 1 libellé et le statut todo. Sous le canevas, l’exécution liste 1 effect.](/images/platform/automation-task-create-run.webp)

</Frame>

## Une tâche à chaque exécution de l’étape

L’étape crée une tâche à chaque exécution : une fois par exécution, et une fois par élément ou par passage dans une boucle. Quand une exécution est interrompue après la création de la tâche puis reprend, l’étape renvoie la tâche déjà créée au lieu d’en créer une deuxième.

La tâche est créée avec les droits de la personne qui a lancé l’exécution, comme sur le tableau ; une exécution lancée par un déclencheur la crée en tant qu’automatisation. D’autres automatisations peuvent démarrer à sa création, qu’elles voient comme faite par une automatisation.

## Lister les tâches d’un projet

Une étape `task.list` lit les tâches d’un projet, la plus récente d’abord, pour en rendre compte — un récapitulatif quotidien, le nombre de tâches qui attendent une relecture. Elle lit un projet comme une création y est permise, et ne change rien : elle n’attend donc jamais d’approbation.

```yaml
nodes:
  - id: open
    type: task.list
    input:
      projectId: '{{ input.projectId }}'
      status: [todo, in_progress]
      createdSince: '2026-10-17'
      limit: 20
```

| Entrée         | Ce qu’elle contient                                                                                                                                   |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `projectId`    | Le projet à lire.                                                                                                                                     |
| `status`       | Seulement les tâches dans ces statuts — `backlog`, `todo`, `in_progress`, `in_review`, `done` et `cancelled` ; tous les statuts s’il est omis.        |
| `createdSince` | Seulement les tâches créées à partir de ce moment : des millisecondes epoch, une date comme `2026-10-17` (son début, en UTC) ou une date et heure ISO. |
| `limit`        | Au plus ce nombre de tâches, jusqu’à 200 ; 50 s’il est omis.                                                                                          |

L’étape renvoie `{ tasks, hasMore }`. Chaque tâche porte son `taskId`, `number`, `title`, `status`, `priority`, `assignee` (son `type`, `id` et `name`), `dueDate`, `createdAt` et l’`url` qui l’ouvre. Les tâches archivées sont omises, et `hasMore` indique que plus de tâches correspondent que `limit` n’en a renvoyé. Le [modèle d’automatisation](/fr/platform/automations/starters) **Récapitulatif quotidien des tâches** repose dessus.

<Frame caption="L’exécution de Daily task digest, avec son étape Tasks sélectionnée : le projet et le moment à partir duquel elle a lu, et les sept tâches qu’elle a renvoyées.">

![La page d’une exécution réussie en direct de Daily task digest avec l’étape Tasks sélectionnée, une étape Tasks · List tasks. Son onglet Last run indique qu’elle a exécuté task.list et lu since depuis l’étape Window ; sous Received figurent projectId, createdSince et limit 50, et sous Returned une liste de 7 tâches.](/images/platform/automation-task-list-run.webp)

</Frame>

## Lire une tâche et une exécution précise

Une étape `task.get` renvoie normalement le titre, le statut, le projet et la description de la tâche. Ajoute `agentRunId` pour lire une exécution précise de cette tâche. `agentRun` contient alors `id`, `taskId`, `agentId`, `status`, `execId`, `startedAt`, `launchedAt` et `settledAt`. Les horodatages sont en millisecondes depuis l’époque Unix ; les deux derniers peuvent être `null`. Si l’exécution manque ou appartient à une autre tâche ou organisation, la réponse contient `agentRun: null`. Aucune exécution plus récente ne la remplace. Sans `agentRunId`, la réponse habituelle reste inchangée.

Avec `includeIds: true`, `task.list_comments` ajoute la `messageId` native de chaque commentaire à `authorType`, `authorId`, au contenu et à l’horodatage. La réponse par défaut reste inchangée et `truncated` signale toujours un historique incomplet. Une ID écrite dans le commentaire n’est pas son identité native.

Ces lectures ne réservent aucune capacité et n’autorisent ni démarrage, ni commande, ni publication. Un champ absent ou un refus d’une ancienne plateforme laisse l’identité inconnue. Pour lire sa propre exécution actuelle, un agent de tâche utilise la [découverte de l’espace de travail](/fr/platform/projects/project-agents#current-execution).

```yaml
nodes:
  - id: task
    type: task.get
    input:
      taskId: '{{ input.taskId }}'
      agentRunId: '{{ input.agentRunId }}'
  - id: comments
    type: task.list_comments
    input:
      taskId: '{{ input.taskId }}'
      includeIds: true
      limit: 10
```

## Quand une étape échoue

| Échec                                                         | Ce qui s’est passé                                                                                              |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **Le projet de la tâche n’est pas celui de l’automatisation** | L’automatisation n’est pas installée dans le projet, ou l’exécution a été lancée dans un autre projet.          |
| **La personne assignée à la tâche est inconnue**              | Aucun membre de l’organisation ni agent du projet ne porte ce nom, ou il ne peut pas travailler dans le projet. |

Rien de ce que l’étape a commencé ne reste enregistré quand elle échoue.
