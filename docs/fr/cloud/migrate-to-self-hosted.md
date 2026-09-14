---
title: Préparer le passage à l’auto-hébergement
description: Organiser une migration Cloud accompagnée, valider la destination et prévoir le retour arrière.
---

Passer du Cloud à une instance auto-hébergée confie l’infrastructure à ton équipe. Prépare le déplacement avec Tale et l’opérateur de destination pour garder cohérents les données applicatives, les connaissances, les fichiers, la configuration et les clés de chiffrement.

Cette migration nécessite l’intervention de l’opérateur. Le produit commun ne propose pas le parcours d’export d’organisation **Exporter** puis `/_internal/import` décrit dans d’anciennes pages. Exporter des enregistrements par l’API ne constitue pas une sauvegarde complète de l’instance.

## Définir ce qui doit être conservé

Liste les organisations et les données concernées, l’interruption acceptable, la version cible et les personnes chargées de la validation. Vérifie les prérequis d’infrastructure dans le [guide d’installation](/fr/self-hosted/install/quickstart).

| Domaine | Questions à résoudre avant le déplacement |
| --- | --- |
| Base applicative | Quelle sauvegarde constitue une source cohérente, et quelles versions peuvent la restaurer ? |
| Stockages de connaissances | Quels stockages, index et paramètres d’embeddings de chaque organisation faut-il déplacer ? |
| Fichiers et configuration | Quelles données du stockage objet et quels répertoires appartiennent au déploiement ? |
| Chiffrement | Quelles clés de chiffrement et de signature faut-il conserver en sécurité ? |
| Services externes | Quelles URL de rappel, destinations de webhooks, règles réseau ou identifiants changent ? |
| Travail en arrière-plan | Quelles exécutions doivent se terminer ou être suspendues avant la copie finale ? |

Prépare le déplacement avec ton opérateur à l’aide du [guide de sauvegarde et de restauration](/fr/self-hosted/operate/backups-and-restore). Un ensemble d’exports API ne remplace pas ce plan.

## Répéter la restauration sur une destination isolée

Restaure une copie dans un environnement isolé avant la bascule. Contrôle les automatisations sortantes et les tâches planifiées pour éviter les messages en double ou les modifications externes involontaires pendant l’essai.

Vérifie la connexion, les rôles, des documents représentatifs, les fichiers de projet, une réponse de chat et les intégrations critiques. Compare les nombres et quelques enregistrements avec la source. Le démarrage du service n’est que la première vérification.

## Prévoir la bascule et le retour arrière

Précise qui bloque les écritures, prend la dernière copie, change le routage et valide la destination. Définis les conditions de retour arrière et empêche les deux instances d’accepter des modifications simultanément. Conserve la source et les sauvegardes vérifiées jusqu’à l’acceptation.

Adapte les origines publiques, TLS, les URL de rappel SSO et les destinations des intégrations à la nouvelle adresse. Les sessions et les identifiants externes peuvent nécessiter un renouvellement : teste-les sans supposer qu’ils sont transférés.

## Transmettre l’exploitation

Confirme la supervision, les sauvegardes, les responsables des restaurations, les mises à niveau et les contacts d’assistance. Consigne les vérifications acceptées et communique l’adresse à utiliser. Les tâches régulières comprennent ensuite les [mises à niveau](/fr/self-hosted/operate/upgrades), [l’observabilité](/fr/self-hosted/operate/observability/operations) et les exercices de restauration.
