---
title: Conservation légale
description: Le gel à double contrôle qui met en pause les balayages de rétention et les cascades d’effacement pour un utilisateur ou l’organisation entière pendant un litige. Les Administrateurs et Propriétaires lisent ceci quand le conseil leur demande de préserver des preuves.
---

Conservation légale est le mécanisme que Tale livre pour préserver des preuves sous conservation contentieuse. Un hold épingle une cible — un utilisateur en tant que custodian, ou l’organisation entière — hors de portée du balayage de rétention et de la cascade d’effacement des personnes concernées. Les Administrateurs et Propriétaires lisent cette page quand le conseil leur demande de préserver les données d’un custodian, quand une demande de levée a besoin de la signature à double contrôle, ou quand un audit réconcilie quels holds étaient en vigueur à une date donnée.

<Frame caption="Gouvernance > Conservation légale — le tableau des holds actifs avec l’action Placer une conservation légale, au-dessus de la file à double contrôle des demandes de levée.">

![La page de gouvernance Conservation légale montrant un hold actif — de type Utilisateur sur marta.vogel, placé par Alex Rivera au titre de l’affaire Northstar contract — à côté d’un bouton Placer une conservation légale, au-dessus des deux files de demandes de levée, Approbation en attente et Approuvées, qui n’affichent aucune demande.](/images/platform/governance-legal-hold.webp)

</Frame>

## Une mise en place mise en pratique

Pour placer un hold sur un utilisateur, ouvre **Paramètres > Gouvernance > Conservation légale** et clique sur **Placer une conservation légale**. Choisis le type de cible — utilisateur en tant que custodian, ou l’organisation entière — choisis la personne là où il en faut une, ajoute un motif et lie le hold à un dossier s’il y en a un d’ouvert. Le hold prend effet immédiatement : les balayages de rétention sautent les lignes de la cible, une demande d’effacement contre la cible est refusée, et supprimer du contenu retenu est refusé à la source.

## Les quatre sections

**Holds actifs** est la liste de travail de chaque hold actuellement en vigueur. Chaque ligne porte le type, la cible, le motif, le dossier, qui l’a placé et quand. Filtre par type ou par dossier pour cadrer la vue.

**Demandes de levée** est la file à double contrôle. Lever un hold demande qu’un autre Administrateur approuve la demande ; les demandes approuvées attendent encore un délai de refroidissement avant de prendre effet. La section se sépare en _en attente d’approbation_ et _approuvée, en attente du refroidissement_, pour que la file et le minuteur soient tous deux visibles.

**Dossiers** groupe les holds par affaire. Chaque dossier porte un nom, un numéro de dossier et la liste des holds liés. Fermer un dossier dépose des demandes de levée pour chaque hold lié — toujours soumises à l’approbation à double contrôle par demande.

**Historique des levées** est l’audit en lecture seule des levées effectuées et rejetées. Utilise-le pour réconcilier contre une lettre de préservation du conseil adverse ou alimenter un rapport d’audit.

## Interaction hold-et-cascade

Un hold bloque chaque passage de rétention et chaque étape d’effacement pour la cible, et la suppression est refusée à la source — mettre à la corbeille les threads ou documents d’une personne retenue échoue avec une erreur de conservation légale, et supprimer un dossier refuse tant qu’il contient un fichier retenu. Une demande de personne concernée dont le sujet est couvert par un hold atterrit en statut **Bloquée** jusqu’à ce que le hold soit levé ; le reçu enregistre le blocage.

## Double contrôle

Placer et lever ne sont pas symétriques. Placer est une action d’un Administrateur seul — la vitesse compte quand un litige arrive. Lever est à double contrôle : l’Administrateur demandeur dépose, un autre Administrateur approuve, et un délai de refroidissement s’applique entre l’approbation et l’effet pour qu’une levée hâtive puisse encore être annulée. Les deux moitiés du workflow sont auditées de bout en bout.

## Où cela s’inscrit

Conservation légale est le bouton gel sur la rétention. C’est le seul mécanisme qui bat le balayage chronométré de la rétention et la cascade d’effacement des personnes concernées — les deux respectent les holds par conception. Les pages compagnons sont [demandes des personnes concernées](/fr/platform/admin/governance/data-subject-requests) pour le côté cascade et [politiques et limites](/fr/platform/admin/governance/policies-and-limits) pour les fenêtres de rétention que le hold outrepasse.
