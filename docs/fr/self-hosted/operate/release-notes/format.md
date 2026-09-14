---
title: Examiner une version avant la mise à jour
description: Trouve la version cible, évalue les changements pour ton installation et prépare la mise à jour.
---

Lis les [notes de version sur GitHub](https://github.com/tale-project/tale/releases) pour la version que tu souhaites déployer. Pars de la version installée et examine chaque version jusqu’à la cible. Un numéro de correctif ne garantit pas l’absence de migration ou d’intervention de l’opérateur.

## Identifier le point de départ

Lance `tale --version` pour connaître la version de la CLI. Vérifie aussi celle du runtime déployé : mettre à jour la CLI et remplacer les conteneurs en cours d’exécution sont deux opérations distinctes. Pour un déploiement géré, consulte le reçu de déploiement avec ses références source et empreintes d’images.

Avec la CLI actuelle, `tale update` choisit une version plus récente dans la même série `x.y`. Passer à une autre série nécessite `--version`. Consulte `tale update --help` pour les options de ta CLI et lis les notes sur GitHub.

## Évaluer les conséquences du déploiement

Examine la version dans cet ordre. Les titres et le niveau de détail varient selon les versions. Lis les instructions de migration et les avis de sécurité liés avant d’appliquer le changement.

| Information | Décision à prendre |
| --- | --- |
| Ruptures de compatibilité et changements de comportement | Quels parcours, réglages par défaut ou paramètres changent ? |
| Migrations et instructions de mise à jour | Quelles conditions, interruptions ou préparations de restauration sont nécessaires ? |
| Changements du contrat API | Faut-il adapter les champs envoyés, le comportement attendu ou la gestion des erreurs ? |
| Sécurité | Ton installation est-elle concernée, et quelle version corrigée ou mesure provisoire s’applique ? |
| Problèmes connus | Peux-tu accepter les limites restantes et utiliser les solutions de contournement ? |
| Nouveautés et liste complète des changements | Quelles fonctionnalités ou corrections présenter aux utilisateurs ? |

Tale est un projet 0.x mis à jour en continu. Une version corrective peut inclure des migrations additives et des changements de comportement. Les correctifs de sécurité ciblent la dernière version, sans rétroportage vers les anciennes. Consulte la [politique de sécurité](https://github.com/tale-project/tale/security/policy).

## Préparer le changement

1. Note les versions actuelle et cible, avec les références source exactes pour un déploiement géré.
2. Lis les notes intermédiaires et repère les changements de configuration, d’authentification, de stockage et d’intégration.
3. Prépare la sauvegarde, la restauration et le créneau de maintenance indiqués dans [Mises à jour](/fr/self-hosted/operate/upgrades).
4. Essaie la cible dans un environnement séparé avec tes parcours essentiels, notamment les clients API et les règles d’approbation.
5. Après le déploiement, vérifie l’état du système et répète ces parcours. Conserve les notes avec le compte rendu de déploiement.

Le téléchargement réussi d’une image ne prouve pas que l’application fonctionne après une migration. Vérifie la plateforme en cours d’exécution avant de considérer la mise à jour comme terminée. Les [avis de sécurité](/fr/self-hosted/operate/security/advisories) expliquent comment évaluer et signaler une vulnérabilité.
