---
title: Concepts d’approbation
description: Une approbation est une étape en pause dans une exécution d’automatisation en cours — une écriture de connector qui attend sur la page de détail de l’exécution qu’une personne l’approuve ou la rejette. Cette page nomme ce qui en déclenche une, la décision qu’elle offre et ce qu’elle laisse derrière elle.
---

Une approbation est la couture entre l’initiative d’une automatisation et ton jugement. Quand une exécution réelle atteint une écriture de connector que la politique de ton organisation retient — envoyer un courrier, poster un message, ouvrir un ticket —, l’étape ne s’exécute pas : l’exécution se met en pause, et sa page de détail montre une carte avec l’opération et l’entrée exacte avec laquelle l’étape appellerait, jusqu’à ce qu’une personne décide. Rien ne part tant que la carte est en attente, et une étape rejetée fait échouer l’exécution au lieu d’être retentée dans ton dos.

Cette page est le modèle mental — ce qui déclenche une approbation, où elle apparaît et ce qu’une décision laisse derrière elle. L’endroit où l’exigence est déclarée vit sur [Configurer les approbations](/fr/platform/approvals/configure) ; l’autre endroit où une exécution attend une personne — la question qu’un nœud agent pose en cours de route — vit sur [Approbations dans les workflows](/fr/platform/automations/approvals-in-workflows).

## Ce qui déclenche une approbation

Une seule chose : une **écriture de connector dans une exécution réelle** pour laquelle la politique d’approbation exige une décision. La ligne par défaut est de savoir si l’écriture quitte ton locataire — le courrier, Slack, GitHub et WebDAV demandent ; une tâche déplacée ou un document déposé sur la surface de Tale ne demande pas — et `governance/approval-policy.yml` déplace cette ligne par connecteur ou par action. Les lectures ne demandent jamais. Les essais ne demandent jamais non plus : en mode simulation, les connectors renvoient des doublures et rien hors de la plateforme n’est touché.

Rien d’autre ne produit une carte d’approbation dans cette version. L’assistant de chat ne peut écrire nulle part — ses trois outils récupèrent et chargent —, il n’y a donc aucune carte dans un chat ; les appels de connector d’un agent de projet passent en lecture seule par son broker, une exécution de tâche n’atteint donc jamais la porte ; et il n’existe aucun drapeau d’approbation par outil sur un serveur MCP, puisque les serveurs MCP sortants ne font pas partie de cette version.

## La décision sur la carte

Ouvre l’exécution — depuis la liste des exécutions de l’automatisation, où elle apparaît **En attente** — et la carte affiche **En attente de ton approbation**, nomme l’opération sous la forme `<connecteur>.<action>` et le nœud qui l’a demandée, et montre l’entrée exacte avec laquelle l’étape appellerait. Deux décisions : **Approuver** laisse l’étape en pause agir au prochain poll et l’exécution repart ; **Rejeter** fait échouer l’étape et arrête l’exécution. Il n’y a pas de troisième voie — tu ne peux ni modifier les paramètres ni demander à l’automatisation de revoir l’appel ; un appel erroné est rejeté et la définition se corrige sur le canvas.

<Note>

Les approbations n’ont pas de boîte de réception dans cette version. La carte vit sur la page de détail de l’exécution, et quiconque peut ouvrir cette page décide — il n’y a ni routage vers un groupe d’approbateurs ni file personnelle. La seule décision qui exige un Admin est la seconde signature d’une demande d’effacement, couverte dans [Demandes des personnes concernées](/fr/platform/admin/governance/data-subject-requests).

</Note>

## Les états et la trace

Une carte passe d’en attente à en exécution quand elle est approuvée — l’étape agit au prochain poll et l’enregistrement se fixe sur terminé — ou à rejeté. La décision appartient à l’opération pour laquelle elle a été demandée : assouplir la politique ensuite ne libère pas une carte déjà en attente, et une exécution qui repasse par la même opération lit la même réponse au lieu de demander deux fois. Chaque décision atterrit dans le [journal d’audit](/fr/platform/admin/governance/audit-logs) avec l’acteur et l’horodatage, et l’exécution garde l’issue dans son propre détail. Une carte décidée ne se rouvre pas — une exécution rejetée est terminée, et la nouvelle tentative est une exécution neuve.

## Où cela s’inscrit

Les approbations sont la façon dont une automatisation atteint des systèmes extérieurs sans agir seule : l’écriture attend, une personne lit l’appel exact, et le registre dit qui a autorisé quoi. Lis [Configurer les approbations](/fr/platform/approvals/configure) pour voir où passe la ligne entre demander et ne pas demander, et [Approbations dans les workflows](/fr/platform/automations/approvals-in-workflows) pour l’autre endroit où une exécution attend une personne.
