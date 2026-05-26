---
title: Politiques et limites
description: Plafonds par organisation sur le coût des tokens, le nombre de requêtes, la taille d'upload, la génération d'images et l'accès aux fonctionnalités — cadrés par utilisateur, équipe ou rôle. Les Administrateurs et Propriétaires lisent ceci quand une charge dépasse le budget ou quand une fonctionnalité a besoin d'un rayon plus serré.
---

Politiques et limites est la surface où tu plafonnes ce que tes membres et agents peuvent consommer. Les budgets plafonnent les tokens, le coût et les requêtes par période de facturation ; les contrôles de fonctionnalité activent la recherche web, l'exécution de code et l'upload de fichiers par scope ; la politique d'upload régit les types et tailles de fichiers qu'un membre peut joindre ; la politique de rétention décide combien de temps chaque type de donnée vit avant le nettoyage. Les Administrateurs et Propriétaires lisent cette page quand une charge dépasse le budget, quand une fonctionnalité doit être coupée pour un sous-ensemble d'utilisateurs, ou quand un régulateur nomme une fenêtre de rétention différente du défaut.

## Un budget mis en pratique

Pour plafonner la dépense mensuelle d'un Éditeur, ouvre **Paramètres > Gouvernance > Budgets** et clique sur **Ajouter une règle**. Choisis **Rôle** comme scope, **Éditeur** comme cible, règle la période sur **Mensuel** et entre un coût max en USD. Enregistre et la prochaine requête de mois-période qui pousserait un Éditeur au-delà du plafond est refusée avec une erreur budget-dépassé. Un seuil d'avertissement sous le plafond déclenche une alerte avant que le plafond ne soit atteint. Les scopes plus étroits l'emportent sur les plus larges — une règle utilisateur bat une règle équipe bat une règle rôle — et les limites au niveau org s'appliquent toujours par-dessus comme plafond additionnel.

## Les quatre couches de politique

**Budgets** sont des plafonds de tokens, coût et requêtes par scope et période. Les scopes sont org, rôle, équipe ou utilisateur. Chaque règle porte un plafond de tokens, un plafond de coût en USD, un plafond de requêtes optionnel et un seuil d'avertissement exprimé en pourcentage du plafond.

**Contrôles de fonctionnalité** activent la recherche web, l'exécution de code et l'upload de fichiers par scope, et plafonnent les tokens de contexte max pour les réponses AI. Une fonctionnalité coupée pour un scope cache la bascule dans le chat et refuse la requête côté serveur.

**Politique d'upload** régit les extensions de fichiers, types MIME et tailles qu'un membre peut joindre. Elle plafonne aussi le volume total par utilisateur — utile quand le stockage est mesuré. Désactive la politique pour un défaut permissif ; active-la pour appliquer les listes.

**Politique de rétention** décide combien de temps chaque type de donnée (historique de chat, documents, prompts, journaux d'audit, registre d'utilisation, exécutions de workflow et plus) reste avant que la passe de nettoyage ne retire la ligne. La page affiche les bornes imposées par l'opérateur, la surcharge par organisation dans ces bornes, et une fenêtre de grâce avant la suppression dure.

## Priorité

Les quatre couches partagent la même échelle de scope : utilisateur > équipe > rôle > org > défaut. La règle la plus étroite l'emporte. Là où une couche porte un plafond au niveau org (budgets), le plafond s'applique comme plafond additionnel au-dessus de toute règle plus étroite.

## Bornes de rétention et approbations

La politique de rétention vit à l'intérieur de bornes imposées par l'opérateur — l'opérateur en self-hosted règle un plancher et un plafond par catégorie, et la valeur de l'organisation se clampe à cette plage. Quand l'opérateur propose un plancher plus serré ou un plafond plus bas, le changement remonte comme proposition que les Administrateurs peuvent appliquer ou rejeter. Les réductions de la politique atterrissent avec un bandeau de changement en attente et une fenêtre de grâce avant prise d'effet — la même grâce donne aux Administrateurs la chance d'annuler.

## Où cela s'inscrit

Politiques et limites est la couche budget et porte qui protège l'organisation des dépenses qui s'emballent et des accès non voulus. Associe-la à [contenu et modèles](/fr/platform/admin/governance/content-models), pour que le modèle plafonné par budget soit aussi celui que la liste d'accès autorise, et à [politique de rétention sur la même page](#bornes-de-rétention-et-approbations), pour que les données que l'organisation garde soient aussi bornées. La page compagnon est [journaux d'audit](/fr/platform/admin/governance/audit-logs) — chaque changement de politique ici y atterrit comme enregistrement permanent.
