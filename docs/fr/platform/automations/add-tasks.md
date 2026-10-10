---
title: Ajouter des tâches depuis une automatisation
description: Crée une tâche dans un projet avec l’étape task.create — titre, personne assignée, statut, échéance et libellés — une fois à chaque exécution de l’étape, et sache ce qui est refusé.
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

## Quand une étape échoue

| Échec                                                         | Ce qui s’est passé                                                                                              |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **Le projet de la tâche n’est pas celui de l’automatisation** | L’automatisation n’est pas installée dans le projet, ou l’exécution a été lancée dans un autre projet.          |
| **La personne assignée à la tâche est inconnue**              | Aucun membre de l’organisation ni agent du projet ne porte ce nom, ou il ne peut pas travailler dans le projet. |

Rien de ce que l’étape a commencé ne reste enregistré quand elle échoue.
