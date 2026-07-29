---
title: Concepts d’approbation
description: Une approbation est une carte dans le chat qui retient l’action d’un agent jusqu’à ta décision. Cette page nomme ce qui en déclenche une, les décisions que chaque carte offre et ce que chaque décision laisse derrière elle.
---

Une approbation est la couture entre l’initiative d’un agent et ton jugement : une carte qui apparaît dans le chat où l’action a été tentée, retenant cette action jusqu’à ce qu’une personne décide. Les agents proposent — une écriture de document, un appel d’API sortant, une exécution de workflow — et rien ne s’exécute tant que la carte est en attente. Le chat le dit explicitement : **Réponds à la demande en attente ci-dessus pour continuer**.

Cette page est le modèle mental — ce qui déclenche une approbation, ce que la carte offre et ce qu’une décision laisse derrière elle. Les portes propres aux workflows vivent sur [Approbations dans les workflows](/fr/platform/automations/approvals-in-workflows) ; l’endroit où les exigences sont déclarées vit sur [Configurer les approbations](/fr/platform/approvals/configure).

## Ce qui déclenche une approbation

Chaque carte vient d’un agent qui tente d’agir sur quelque chose qui survit à la conversation :

- **Plans** — un agent propose un plan multi-étapes comme carte **Plan proposé** ; **Approuver et exécuter** le démarre.
- **Écritures de documents** — une carte **Enregistrer dans les documents** retient les fichiers qu’un agent veut stocker ; rien n’atterrit dans le hub documentaire avant approbation.
- **Écritures de connaissances** — une carte **Enregistrer dans la base de connaissances** retient un fait qu’un agent veut mémoriser à l’échelle de l’org.
- **Appels d’connector** — une opération marquée comme exigeant une approbation (des écritures sortantes, typiquement) tient avec les paramètres exacts affichés.
- **Outils MCP** — un outil que le serveur marque **Nécessite une approbation** demande avant de s’exécuter.
- **Création, mises à jour et exécutions de workflows** — les portes côté workflow, couvertes dans [Approbations dans les workflows](/fr/platform/automations/approvals-in-workflows).

## Les décisions sur une carte

Chaque carte porte le payload exact de l’action — le fichier, le fait, les paramètres — et deux décisions : approuver (le bouton nomme l’action, comme **Exécuter le workflow** ou **Approuver et exécuter**) ou rejeter. Les cartes d’connector ajoutent une troisième voie, **Suggérer des modifications** : décris ce qui ne va pas en texte libre et l’agent révise l’appel au lieu de l’abandonner.

<Note>

Les approbations se décident dans la conversation qu’elles interrompent — par la personne qui tient ce chat. Il n’y a ni boîte de réception d’approbations séparée ni routage vers un groupe d’approbateurs ; la personne pour qui l’agent travaille est la personne qui décide.

</Note>

## Les états et la trace

Une carte passe de **En attente** à **Exécution** puis **Terminé** — ou **Rejeté** — et garde son état résolu dans la transcription, si bien qu’un chat se relit comme le procès-verbal de ce qui a été autorisé. Chaque décision atterrit aussi dans le [journal d’audit](/fr/platform/admin/governance/audit-logs) avec l’acteur, l’action et l’horodatage. Les cartes résolues ne peuvent pas être rouvertes ; retenter signifie une proposition neuve et une carte neuve.

## Où cela s’inscrit

Les approbations sont ce qui te laisse confier aux agents de vraies capacités — fichiers, API, workflows — sans céder le registre de qui a autorisé quoi. Lis ensuite [Configurer les approbations](/fr/platform/approvals/configure) pour voir où une exigence s’active, et [Approbations dans les workflows](/fr/platform/automations/approvals-in-workflows) pour les portes autour des workflows.
