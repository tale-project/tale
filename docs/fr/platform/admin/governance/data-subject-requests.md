---
title: Demandes des personnes concernées
description: Dépose et examine une demande d’effacement, gère les approbations et délais, puis vérifie le reçu obtenu.
---

En tant qu’admin ou propriétaire, utilise **Paramètres > Gouvernance > Personnes concernées** pour traiter une demande d’effacement. Tale suit la demande, son approbation, son délai d’attente et le résultat de la suppression. Vérifie d’abord l’identité de la personne et le bon périmètre selon la procédure de ton organisation.

<Frame caption="Gouvernance > Demandes des personnes concernées — la politique de gouvernance DSAR (fenêtre d’attente, double approbation, limite quotidienne), au-dessus de la liste des reçus de demandes avec Déposer une demande.">

![La page de gouvernance Demandes des personnes concernées montrant les champs de fenêtre d’attente, de bascule de double approbation et de limite quotidienne, au-dessus d’un tableau de demandes d’effacement qui porte une demande en attente — personne concernée Jordan Blake, code de motif Consentement retiré, 24 h avant exécution et 29 jours restants sur son SLA — à côté d’un bouton Déposer une demande.](/images/platform/governance-data-subject-requests.webp)

</Frame>

## Déposer une demande

1. Choisis **Déposer une demande** et recherche la **Personne concernée** par nom ou e-mail. Vérifie que tu as sélectionné le bon compte.
2. Choisis le **Fondement légal** et explique la demande dans **Motif détaillé**, avec une référence à ton dossier interne.
3. Saisis exactement `ERASE`, puis choisis **Déposer la demande**.
4. Ouvre le reçu et vérifie le statut, l’échéance et la prochaine action requise.

L’effacement supprime définitivement les données couvertes ; il ne les déplace pas vers la corbeille. Le reçu indique les catégories et les nombres concernés : chats, documents et imports, préférences, retours, notifications, usage et nettoyage des identifiants personnels dans l’audit.

## Vérifier la règle avant le dépôt

| Réglage | Effet |
| --- | --- |
| **Délai de réflexion (heures)** | Attente de 0–72 heures avant l’exécution. Les admins peuvent annuler pendant ce délai. Zéro permet une exécution immédiate une fois les autres conditions remplies. |
| **Exiger une approbation à double signature** | Un autre admin doit approuver avant le début du délai de réflexion. La personne qui dépose ne peut pas s’approuver elle-même. |
| **Limite quotidienne par admin** | Limite chaque admin à 1–50 dépôts par jour. |

Seul le propriétaire peut modifier cette règle. Les protections renforcées s’appliquent immédiatement ; les assouplissements attendent 24 heures pour permettre à tout admin de les annuler. Vérifie les réglages effectifs et les éventuels changements en attente avant de compter sur une nouvelle valeur.

## Suivre le reçu

| État | Action utile |
| --- | --- |
| En attente / attend une approbation | Vérifie si un autre admin doit approuver ou si le délai doit se terminer. Annule ou rejette si la demande ne doit pas s’exécuter. |
| En cours | Attends les résultats par catégorie ; ne dépose pas de doublon. |
| Terminée | Vérifie les nombres enregistrés et conserve le reçu dans ton dossier. |
| Partielle | Examine les catégories ignorées et les erreurs. Résous la cause avant de réessayer. |
| Bloquée | Examine la [conservation juridique](/platform/admin/governance/legal-hold). Les données couvertes restent protégées. |
| Échouée | Lis les détails. Utilise **Réessayer** si disponible ; un dépassement du délai de surveillance peut exiger une nouvelle demande. |
| Annulée | Ce reçu ne prévoit plus d’exécution. Dépose une nouvelle demande si le dossier doit reprendre. |

Un reçu ouvert peut empêcher un second dépôt pour la même personne. Reprends ce reçu au lieu de multiplier les demandes. Une demande bloquée dès le dépôt doit à nouveau respecter la règle actuelle d’approbation et d’attente lors d’un nouvel essai.

## Gérer l’échéance

La liste montre le délai suivi et les éventuels retards. Utilise **Prolonger le délai** pour une prolongation justifiée tant que l’action est disponible. L’application autorise une prolongation avant l’expiration du délai initial et enregistre le motif ainsi que l’admin.

Cette échéance facilite le suivi. Ton organisation reste responsable de l’examen et des échanges avec la personne. Terminer un reçu Tale ne confirme pas, à lui seul, une suppression dans des systèmes externes indépendants ou des sauvegardes.

## Vérifier le résultat

Ouvre les compteurs par catégorie, les erreurs et la chronologie d’audit du reçu. Une action terminée, une catégorie sous gel et une étape échouée n’ont pas le même résultat. Note ces distinctions dans ton dossier. Consulte les [journaux d’audit](/platform/admin/governance/audit-logs) pour les événements administratifs associés.
