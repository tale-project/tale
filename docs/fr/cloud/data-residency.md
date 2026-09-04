---
title: Résidence des données
description: Où vivent tes données Cloud, où elles se déplacent pendant un chat, quels sous-traitants les touchent, et ce qui reste dans la région versus ce qui en sort.
---

La résidence des données sur Cloud répond à deux questions que chaque audit finit par poser : quelle région détient tes données au repos, et quels systèmes externes les touchent en vol. Cette page trace un seul aller-retour de chat de bout en bout, liste les classes de données, et nomme chaque sous-traitant que tes messages traversent.

La région par défaut pour les nouvelles organisations Cloud est la Suisse. Changer de région après l'inscription est une migration, pas un basculement de réglage — recréer une organisation dans la région UE est plus rapide que d'en déplacer une existante. Choisis une fois ; choisis délibérément.

## Un exemple déroulé — un aller-retour de chat

L'utilisateur à Zurich ouvre Chat et envoie « résume le dernier appel client ». La requête frappe le edge de Tale dans la région choisie, atterrit sur `tale-platform`, qui la transmet à `tale-backend-api` (le backend), lit les connaissances depuis la base de connaissances dès que l'outil de connaissances de l'agent les demande, et émet un appel sortant vers le fournisseur derrière le modèle choisi par la personne qui envoie. La récupération de connaissances tourne dans le backend — elle interroge directement la base de connaissances, sans service de récupération séparé sur le chemin. Le fournisseur de modèles retourne des tokens ; Tale les streame en retour sur le même chemin. La réponse et les citations atterrissent dans la base de données opérationnelle, le corpus reste dans la base de connaissances, et les deux sont répliqués dans la région.

Deux flèches franchissent la frontière régionale dans ce trajet : l'appel vers le fournisseur de modèles (toujours externe) et tout sous-traitant déclenché par les outils de l'agent (fetch web, lecture OneDrive, l'API du fournisseur d'un connector dans une autre région). Tout le reste reste dans la région.

## Régions primaires

| Région           | Postgres  | Stockage objet | Réplica DR |
| ---------------- | --------- | -------------- | ---------- |
| Suisse           | Zurich    | Zurich         | Genève     |
| Union européenne | Francfort | Francfort      | Dublin     |

Le réplica DR sert au plan de reprise après sinistre, pas au trafic actif. Les données d'une région ne circulent jamais vers le primaire ou le réplica de l'autre.

## Ce qui reste dans la région, ce qui en sort

| Type de données                          | Lié à la région | Traverse | Notes                                                                          |
| ---------------------------------------- | --------------- | -------- | ------------------------------------------------------------------------------ |
| Chats et messages                        | ✓               |          |                                                                                |
| Documents et embeddings de connaissances | ✓               |          |                                                                                |
| Configuration d'organisation et rôles    | ✓               |          |                                                                                |
| Journaux d'audit                         | ✓               |          |                                                                                |
| Requêtes vers le fournisseur de modèles  |                 | ✓        | Va vers le fournisseur configuré ; choisis un endpoint régional si disponible. |
| Synchronisation OneDrive                 |                 | ✓        | La région de stockage de Microsoft s'applique.                                 |
| Récupérations de l'outil web             |                 | ✓        | Là où l'URL résout.                                                            |

## Sauvegardes et DR

Tale prend un instantané des deux bases Postgres — la base opérationnelle et le corpus de connaissances — chaque jour, et du stockage objet chaque heure. Les instantanés sont chiffrés au repos avec des clés détenues par Tale ; le réplica DR reçoit une copie dans la région. Les restaurations à partir d'instantanés sont une opération initiée par le client routée via le support ; le SLA couvre le temps de restauration.

## Changer de région

Un changement de région s'implémente comme un export depuis la région courante, un import dans la nouvelle région, et un basculement DNS. La procédure est la même que [Migrer vers auto-hébergé](/fr/cloud/migrate-to-self-hosted), sauf que les deux côtés sont des régions Cloud ; attends-toi à une indisponibilité de l'ordre de la minute et une fenêtre planifiée. Il n'y a pas de bascule de région in-place.

## Où ça s'inscrit

La résidence des données est la première page que toute revue de conformité lit. Couple-la avec [Trust et conformité](/fr/cloud/trust-and-compliance) (quel cadre couvre quoi) et [Sous-traitants](/fr/legal/subprocessors) (la liste de chaque système externe nommé ci-dessus). Si ton organisation envisage l'auto-hébergement pour une exigence de résidence, [Aperçu auto-hébergé](/fr/self-hosted/overview) est la lecture suivante — faire tourner la pile sur ton propre matériel déplace chaque flèche de cette page à l'intérieur de ta propre frontière.
