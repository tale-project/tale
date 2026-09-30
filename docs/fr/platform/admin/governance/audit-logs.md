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

<Frame caption="Gouvernance > Journaux : l’onglet Journaux d’audit limité à la catégorie Membre. Tout effacer retire le filtre.">

![La page Journaux avec l’onglet Journaux d’audit filtré sur la catégorie Membre : onze événements où Alex Rivera a ajouté des membres, créé trois équipes et ajouté un membre à chacune, chaque ligne indiquant la ressource, la cible, la catégorie et le statut Success.](/images/platform/governance-audit-logs.webp)

</Frame>

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

**Journaux d'audit** contient les événements individuels ; le tableau en charge davantage au défilement, et son pied de page indique combien d’événements sont chargés jusque-là, si bien qu’un total ne représente tout l’historique que lorsque le pied de page le dit. La vue des blocages de connexion aide à examiner les verrouillages. Les journaux d’activité résument les actions et leurs résultats sur une période : la période choisie dans le **Filtre** (7, 30 ou 90 jours) est nommée au-dessus des totaux, et chaque nombre de l’onglet ne couvre que cette période. Les journaux d’erreurs se concentrent sur les échecs et peuvent être filtrés par catégorie.

Si un membre ne peut pas se connecter, commence par les blocages et le [guide de sécurité du compte](/fr/platform/admin/two-factor-authentication). Pour un changement de configuration inattendu, consulte l’événement d’audit et ses détails.

## Exporter les résultats

Définis le filtre de catégorie, puis ouvre **Exporter** et choisis CSV ou JSON. Le CSV fournit des colonnes pour tableur : horodatages UTC, identifiants des acteurs et ressources, statuts et erreurs. Le JSON conserve les objets d’événement plus complets, dont les détails de changement et les empreintes d’intégrité disponibles.

Les exports respectent le filtre de catégorie et contiennent au maximum 10 000 lignes, des plus récentes aux plus anciennes. Ils sont générés sur le serveur et téléchargés via un lien temporaire. Un export filtré ou plafonné reste une sélection : ce n’est pas forcément tout l’historique d’audit ni une chaîne d’empreintes complète.

## Rétention et intégrité

Choisis **Vérifier maintenant** dans la section d’intégrité de la chaîne pour contrôler la chaîne d’audit stockée. Le panneau affiche son statut et la dernière vérification automatique. Si une rupture est signalée, conserve ses détails et examine-la avec l’opérateur avant de t’appuyer sur cette partie de l’historique.

Une vérification réussie couvre les enregistrements conservés qu’elle a examinés. Elle n’établit pas une origine de l’historique signée de façon indépendante. Le [guide d’intégrité pour l’exploitation](/fr/self-hosted/operate/security/audit-log-integrity) décrit les contrôles et leurs limites.

Le chaînage par empreintes aide à détecter les changements des enregistrements stockés. Il ne prouve pas que toute action possible a été enregistrée. La rétention de l’audit se configure dans [Politiques et limites](/fr/platform/admin/governance/policies-and-limits). Vérifie la règle active et les bornes du déploiement sans supposer une durée fixe. Des entrées d’audit récupérables peuvent apparaître dans la [Corbeille](/fr/platform/admin/governance/trash). Le nettoyage définitif limite l’historique disponible ici.

Le nettoyage de rétention planifié consigne ici chacun de ses cycles sous forme d’événements système de la catégorie **Données** : son démarrage, le nombre d’éléments supprimés dans chaque catégorie, et s’il s’est terminé ou a échoué.
