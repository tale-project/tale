---
title: Configurer les approbations
description: Référence pour les règles d'approbation qu'un Administrateur ou Éditeur peut attacher à un agent, une intégration ou une étape de workflow — quand une approbation est requise, qui décide, ce qui arrive au timeout.
---

Les règles d'approbation sont la configuration derrière chaque carte d'approbation que Tale fait remonter. Elles nomment ce qui déclenche une approbation, qui est dans le pool d'approbateurs, et ce qui arrive si personne ne décide à temps. Les Administrateurs configurent les politiques à l'échelle de l'org ; les Éditeurs configurent les gates par agent et par workflow. Cette page est la référence pour les champs que tu fixes sur chaque règle et ce qu'ils changent au produit en cours.

Le modèle mental des approbations — ce qu'est une carte, ce qu'une approbation laisse derrière, les quatre sources de déclenchement — vit sur [Concepts d'approbation](/fr/platform/approvals/concepts). Ce qui suit est la surface de configuration : où vivent les règles, les champs par règle, et comment les règles composent quand deux se déclenchent en même temps.

## Une règle mise en pratique

Pour exiger une approbation avant qu'un agent n'écrive dans la base clients, ouvre **Paramètres > Gouvernance > Règles d'approbation** et clique sur **Nouvelle règle**. Choisis la ressource (`Clients — écriture`), choisis le déclencheur (`N'importe quel agent`), choisis le pool d'approbateurs (`Équipe : Opérations`), fixe le timeout (`24h`) et l'action de timeout (`Rejeter`). Enregistre. La prochaine fois qu'un agent essaie de créer ou modifier un client, l'écriture est retenue, une carte d'approbation atterrit dans l'inbox de l'équipe Opérations, et l'exécution ne continue que si quelqu'un clique sur Approuver dans la journée.

La règle est en vigueur immédiatement ; les écritures en vol se terminent, la suivante est retenue. Retirer la règle lève le hold sur les écritures futures ; les approbations en attente existantes restent en attente jusqu'à résolution.

## Où vivent les règles

Trois surfaces de configuration produisent des règles d'approbation ; chacune écrit dans la même table de règles sous-jacente.

- **Paramètres > Gouvernance > Règles d'approbation** est la surface à l'échelle de l'org. Les Administrateurs créent des règles qui s'appliquent à une ressource (documents, clients, produits, intégrations, serveurs MCP, création d'agent, installation de skill) et choisissent le motif de déclencheur (n'importe quel acteur, rôles spécifiques, équipes spécifiques, agents spécifiques).
- **L'onglet Gouvernance de l'éditeur d'agent** laisse un Éditeur attacher une règle spécifique à l'agent. La règle ne se déclenche que pour les appels de cet agent ; elle compose avec toute règle à l'échelle de l'org qui s'applique aussi.
- **Le gate d'approbation d'une étape de workflow** laisse l'auteur du workflow exiger une approbation à une étape précise. C'est la surface [Approbations dans les workflows](/fr/platform/workflows/approvals-in-workflows) ; le gate écrit une règle ponctuelle cadrée à cette étape.

Une ressource peut avoir plusieurs règles en vigueur ; le moteur les exécute toutes et l'action est retenue jusqu'à ce que chaque règle applicable approuve. Un rejet sur n'importe quelle règle termine l'action.

## Champs par règle

Chaque règle porte la même forme, peu importe où elle a été écrite.

| Champ                    | Requis                 | Description                                                                                                                                                                                                                           |
| ------------------------ | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Nom                      | Oui                    | Étiquette humaine montrée sur les cartes et dans l'audit. Choisis quelque chose que l'approbateur reconnaîtra.                                                                                                                        |
| Ressource                | Oui                    | La chose qui change : un type de base de connaissances (Documents, Clients, Produits, Fournisseurs, Sites web), un appel d'intégration (`Intégrations > Sortant`), création d'agent, installation de skill, ou une étape de workflow. |
| Motif de déclencheur     | Oui                    | Qui agit : n'importe quel acteur, un rôle spécifique, une équipe spécifique, un agent spécifique. Les motifs restrictifs rétrécissent la portée de la règle.                                                                          |
| Pool d'approbateurs      | Oui                    | L'ensemble éligible : une équipe, un rôle, ou une liste de membres explicite. Le premier approbateur éligible qui clique décide.                                                                                                      |
| Exclure le requêteur     | Défaut                 | L'acteur qui a déclenché l'action est retiré du pool. Activé par défaut ; le désactiver est rarement le bon choix.                                                                                                                    |
| Timeout                  | Oui                    | La fenêtre avant que l'action de timeout se déclenche. Tale supporte minutes, heures et jours.                                                                                                                                        |
| Action de timeout        | Oui                    | Ce qui arrive quand la fenêtre se ferme sans décision : `Rejeter` (l'action est abandonnée), `Escalader` (router vers un pool de repli) ou `Approuver` (auto-autoriser — sûr uniquement sur ressources peu risquées).                 |
| Pool d'escalade          | Si timeout = Escalader | Le pool qui reçoit la carte à l'escalade. Même forme que le pool d'approbateurs.                                                                                                                                                      |
| Politique de commentaire | Défaut                 | Si l'approbateur peut, doit, ou ne peut pas laisser un commentaire. Défaut : peut.                                                                                                                                                    |

## Comment plusieurs règles composent

Quand une seule action touche plus d'une règle, Tale les évalue en parallèle. L'action est retenue jusqu'à ce que chaque règle se résolve ; un Approuver sur une ne suffit pas si une seconde est encore en attente. Un Rejeter sur n'importe quelle règle termine l'action et écrit le rejet dans le journal d'audit. C'est intentionnel — la règle applicable la plus stricte gagne, et une règle permissive ne peut pas écraser une plus stricte par accident.

Si deux règles ciblent le même pool d'approbateurs, l'approbateur voit une carte par règle ; décider chacune est requis. Les cartes se relient entre elles pour que l'approbateur voie l'ensemble complet des holds avant de trancher.

## Audit et historique

Chaque changement de règle atterrit dans le journal d'audit avec l'acteur, l'horodatage et le diff. La ligne d'audit suit aussi chaque approbation que la règle a produite — acteur, décision, commentaire et temps de résolution de chaque carte. Va vers la vue audit de la règle (l'onglet **Historique** sur la ligne de la règle) quand tu veux voir à quelle fréquence la règle se déclenche et combien de temps les approbateurs prennent typiquement.

## Où cela s'inscrit

Les règles d'approbation sont le plan de configuration derrière les [Concepts d'approbation](/fr/platform/approvals/concepts) ; la variante gate-de-workflow a sa propre surface sous [Approbations dans les workflows](/fr/platform/workflows/approvals-in-workflows). La lecture suivante naturelle dépend de ce que tu câbles — pour les gates de workflow la page workflow, pour les approbations d'écriture d'agent la [vue Admin des agents](/fr/platform/admin/agents) où vit la gouvernance par agent.
