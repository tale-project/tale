---
title: Demandes des personnes concernées
description: Le workflow RGPD article 17 pour effacer les données d’une personne dans les chats, documents, exécutions de workflow et prompts. Les Administrateurs et Propriétaires lisent ceci quand un utilisateur dépose une demande ou quand une échéance SLA approche.
---

Demandes des personnes concernées est le workflow que Tale livre pour honorer l’article 17 du RGPD (droit à l’effacement) et le droit équivalent CCPA sous la loi californienne. Chaque demande devient un reçu : il nomme la personne concernée, le code de motif, l’échéance SLA et la cascade de lignes que le système a effacées dans les threads, documents, exécutions de workflow et modèles de prompts personnels. Les Administrateurs et Propriétaires lisent cette page quand une personne dépose une demande, quand une échéance approche, ou quand un audit demande le reçu d’un effacement passé.

<Frame caption="Gouvernance > Demandes des personnes concernées — la politique de gouvernance DSAR (fenêtre d’attente, double approbation, limite quotidienne), au-dessus de la liste des reçus de demandes avec Déposer une demande.">

![La page de gouvernance Demandes des personnes concernées montrant les champs de fenêtre d’attente, de bascule de double approbation et de limite quotidienne, au-dessus d’un tableau de demandes d’effacement qui porte une demande en attente — personne concernée Jordan Blake, code de motif Consentement retiré, 24 h avant exécution et 29 jours restants sur son SLA — à côté d’un bouton Déposer une demande.](/images/platform/governance-data-subject-requests.webp)

</Frame>

## Un dépôt mis en pratique

Pour déposer une demande, ouvre **Paramètres > Gouvernance > Demandes des personnes concernées** et clique sur **Déposer une demande**. Choisis la personne, choisis un code de motif (consentement retiré, plus nécessaire, traitement illégal, obligation légale, opposition, mineur ou fin de contrat) et ajoute une narration libre. La demande entre dans une fenêtre d’attente avant l’exécution de la cascade — tout Administrateur peut annuler pendant la fenêtre. Une fois la fenêtre écoulée, la cascade efface les threads, documents, exécutions de workflow, embeddings RAG et prompts personnels de la personne, et le reçu enregistre les compteurs par catégorie.

## Cycle de vie du statut

| Nom                      | Par défaut      | Description                                                                                                                                                                      |
| ------------------------ | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| En attente               | état initial    | La demande est déposée et attend la fenêtre d’attente ou la seconde approbation administrateur.                                                                                  |
| En attente d’approbation | double contrôle | Un second Administrateur doit approuver avant que la cascade ne s’exécute — ou rejeter, ce qui annule la demande.                                                                |
| En cours                 | mid-cascade     | La cascade est en cours ; les compteurs partiels se mettent à jour à mesure que chaque catégorie finit.                                                                          |
| Terminée                 | terminal        | Chaque catégorie effacée sans erreur.                                                                                                                                            |
| Partielle                | terminal        | Certaines lignes ont été ignorées — généralement une conservation légale les a bloquées.                                                                                         |
| Échouée                  | terminal        | La cascade a rencontré une erreur ; le reçu nomme la catégorie en échec.                                                                                                         |
| Bloquée                  | terminal        | Une conservation légale active bloque chaque étape de cascade.                                                                                                                   |
| Annulée                  | terminal        | Un Administrateur a annulé avant l’exécution de la cascade, ou un second Administrateur a rejeté la double approbation. Une nouvelle demande peut être déposée pour la personne. |

## Suivi du SLA

Chaque demande porte une échéance niveau de service — par défaut, 30 jours depuis le dépôt. La liste des demandes affiche les jours restants ou un badge en retard par ligne. L’article 12(3) du RGPD autorise une prolongation unique pour les cas complexes ; l’action **Prolonger l'échéance** consigne la prolongation sur le reçu avec le nom de l’administrateur demandeur et une narration.

## Interaction avec la conservation légale

Les données d’une personne ne sont _pas_ effacées tant qu’elles sont sous conservation légale. Les lignes sous hold apparaissent comme **Ignorées par hold** dans les compteurs par catégorie du reçu ; lever le hold et relancer la demande termine l’effacement. Le statut Bloquée se déclenche quand un hold couvre toutes les catégories dès le départ — la cascade ne s’exécute pas, et le reçu reflète le blocage.

## Les catégories de cascade

Le reçu ventile les lignes effacées par catégorie — threads, documents, exécutions de workflow, modèles de prompts, documents RAG retirés du magasin vectoriel. Lis le drawer pour voir les compteurs et la timeline d’audit ; le journal d’audit dans la même zone Gouvernance porte la chaîne d’événements complète (`gdpr_erasure_requested`, `gdpr_erasure_executed`, `gdpr_erasure_extended`, `gdpr_erasure_rejected`, `gdpr_erasure_cancelled`).

## Où cela s’inscrit

Demandes des personnes concernées est le visage conformité de la rétention — le chemin audité, à double contrôle, qui efface une personne précise sur demande au lieu du balayage chronométré que la rétention applique à tous. La page compagnon est [conservation légale](/fr/platform/admin/governance/legal-hold) — elle couvre comment mettre la rétention et les cascades d’effacement en pause pour les litiges avant qu’elles ne s’exécutent.
