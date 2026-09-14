---
title: Journaux d’audit
description: Retrouve les changements enregistrés, examine les événements, exporte les résultats et vérifie la chaîne d’audit.
---

En tant qu’admin ou propriétaire, ouvre **Paramètres > Gouvernance > Journaux** pour examiner les actions enregistrées dans ton organisation. Repère d’abord l’événement et sa date, puis son acteur, sa cible, son résultat et les détails disponibles.

## Retrouver un changement

1. Choisis **Journaux d'audit** et ouvre **Filtre**.
2. Sélectionne une catégorie adaptée, comme les changements de membres, la sécurité ou les données.
3. Repère l’événement par sa date, son action et sa cible. Ouvre sa ligne pour consulter les détails.
4. Vérifie le statut : une tentative refusée ou échouée ne prouve pas que le changement a eu lieu.

L’onglet actif et la catégorie figurent dans l’URL : tu peux enregistrer la vue dans tes favoris. L’accès dépend toujours de tes permissions dans l’organisation.

## Lire un événement

| Champ | Ce qu’il faut examiner |
| --- | --- |
| Horodatage | Quand Tale a enregistré l’action. |
| Action | L’opération tentée ou terminée. Certaines actions récentes apparaissent sous leur nom technique. |
| Utilisateur | La personne ou l’acteur système responsable. |
| Ressource et cible | Le type d’élément et l’enregistrement concerné. |
| Catégorie | Le groupe utilisé par le filtre. |
| Statut | Réussite, échec ou refus. |
| Vue détaillée | États précédent/nouveau, champs modifiés, métadonnées et erreurs disponibles. Tous les événements ne contiennent pas tous les champs. |

Le journal atteste les événements qu’il enregistre. Il ne constitue pas une copie complète des conversations, des réponses des fournisseurs ou de l’activité des services externes.

## Choisir le bon onglet

**Journaux d'audit** contient les événements individuels. La vue des blocages de connexion aide à examiner les verrouillages. Les journaux d’activité résument les actions et leurs résultats sur une période. Les journaux d’erreurs se concentrent sur les échecs et peuvent être filtrés par catégorie.

Si un membre ne peut pas se connecter, commence par les blocages et le [guide de sécurité du compte](/fr/platform/admin/two-factor-authentication). Pour un changement de configuration inattendu, consulte l’événement d’audit et ses détails.

## Exporter les résultats

Définis le filtre de catégorie, puis ouvre **Exporter** et choisis CSV ou JSON. Le CSV fournit des colonnes pour tableur : horodatages UTC, identifiants des acteurs et ressources, statuts et erreurs. Le JSON conserve les objets d’événement plus complets, dont les détails de changement et les empreintes d’intégrité disponibles.

Les exports respectent le filtre de catégorie et contiennent au maximum 10 000 lignes, des plus récentes aux plus anciennes. Ils sont générés sur le serveur et téléchargés via un lien temporaire. Un export filtré ou plafonné reste une sélection : ce n’est pas forcément tout l’historique d’audit ni une chaîne d’empreintes complète.

## Rétention et intégrité

Choisis **Vérifier maintenant** dans la section d’intégrité de la chaîne pour contrôler la chaîne d’audit stockée. Le panneau affiche son statut et la dernière vérification automatique. Si une rupture est signalée, conserve ses détails et examine-la avec l’opérateur avant de t’appuyer sur cette partie de l’historique.

Une vérification réussie couvre les enregistrements conservés qu’elle a examinés. Elle n’établit pas une origine de l’historique signée de façon indépendante. Le [guide d’intégrité pour l’exploitation](/fr/self-hosted/operate/security/audit-log-integrity) décrit les contrôles et leurs limites.

Le chaînage par empreintes aide à détecter les changements des enregistrements stockés. Il ne prouve pas que toute action possible a été enregistrée. La rétention de l’audit se configure dans [Politiques et limites](/fr/platform/admin/governance/policies-and-limits). Vérifie la règle active et les bornes du déploiement sans supposer une durée fixe. Des entrées d’audit récupérables peuvent apparaître dans la [Corbeille](/fr/platform/admin/governance/trash). Le nettoyage définitif limite l’historique disponible ici.
