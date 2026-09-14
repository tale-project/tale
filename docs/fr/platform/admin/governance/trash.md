---
title: Corbeille
description: Retrouve les enregistrements récupérables, comprends leur statut et restaure-les avant la suppression définitive.
---

En tant qu’admin ou propriétaire, ouvre **Paramètres > Gouvernance > Corbeille** pour récupérer les enregistrements encore stockés après une suppression provisoire. Une suppression définitive ne peut pas être annulée ici, et toutes les suppressions de Tale ne passent pas par la corbeille.

## Restaurer un enregistrement

1. Ouvre la corbeille et utilise **Filtre > Catégorie** pour réduire la liste, ou garde la vue sans filtre pour voir tous les types pris en charge.
2. Vérifie le nom, le propriétaire, le type et la date de suppression pour distinguer les enregistrements similaires.
3. Choisis **Restaurer** sur la ligne et lis la confirmation.
4. Pour un enregistrement expiré par rétention, saisis exactement `restore`. Confirme, puis retrouve l’enregistrement à son emplacement d’origine, par exemple dans sa liste de chats ou les connaissances.

La ligne restaurée disparaît de la corbeille. Tale consigne la restauration dans le journal d’audit. Si elle n’est plus disponible, actualise la liste : le nettoyage l’a peut-être déjà supprimée définitivement.

## Comprendre le statut

| Statut | Signification |
| --- | --- |
| **Mis à la corbeille** | L’enregistrement a été supprimé provisoirement et peut encore être restauré. |
| **Expiré** | La règle de rétention a fait expirer l’enregistrement. Le restaurer déroge à cette règle, d’où la confirmation avec le mot `restore`. |

**Expiré** ne signifie pas que le délai de récupération est déjà écoulé. La rétention marque les enregistrements comme expirés au début de leur délai de grâce ; le nettoyage définitif intervient après ce délai.

Le filtre de catégorie comprend les chats, documents, fichiers, retours, contacts, conversations externes, exécutions de workflow et d’automatisation, données d’usage, entrées d’audit et événements de filtre de chat pris en charge. Certaines données sont supprimées directement ou avec leur parent et n’ont pas d’action de restauration séparée.

## Vérifier le délai de récupération

La règle de rétention de l’organisation définit le délai de grâce. S’il est positif, les enregistrements expirés pris en charge restent récupérables jusqu’au nettoyage. Zéro autorise un nettoyage définitif immédiat. Vérifie la règle active dans [Politiques et limites](/fr/platform/admin/governance/policies-and-limits), sans supposer un nombre de jours fixe.

Une corbeille vide signifie qu’aucun enregistrement n’est récupérable dans cette vue. Elle ne prouve pas qu’aucune suppression n’a eu lieu. Efface les filtres de catégorie avant de conclure qu’un enregistrement manque.

## Tenir compte des gels juridiques

Un [gel juridique](/fr/platform/admin/governance/legal-hold) empêche la rétention ou l’effacement de supprimer les données couvertes. Il préserve les données encore présentes, sans récupérer celles déjà supprimées définitivement. Vérifie l’historique des gels et de la rétention pour comprendre pourquoi un enregistrement est arrivé, ou non, dans la corbeille.
