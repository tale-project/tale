---
title: Notifier des membres depuis une automatisation
description: Fais savoir quelque chose à des membres depuis une automatisation avec l’étape notify.member — un titre, un texte et un lien, dans leurs notifications et par e-mail — et sache qui est ignoré et ce qui est refusé.
---

Utilise une étape `notify.member` quand une automatisation doit faire savoir quelque chose : un rapport est prêt, trois factures demandent un coup d’œil, une importation est terminée. Chaque membre qu’elle nomme reçoit le message dans ses notifications et par e-mail, dans un cadre qui nomme l’automatisation. Une exécution en direct l’envoie ; une exécution de test répond avec un mock et ne prévient personne.

## Envoyer un message

```yaml
nodes:
  - id: tell
    type: notify.member
    input:
      to: [ada@example.com, '{{ input.ownerId }}', run-starter]
      title: Weekly report ready
      message: '{{ nodes.summary.output.text }}'
      link: '{{ nodes.report.output.url }}'
```

| Entrée    | Ce qu’elle contient                                                                                                                                                                                       |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `to`      | Jusqu’à 20 membres, par e-mail ou identifiant, ou `run-starter` pour la personne qui a lancé l’exécution.                                                                                                 |
| `title`   | Le sujet du message, sur une ligne d’au plus 120 caractères. Il coiffe la notification et sert d’objet à l’e-mail.                                                                                        |
| `message` | Le texte sous le titre, en texte brut, au plus 2000 caractères.                                                                                                                                           |
| `link`    | Une page de ton organisation, par son chemin qui commence par `/dashboard/`, ou une adresse `https://`. Une page s’ouvre dans Tale, une adresse dans un nouvel onglet, et la notification nomme son site. |

Un `message` ou un `link` vide — un modèle qui n’a rien trouvé — est laissé de côté.

L’étape renvoie `{ delivered, skipped }` : `delivered` liste chaque membre atteint sous la forme `{ to, userId }`, sous le nom que l’étape lui a donné, et `skipped` liste `{ to, userId, reason }` pour chaque personne non atteinte.

## Qui le reçoit

Chaque membre reçoit une seule notification, même quand l’étape le nomme deux fois — par e-mail et par identifiant. L’e-mail suit une minute plus tard, sauf si la personne a lu le message dans Tale entre-temps ou a désactivé **M'envoyer les alertes actionnables par e-mail** dans Paramètres › Notifications. Il part par la boîte Gmail, Outlook ou SMTP connectée de ton organisation ; sans elle, la personne n’a que la notification dans Tale.

Deux cas sont ignorés, et listés dans `skipped` avec leur raison :

| Raison       | Pourquoi                                                                                                                           |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `preference` | La personne a désactivé **Messages des automatisations** dans Paramètres › Notifications.                                          |
| `no_starter` | `run-starter` sur une exécution qu’aucune personne n’a lancée : un déclencheur l’a lancée, ou la personne qui l’a fait est partie. |

## Une fois à chaque exécution de l’étape

L’étape envoie son message une fois à chaque exécution : une fois par exécution, et une fois par élément ou par passage dans une boucle. Quand une exécution est interrompue après l’envoi du message puis reprend, l’étape ne prévient personne deux fois et renvoie les membres déjà atteints.

Une exécution envoie au plus 100 messages, pour qu’une étape dans une boucle n’inonde pas les notifications. Pour parler de nombreux éléments à quelqu’un, envoie un seul message qui les liste.

## Quand une étape échoue

| Échec                                          | Ce qui s’est passé                                                                                                         |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **Une personne destinataire n’est pas membre** | Une personne que l’étape nomme n’est pas membre de l’organisation, ou son adhésion est désactivée. Personne n’est prévenu. |
| **L’exécution a envoyé trop de messages**      | L’étape aurait fait dépasser 100 messages à l’exécution. Elle n’a rien envoyé.                                             |

Un lien qui n’est ni une page de ton organisation ni une adresse `https://` fait échouer l’étape avant tout envoi.
