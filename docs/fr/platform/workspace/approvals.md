---
title: Approbations
description: Examine et approuve ou refuse les actions en attente des automatisations et agents, directement dans le chat.
---

Les automatisations et agents IA peuvent être configurés pour s'arrêter à certaines étapes et attendre une approbation humaine avant de poursuivre. Quand une approbation est nécessaire, elle apparaît en carte inline dans ta conversation.

## Types d'approbation

| Type                    | Ce qui est demandé                                                                           |
| ----------------------- | -------------------------------------------------------------------------------------------- |
| Opération d'intégration | autorisation d'exécuter une requête REST API ou SQL via une intégration connectée.           |
| Création de workflow    | autorisation de créer une nouvelle automatisation.                                           |
| Exécution de workflow   | autorisation de lancer un workflow existant avec des paramètres précis.                      |
| Mise à jour de workflow | autorisation de modifier les étapes ou la configuration d'un workflow existant.              |
| Écriture de document    | autorisation de créer ou enregistrer un ou plusieurs fichiers dans la base de connaissances. |
| Demande d'input humain  | un workflow en pause te demande de remplir une information avant de continuer.               |
| Demande de localisation | autorisation d'accéder à ta position navigateur pour une tâche géolocalisée.                 |

## Examiner une approbation

Quand un agent ou une automatisation a besoin d'approbation, une carte apparaît dans le chat avec tout le contexte : quel workflow ou outil a déclenché la demande, quelle action est prévue et quelles données seraient utilisées.

Chaque carte contient :

- un en-tête identifiant le type d'approbation ;
- des métadonnées détaillées que tu peux déplier (paramètres, listes de fichiers, étapes) ;
- les boutons **Approuver** et **Rejeter**.

Clique **Approuver** pour laisser l'action se poursuivre. La carte montre la progression et le résultat final. Clique **Rejeter** pour l'annuler. L'agent reçoit une notification de refus et peut ajuster son approche.

## Input humain et demandes de localisation

Certaines approbations sont interactives plutôt que de simples Approuver/Rejeter :

- **Demandes d'input humain** affichent un formulaire (textes, menus déroulants, oui/non) que le workflow en pause demande à remplir. Soumets ta réponse pour reprendre.
- **Demandes de localisation** sollicitent ta position navigateur. Clique **Partager la position** pour autoriser ou refuse.
