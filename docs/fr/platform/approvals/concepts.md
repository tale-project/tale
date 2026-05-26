---
title: Concepts d'approbation
description: Une approbation est une carte qu'un humain doit cliquer avant qu'une action automatisée se poursuive. Cette page nomme les quatre sources de déclenchement, le routage et la trace laissée dans le journal d'audit.
---

Une approbation est la couture entre une action automatisée et une décision humaine. C'est une carte qu'une personne doit cliquer — Approuver, Rejeter ou Demander des modifications — avant que l'action se poursuive. Les Éditeurs et les Développeurs configurent où les approbations sont requises ; le pool d'approbateurs décide.

Cette page te donne le modèle mental de ce qu'est une approbation, ce qui en déclenche une et ce que chaque décision laisse derrière. Lis-la avant de configurer un point d'approbation dans un workflow ou de câbler un agent qui écrit dans la base de connaissances.

## Ce qu'est une approbation

Une approbation vit comme ligne dans la table des approbations et comme carte dans la surface chat. La carte porte le contexte de l'action (qui a déclenché, ce qui va changer, pourquoi une approbation était requise) et les trois boutons de décision. Les approbateurs peuvent assortir leur décision d'un commentaire ; le commentaire atterrit dans le journal d'audit à côté de l'action.

Les approbations en attente apparaissent à deux endroits : inline dans la conversation où l'action a été tentée, et dans la boîte de réception de l'approbateur (dans la zone Conversations). Les approbateurs peuvent agir depuis chaque surface ; la décision propage de la même façon.

## Les quatre sources de déclenchement

**Points dans les workflows.** Une étape d'un workflow est configurée comme point d'approbation. L'exécution s'arrête jusqu'à résolution. Voir [Approbations dans les workflows](/fr/platform/automations/approvals-in-workflows).

**Écritures de documents.** Un agent tente d'écrire dans la base de connaissances — créer ou modifier un document, un client, un produit, un fournisseur — et la politique de gouvernance sur cette ressource exige une validation. L'écriture n'est pas validée tant qu'elle n'est pas approuvée.

**Appels d'intégration.** Un agent tente d'appeler un système externe via une intégration qui exige une approbation pour les écritures sortantes. L'appel est retenu jusqu'à ce qu'un approbateur clique sur Approuver.

**Création d'agent et installation de compétence.** Quand la politique de gouvernance exige une revue admin, créer un nouvel agent ou installer une compétence émet une carte d'approbation vers le pool configuré.

## Routage des approbateurs

Chaque approbation est créée avec un pool d'approbateurs — une équipe, un rôle ou une liste explicite d'utilisateurs. Le premier approbateur éligible qui clique décide ; le reste du pool voit la carte passer dans un état résolu. Si personne n'agit dans le délai du point, l'approbation escalade selon la politique d'escalade du point (typiquement : reroutage vers un pool de secours, ou échec de l'exécution).

Les approbateurs ne peuvent pas approuver leur propre demande : la personne qui a déclenché l'action est exclue du pool éligible, même si elle y serait sinon.

## États et délais

Une approbation a quatre états de cycle de vie :

- **pending** — créée, pas encore décidée.
- **approved** — un approbateur a cliqué sur Approuver ; l'action se poursuit.
- **rejected** — un approbateur a cliqué sur Rejeter ; l'action est abandonnée, l'exécution enregistre le rejet.
- **timed-out** — aucune décision dans la fenêtre configurée ; escaladée ou échouée selon la politique.

Chaque transition d'état atterrit dans le journal d'audit avec l'acteur, l'horodatage et le commentaire. Les transitions sont append-only : une approbation résolue ne peut pas être rouverte.

## Mis bout à bout

Une équipe finance-opérations configure trois politiques de gouvernance : les étapes de workflow qui envoient du mail à des adresses externes exigent une approbation ; les écritures d'agent dans la base clients exigent une approbation ; les nouvelles installations de serveur MCP exigent une approbation. Trois sources de déclenchement, un pool d'approbateurs (l'équipe finance), une piste d'audit. L'équipe voit chaque approbation en attente dans sa boîte de réception et chaque décision résolue dans le journal d'audit.

## Où cela s'inscrit

Les approbations sont la surface où automatisation et responsabilité se croisent — elles te laissent déléguer le travail aux agents et workflows sans renoncer à l'enregistrement de qui a approuvé quoi. La lecture suivante naturelle est [Configurer les approbations](/fr/platform/approvals/configure) pour les champs par ressource, et [Approbations dans les workflows](/fr/platform/automations/approvals-in-workflows) pour les spécificités des points.
