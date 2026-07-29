---
title: Journaux d'audit
description: Le journal chronologique de qui-a-fait-quoi dans ton organisation — connexions, changements de rôle, modifications de fournisseur, modifications d'agent, invocations run-code. Les Administrateurs et Propriétaires lisent ceci quand un audit demande qui a touché une ressource et quand.
---

Le journal d'audit est l'enregistrement immuable de chaque action conséquente dans ton organisation. Chaque connexion, changement de rôle, modification de fournisseur, sauvegarde d'agent, exécution de workflow et invocation de sandbox y atterrit avec l'acteur, la ressource, l'état avant/après et l'horodatage. Les Administrateurs et Propriétaires lisent ceci quand un audit demande qui a touché une ressource et quand, quand un responsable conformité a besoin d'un export, ou quand quelque chose dérape et la question est _qui a changé quoi à 03:14_.

Cette page est la référence pour les colonnes, les filtres, les catégories et les formats d'export. La fenêtre de rétention pour les lignes d'audit se règle dans la même zone Gouvernance sous politique de rétention — garde-la assez longue pour satisfaire tes exigences de conformité avant que les lignes ne soient éliminées.

## Un filtre mis en pratique

Pour trouver le moment où le rôle d'un membre a changé, ouvre **Paramètres > Gouvernance > Journaux d'audit**, règle le filtre **Catégorie** sur **Membre** et cherche l'acteur ou la cible par nom. Chaque ligne s'étend en payload complète — état précédent, état nouveau, l'IP si la requête est passée par le réseau, le type d'acteur (utilisateur, système, API, workflow). Exporte la sélection filtrée en CSV ou JSON depuis la barre d'outils au-dessus du tableau.

## Les colonnes

| Nom             | Type     | Requis | Description                                                                                    |
| --------------- | -------- | ------ | ---------------------------------------------------------------------------------------------- |
| Horodatage      | ISO 8601 | oui    | Heure serveur à laquelle l'action a été validée.                                               |
| Action          | string   | oui    | L'action sémantique — `update_member_role`, `provider_created`, `agent_saved`.                 |
| Utilisateur     | string   | oui    | Nom affiché de l'acteur ; `System`, `API` ou `Workflow` quand l'acteur n'est pas une personne. |
| Ressource       | string   | oui    | La ressource touchée par l'action — `agent`, `provider`, `member`, `workflow`.                 |
| Catégorie       | enum     | oui    | Auth, Membre, Données, Connector, Workflow, Sécurité, Admin, AI, Skill, Agent.                 |
| Statut          | enum     | oui    | Succès, Échec, Refusé.                                                                         |
| Champs modifiés | JSON     | non    | Le diff entre l'état précédent et le nouveau pour les actions de mise à jour.                  |

## Filtres

Filtre par plage de dates, catégorie, statut, acteur, ressource ou recherche libre sur les noms d'action. Combine les filtres — une plage de dates plus la catégorie **Sécurité** plus le statut **Refusé** fait remonter les tentatives de connexion ratées sur une fenêtre. L'état des filtres se reflète dans l'URL ; un lien sauvegardé rouvre la même vue.

## Exporter

Deux formats d'export sont livrés : CSV pour les tableurs et JSON pour les systèmes en aval. Les deux respectent les filtres actifs — ce que tu exportes est ce que tu vois. Définis les filtres voulus (le filtre mis en pratique ci-dessus est le modèle), puis choisis CSV ou JSON dans la barre d'outils au-dessus du tableau. Les exports volumineux se téléchargent en streaming ; la barre d'outils suit la progression et signale la fin avec la taille du fichier et le nombre de lignes.

Le CSV arrive sous `audit-logs-<timestamp>.csv`, une ligne par action, avec une colonne plate par champ ; les horodatages sont en ISO 8601 (UTC) et toute valeur contenant une virgule est mise entre guillemets :

```csv
timestamp,action,category,actorEmail,actorId,actorType,actorRole,resourceType,resourceId,resourceName,status,errorMessage
2026-01-14T03:14:07.000Z,member.role_changed,Member,admin@acme.example,usr_8f3a,user,owner,member,usr_2b91,jordan@acme.example,success,
2026-01-14T03:15:22.000Z,provider.updated,Provider,admin@acme.example,usr_8f3a,user,owner,provider,prov_openai,OpenAI,success,
```

L'export JSON (`audit-logs-<timestamp>.json`) porte les mêmes lignes en objets complets, plus les champs que le CSV aplatit — le diff `previousState`/`newState` et l'`integrityHash` par ligne. Choisis JSON quand un système en aval a besoin de la charge avant/après ou doit re-vérifier chaque ligne contre la chaîne SHA-256 (vois la section « Rétention et intégrité » plus bas) ; choisis CSV quand une personne l'ouvre dans un tableur.

## Rétention et intégrité

Les lignes d'audit sont immuables : les modifications et suppressions sont elles-mêmes auditées, et le schéma de ligne porte un hash d'intégrité que tu peux vérifier contre l'export. Une tâche planifiée quotidienne re-vérifie la chaîne de hachage côté serveur et écrit une entrée d'audit `security` si la vérification échoue — ainsi une altération ou une suppression hors bande ressort même si personne ne lance la vérification manuelle. Une vérification en échec déclenche aussi une notification critique dans l'app pour les admins de l'organisation et part vers Slack quand un canal de notification Slack est configuré. La rétention est de 90 jours par défaut et se configure sur la page de politique de rétention (30 à 365 jours). Les lignes qui vieillissent sont retirées par la prochaine passe de nettoyage — il n'y a pas de fenêtre de soft-delete pour les données d'audit.

## Où cela s'inscrit

Le journal d'audit est le côté lecture de toute autre fonction gouvernance : la conservation légale nomme les holds qu'elle a placés, les demandes des personnes concernées loggent chaque étape de cascade, la politique run-code logge les URLs que chaque sandbox a tenté d'atteindre. Quand une question commence par _qui, quand, quoi_, le journal d'audit est la réponse. La page compagnon est la [politique de rétention](/fr/platform/admin/governance/policies-and-limits) — elle contrôle combien de temps ces lignes restent avant que le nettoyage ne les retire.
