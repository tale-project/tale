---
title: Administrer les agents de projet
description: Vérifie les droits de modification, les ressources autorisées et les conséquences des secrets accordés aux agents.
---

Administre un agent à travers son projet et les ressources de l’organisation. Il n’existe pas de liste d’agents supplémentaire à configurer pour toute l’organisation. Ouvre le projet sous **Projets** dans **Accueil**, puis **Agents** pour examiner ou modifier ses agents.

## Vérifier qui peut modifier l’agent

Toute personne qui peut lire le projet voit ses agents. Les personnes autorisées à modifier un projet actif peuvent créer, modifier ou supprimer ses agents. Un projet archivé reste consultable. Vérifie les [rôles des membres](/fr/platform/admin/members-and-roles) et les [accès des équipes](/fr/platform/admin/teams) lorsqu’une personne possède un accès inattendu ou ne peut pas gérer les agents.

Un agent appartient à un seul projet. Son identifiant et l’accès à un second projet ne permettent pas à une intégration de l’utiliser comme agent de ce second projet. Chaque projet accepte jusqu’à 50 agents, avec des noms uniques dans le projet.

## Examiner les ressources avant le démarrage

Ouvre le dialogue de modification et vérifie l’ensemble de la configuration, au-delà du modèle :

| Vérification | Pourquoi elle compte | Où résoudre le problème |
| --- | --- | --- |
| Harness, modèle et fournisseur | Les identifiants doivent permettre ce mode d’exécution. | [Fournisseurs d’IA](/fr/platform/admin/providers). |
| Skills et partage | Les équipes du projet déterminent les bundles disponibles. | [Bibliothèque de skills](/fr/platform/workspace/skills) et accès au projet. |
| Connectors et outils de la plateforme | Ils autorisent des services et des opérations sur les données. | [Identifiants des connectors](/fr/platform/admin/connectors) et équipement de l’agent. |
| Secrets | La session en cours peut lire les valeurs accordées. | Les commandes **Secrets** de l’agent, réservées aux Propriétaires et Admins. |
| Capacité des sandboxes et dépenses | Le travail nécessite un environnement disponible et un budget autorisé. | [Sandboxes](/fr/platform/admin/sandboxes) et [Politiques et limites](/fr/platform/admin/governance/policies-and-limits). |

Un agent de revue peut se contenter de lire le dépôt et de produire un compte rendu. Un outil d’écriture autorise ses opérations dans les limites de ses règles d’accès. Une instruction demandant de solliciter un accord ne remplace pas le retrait d’une permission inutile.

## Maîtriser les changements de secrets

Seuls un Propriétaire ou un Admin peuvent modifier les secrets accordés. Un Éditeur peut changer les autres champs en conservant ces autorisations. Les valeurs sont chiffrées dans le stockage de l’organisation et ne sont pas renvoyées avec la configuration. L’agent en cours d’exécution reçoit toutefois celles qui lui sont accordées.

Utilise des identifiants limités et remplaçables. Plusieurs agents ou nœuds d’automatisation peuvent partager un même nom de secret. Sa rotation ou suppression affecte donc chaque future exécution qui le référence. Examine ces usages avant de le modifier.

## Appliquer la même vérification aux clients API

L’API publique lit et modifie la même liste d’agents et applique les droits sur le projet du détenteur de la clé. Chaque opération inclut un identifiant de projet. Une mise à jour fournit la configuration complète, y compris les secrets à conserver. Les omettre demande leur retrait et exige donc les mêmes droits administratifs.

L’[exemple API des agents de projet](/fr/develop/api-reference#gerer-les-agents-dun-projet) décrit l’intégration. Après une modification, rouvre l’agent pour vérifier le modèle, l’équipement et les autorisations enregistrés. Confie-lui ensuite une petite tâche dont une personne peut examiner le résultat. [Agents de projet](/fr/platform/projects/project-agents) explique ce parcours.
