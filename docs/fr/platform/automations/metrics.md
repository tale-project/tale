---
title: Métriques d'automatisation
description: Le dashboard qui agrège l'historique des exécutions en taux de succès, durée moyenne, total d'exécutions et exécutions échouées sur chaque workflow de l'org — sur les 7, 30 ou 90 derniers jours. Les Éditeurs et Développeurs lisent ceci quand un workflow se dégrade ou pour repérer quels workflows portent la charge.
---

Le dashboard de métriques est la lecture org-large de la performance des automatisations. Chaque exécution s'agrège en quatre compteurs de tête (total d'exécutions, taux de succès, durée moyenne, exécutions échouées), deux graphiques (exécutions dans le temps, ventilation par statut) et une table des workflows en tête qui classe les définitions les plus occupées. Les Éditeurs et Développeurs la lisent quand un workflow échoue plus que d'habitude, quand la latence grimpe ou quand une partie prenante demande quels workflows font le travail.

La page vit sous **Automatisations > Métriques** dans la sidebar. Choisis une période — 7, 30 ou 90 jours — et chaque panneau se recalcule contre les exécutions qui ont démarré dans cette fenêtre.

## Les quatre cartes de tête

Les cartes au-dessus des graphiques résument la période en un coup d'œil. Chaque carte montre un seul nombre pour la période sélectionnée.

| Carte               | Type        | Requis | Description                                                                                     |
| ------------------- | ----------- | ------ | ----------------------------------------------------------------------------------------------- |
| Total d'exécutions  | Nombre      | oui    | Compte des exécutions démarrées dans la fenêtre, sur chaque workflow de l'org.                  |
| Taux de succès      | Pourcentage | oui    | Part des exécutions terminées sur le total d'exécutions. Exclut les exécutions encore en cours. |
| Durée moy.          | Durée       | oui    | Durée murale moyenne des exécutions terminées dans la fenêtre.                                  |
| Exécutions échouées | Nombre      | oui    | Compte des exécutions qui se sont terminées avec le statut `failed`.                            |

Les cartes agrègent sur chaque workflow. Utilise la table des workflows en tête en dessous pour attribuer les totaux à des définitions spécifiques.

## Les graphiques de tendance et de statut

Deux graphiques se tiennent sous les cartes. Le graphique de tendance trace les exécutions par jour sur la période sélectionnée — une lecture rapide pour savoir si l'org fait plus ou moins de travail d'automatisation dans le temps. Le graphique de statut décompose le même total en terminées, échouées et en cours pour que tu voies la part d'échecs en un coup d'œil.

Les deux graphiques partagent le contrôle de période en haut de la page. Survole n'importe quelle barre ou tranche et l'infobulle porte le compte précis.

## La table des workflows en tête

La table en bas de la page classe les workflows par compte d'exécutions sur la fenêtre. Colonnes : nom du workflow, total d'exécutions, taux de succès, durée moyenne, exécutions échouées, horodatage du dernier passage. Clique une ligne pour sauter dans l'onglet exécutions de ce workflow — le drill-down naturel quand une métrique a l'air fausse et que tu veux voir les exécutions sous-jacentes.

La liste est plafonnée aux 5 000 exécutions les plus récentes dans la fenêtre. Quand le plafond mord, la page affiche une bannière qui le dit — les exécutions plus anciennes dans la même période ne sont pas incluses dans les totaux. Resserre la fenêtre ou ouvre directement l'onglet exécutions du workflow quand le plafond mord.

## Une investigation mise en pratique

Une partie prenante demande pourquoi le workflow de rapport quotidien est plus lent cette semaine. Ouvre **Automatisations > Métriques** et bascule la période sur **7 derniers jours**. Les cartes de tête montrent un taux de succès plat à 100 % mais une durée moyenne en hausse de 40 %. Le graphique de tendance confirme un volume stable — le ralentissement est par exécution, pas tiré par la charge. La table des workflows en tête place le rapport quotidien dans le top trois ; clique dedans, puis trie l'onglet **Exécutions** par durée décroissante. Les exécutions les plus lentes partagent une étape d'agent qui produit un résumé plus long que d'habitude. À partir de là, tu resserres le prompt ou tu rognes le jeu d'entrée ; la carte de métriques du lendemain matin confirme le correctif.

## Où ça s'inscrit

Les métriques sont l'agrégat ; [journaux d'exécution](/fr/platform/automations/execution-logs) est le détail par exécution depuis lequel l'agrégat lit. Utilise les métriques pour repérer un workflow qui mérite attention, puis plonge dans l'onglet exécutions du workflow pour trouver l'exécution spécifique qui s'est mal comportée. Pour la comptabilité org-large des tokens et coûts (plutôt qu'exécutions et durées) le [journal d'audit](/fr/platform/admin/governance/audit-logs) et le registre d'usage sous [politiques et limites](/fr/platform/admin/governance/policies-and-limits) portent les dépenses par membre.
