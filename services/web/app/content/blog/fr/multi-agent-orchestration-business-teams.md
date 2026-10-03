---
title: "Ton projet a-t-il besoin de plusieurs agents IA ?"
description: "Décide si un agent suffit ou s’il faut répartir le travail. Un exemple montre comment séparer les tâches et résoudre les désaccords entre résultats."
slug: multi-agent-orchestration-business-teams
topicId: T01
reviewed: '2026-10-03'
draft: false
coverAlt: "Un centre de coordination relie trois espaces de travail distincts à un résultat commun."
---

Commence avec un agent. Ajoutes-en un autre s’il peut répondre à une question distincte, examiner d’autres documents ou effectuer une vérification que le premier couvre mal. Avant de répartir le travail, décide qui réunira les résultats.

C’est le critère utile pour coordonner plusieurs agents. Trois agents chargés de la recherche, de la rédaction et de la vérification peuvent reproduire la même erreur s’ils s’appuient tous sur une source trompeuse. Ce qui justifie un agent supplémentaire, c’est sa contribution, pas l’intitulé de son rôle.

## Cherche des tâches qui peuvent avancer séparément

Une bonne répartition permet à chaque agent de produire un résultat utile sans attendre l’autre. L’un peut, par exemple, examiner des entretiens clients pendant que l’autre vérifie la documentation produit. Tous deux transmettent leurs conclusions à la personne ou à l’agent qui rédigera la recommandation.

Confie l’ensemble à un seul agent si chaque étape dépend de la précédente, si les sources sont peu nombreuses ou si plusieurs agents passeraient leur temps à réécrire le même document. Les transmissions risquent alors d’ajouter plus de travail qu’elles n’en économisent.

Anthropic décrit des recherches effectuées en double lorsque ses agents recevaient des consignes trop vagues. Ce retour d’expérience plaide pour des missions précises ; il ne montre pas que chaque projet a besoin de plusieurs agents. [Lis le récit de la conception du système de recherche](https://www.anthropic.com/engineering/multi-agent-research-system).

Pose-toi cette question : **qu’apportera le deuxième agent qui me manquerait sans lui ?** Si la réponse se limite à « un autre avis », précise d’abord sur quelles preuves cet avis reposera.

## Divise la révision d’un manuel en deux questions concrètes

Prenons un exemple : une équipe veut mettre à jour son manuel de prise en main. Elle dispose du manuel r6, de la référence produit approuvée r12 et de notes d’assistance récentes. Elle veut corriger les instructions erronées et répondre aux questions que les clients posent vraiment.

Deux recherches sont pertinentes :

| Mission | Documents à examiner | Résultat attendu |
| --- | --- | --- |
| Repérer les explications manquantes | Notes d’assistance | Questions récurrentes, avec des liens vers les notes d’origine |
| Repérer les instructions erronées | Manuel r6 et référence produit r12 | Chaque écart, les deux passages sources et une correction proposée |

Aucune de ces recherches ne nécessite de modifier le manuel. Confie à un seul rédacteur le soin de réunir les conclusions dans une nouvelle version. Ce peut être une personne ou un agent ; quelqu’un doit toujours vérifier les modifications proposées à partir des sources.

![Deux recherches distinctes alimentent un rédacteur qui réunit les conclusions et résout les contradictions avant la vérification du document révisé.](/blog/diagrams/fr/T01-diagram.svg)

Pour un guide de trois paragraphes fondé sur une seule référence, cette répartition serait probablement excessive. Un agent pourrait le vérifier et le réviser, puis soumettre son travail à une relecture. Le nombre d’agents dépend du travail utile qui peut avancer séparément.

## Précise le résultat attendu, pas seulement le rôle

« Vérifie les faits » laisse trop de choses à interpréter. Pour le manuel, une consigne exploitable serait :

> Compare le manuel r6 à la référence produit approuvée r12. Pour chaque instruction erronée, fournis les deux passages sources et une correction proposée. Ne modifie pas le manuel. Si les sources se contredisent, conserve ce désaccord et formule la question que le responsable produit doit trancher.

Joins les documents cités, nomme le destinataire du résultat et fixe une limite de temps ou d’effort. Précise aussi ce que l’agent doit rendre s’il ne termine pas. Des constats vérifiés, avec une liste précise des preuves manquantes, sont plus utiles qu’une supposition affirmée avec assurance.

La [fiche de mission](/blog/worksheets/fr/T01-task-contract.md) propose une version plus détaillée si tu dois aussi préciser les autorisations, les dépendances et les critères d’acceptation.

## Résous les désaccords à partir des sources

Supposons que le manuel indique que tous les utilisateurs peuvent inviter d’autres personnes, que la référence approuvée réserve ce droit aux administrateurs et qu’une note d’assistance rapporte une invitation réussie depuis un compte standard.

Ne fais pas voter les agents. Le manuel est le document à vérifier. La référence approuvée établit la règle documentée. La note d’assistance soulève une question sur le rôle réel du client ou sa configuration ; elle n’explique pas encore l’écart.

Le rédacteur peut proposer « Un administrateur envoie l’invitation » et demander au responsable produit d’examiner le témoignage contradictoire. Si la règle ne peut pas être confirmée, laisse cette section en suspens. L’accord des agents ne fournirait pas la preuve manquante.

Conserve les versions des sources avec les conclusions. Si la référence r13 arrive en cours de travail, vérifie à nouveau le constat sur les permissions. La liste des questions clients peut rester utile puisque les notes d’assistance sur lesquelles elle repose n’ont pas changé.

## Garde la répartition si elle améliore le travail terminé

Essaie la même petite mission avec un agent, puis avec la répartition envisagée. Fournis les mêmes documents et critères d’acceptation, et note toute différence de budget total. Compare les erreurs manquées, les constats utiles, le délai avant acceptation du document et le travail de coordination et de correction.

Garde le deuxième agent si sa contribution justifie cet effort. Regroupe les tâches si tu obtiens le même résultat avec moins de transmissions. Des recherches individuelles plus rapides ne suffisent pas si l’assemblage de la réponse finale prend plus de temps.

Dans Tale, les tâches de projet réunissent les missions, les rapports et les livrables. Pour déléguer à un autre agent, il faut que l’outil nécessaire ait été explicitement accordé à l’agent ; attribuer une tâche ne suffit pas à la démarrer. Le [guide de délégation des tâches](https://docs.tale.dev/fr/platform/projects/task-automation) décrit la configuration.
