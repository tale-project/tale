---
title: "Quand un workflow IA doit-il demander ton accord ?"
description: "Choisis où une personne doit intervenir dans un workflow IA, ce qu’elle doit vérifier et pourquoi un texte correct ne suffit pas à autoriser son envoi."
slug: human-in-the-loop-ai-agent-workflows
topicId: T02
reviewed: '2026-10-03'
draft: false
coverAlt: "Trois objets distincts représentent une question, un résultat examiné et un contrôle avant action."
---

Prévois une intervention humaine lorsqu’une personne doit fournir une information manquante, juger un résultat ou autoriser une action. Chaque intervention doit répondre à une question précise. « Approuver le travail de l’agent » laisse trop de place à l’interprétation : quelqu’un peut accepter le texte d’un message sans remarquer à qui il sera envoyé.

Commence par lister ce que l’agent produira et ce qu’il pourra modifier. Détermine ensuite les étapes qui ont besoin de tes connaissances ou de ton autorisation. Rédiger une note interne et l’envoyer à des clients n’ont pas les mêmes conséquences, même si le texte est identique.

## Précise ce que la personne approuve

Trois échanges méritent d’être distingués :

| Intervention | La question à laquelle elle répond | Ce qui suit |
| --- | --- | --- |
| Question | Quelle règle, quel public ou quelle préférence s’applique ? | L’agent poursuit avec l’information qui lui manquait |
| Examen du résultat | Cette version répond-elle au brief ? | Accepter le résultat ou demander des corrections |
| Approbation d’une action | Cette opération précise peut-elle avoir lieu ? | Autoriser la tentative ou l’empêcher |

Pose une question avant le travail qui dépend de sa réponse. Examine le résultat lorsqu’il y a quelque chose de concret à vérifier. Demande l’approbation d’une action avant l’effet que tu veux contrôler, en montrant à la personne le contenu et la destination réels.

![Les questions apportent les informations manquantes. L’examen des résultats permet de les accepter ou de demander des corrections. L’approbation autorise ou refuse une opération précise.](/blog/diagrams/fr/T02-diagram.svg)

Ces décisions peuvent être prises au cours du même échange. Elles doivent tout de même recevoir des réponses distinctes. Si tu approuves à la fois une annonce et sa diffusion, consigne la version et le public concernés.

## Un message correct peut arriver aux mauvaises personnes

Prenons une annonce de support fictive. La note de référence P-17 indique qu’**à partir de lundi, l’équipe de support régionale doit transmettre les problèmes d’accès non résolus au responsable de permanence**. Le premier envoi est destiné à un groupe de test interne.

Le brouillon de l’agent, version 2, dit : « Toutes les équipes de support doivent immédiatement transmettre les problèmes d’accès au niveau supérieur. » La phrase paraît claire, mais elle change trois éléments : les équipes concernées, les problèmes à transmettre et la date d’application.

La personne qui vérifie le contenu doit demander ces corrections. La version 3 rétablit le périmètre régional, la condition « non résolus » et le début le lundi. Son texte peut maintenant être accepté.

Le workflow propose ensuite d’envoyer r3 à `all-support`. C’est la mauvaise destination ; la tâche n’autorise que `regional-support-test`. Refuser cet envoi ne signifie pas qu’il faut réécrire le texte. Il faut corriger le destinataire de l’opération, puis demander une nouvelle approbation. Avant de l’accorder, vérifie l’identité du groupe ou la liste de ses membres, pas seulement son nom rassurant.

Après la tentative, vérifie que le message a bien été livré. Une approbation donne la permission d’essayer ; elle ne prouve pas ce qui s’est passé ensuite.

## Donne à la personne de quoi contester la proposition

La personne chargée de vérifier ne devrait pas avoir à reconstituer la tâche à partir d’un historique de discussion. Pour décider de l’envoi, cette demande concise donnerait déjà les éléments essentiels :

> - **Décision :** Peut-on envoyer l’annonce r3 à `regional-support-test` ?
> - **Contenu :** Lien vers le texte exact de r3, vérifié par rapport à P-17.
> - **Destination :** Lien vers la liste actuelle des membres du groupe.
> - **Changement :** La proposition précédente indiquait par erreur `all-support`.
> - **En cas de refus :** Arrêter cet envoi et transmettre le motif à la personne responsable de la tâche.

Place la source originale à côté de la proposition. Le résumé d’une règle par l’agent peut contenir la même erreur que son brouillon. Pour vérifier l’annonce, il faut lire P-17, et non une autre explication de P-17 formulée avec assurance.

Choisis la personne en fonction de la décision : quelqu’un qui comprend la règle pour le contenu, et quelqu’un qui a l’autorité nécessaire pour la diffusion. Une même personne peut assurer les deux rôles. Pouvoir ouvrir un écran d’approbation ne suffit pas à établir l’une ou l’autre de ces responsabilités.

## Évite les approbations sans jugement utile à apporter

Des règles de validation explicites conviennent généralement mieux aux champs manquants, aux adresses invalides et aux identifiants de destination interdits. Exécute ces contrôles avant de demander à quelqu’un de lire la proposition. Réserve l’attention humaine au sens, aux exceptions et aux décisions qui exigent une autorité.

Pour un travail interne réversible, vérifier un échantillon de résultats terminés peut suffire. Pour un nouvel engagement envers un client, un paiement ou une publication au nom de l’entreprise, une personne responsable peut devoir examiner chaque proposition. Conserve les approbations imposées par ton organisation.

Pendant le pilote, observe ce que font les personnes chargées de vérifier. Si la plupart des demandes sont renvoyées parce que la source manque, améliore leur présentation. Si l’équipe ne suit pas, limite le workflow ou prévois un relais compétent. Une file d’attente qui s’allonge doit conduire à revoir le processus, pas à traiter le silence comme un accord.

## Rattache l’approbation à ce qui a été vérifié

Modifier le message, son destinataire ou la règle sur laquelle il repose peut invalider une décision antérieure. Consigne la version et le périmètre pour que la personne suivante sache ce qui reste valable. Si la source ou la destination ne peut pas être vérifiée, laisse l’action en attente et précise qui peut fournir les éléments manquants.

Dans Tale, les résultats des tâches sont soumis à examen. Les workflows en attente distinguent les questions des approbations d’écriture par un connecteur. Une opération incorrecte ne peut pas être modifiée sur sa carte d’approbation : refuse-la, corrige l’entrée ou le workflow, puis lance une nouvelle exécution. [Examen des tâches](https://docs.tale.dev/fr/platform/projects/task-automation), [workflows en attente](https://docs.tale.dev/fr/platform/automations/approvals-in-workflows).

Utilise le [modèle de demande de décision](/blog/worksheets/fr/T02-review-packet.md) avec un workflow existant. Pars de sa prochaine action importante et rédige la phrase à laquelle la personne devra répondre. Si cette phrase reste imprécise, le workflow n’est pas encore prêt pour un bouton d’approbation.
