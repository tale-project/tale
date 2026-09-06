---
title: Journaux d'audit
description: Le journal chronologique de qui-a-fait-quoi dans ton organisation — connexions, changements de rôle, modifications de fournisseur, modifications d'agent. Les Administrateurs et Propriétaires lisent ceci quand un audit demande qui a touché une ressource et quand.
---

Le journal d'audit est l'enregistrement immuable de chaque action conséquente dans ton organisation. Chaque connexion, changement de rôle, modification de fournisseur, sauvegarde d'agent, exécution de workflow et invocation de sandbox y atterrit avec l'acteur, la ressource, l'état avant/après et l'horodatage. Les Administrateurs et Propriétaires lisent ceci quand un audit demande qui a touché une ressource et quand, quand un responsable conformité a besoin d'un export, ou quand quelque chose dérape et la question est _qui a changé quoi à 03:14_.

Cette page est la référence pour les colonnes, les filtres, les catégories et les formats d'export. La fenêtre de rétention pour les lignes d'audit se règle dans la même zone Gouvernance sous politique de rétention — garde-la assez longue pour satisfaire tes exigences de conformité avant que les lignes ne soient éliminées.

## Un filtre mis en pratique

Pour trouver le moment où le rôle d'un membre a changé, ouvre **Paramètres > Gouvernance > Journaux** et règle le filtre **Catégorie** sur **Membre** — les colonnes utilisateur et cible nomment les personnes impliquées. Chaque ligne s'étend en payload complète — état précédent, état nouveau, champs modifiés, le type d'acteur (utilisateur, système, API, workflow). Exporte la sélection filtrée en CSV ou JSON depuis la barre d'outils au-dessus du tableau.

## Les colonnes

| Nom             | Type     | Requis | Description                                                                                    |
| --------------- | -------- | ------ | ---------------------------------------------------------------------------------------------- |
| Horodatage      | ISO 8601 | oui    | Heure serveur à laquelle l'action a été validée.                                               |
| Action          | string   | oui    | L'action sémantique — `update_member_role`, `provider_created`, `agent_saved`.                 |
| Utilisateur     | string   | oui    | Nom affiché de l'acteur ; `System`, `API` ou `Workflow` quand l'acteur n'est pas une personne. |
| Ressource       | string   | oui    | Le type de ressource touché par l'action — `agent`, `provider`, `member`, `workflow`.          |
| Cible           | string   | non    | La ressource précise touchée, par nom ou par id.                                               |
| Catégorie       | enum     | oui    | Authentification, Membre, Données, Connector, Automatisation, Sécurité, Admin, IA, Skill, Agent. |
| Statut          | enum     | oui    | Succès, Échec, Refusé.                                                                         |
| Erreur          | string   | non    | Le message d'erreur quand l'action a échoué ou a été refusée.                                  |

Le diff entre l'état précédent et le nouveau, la liste des champs modifiés et les éventuelles métadonnées d'usage IA voyagent avec la ligne et s'ouvrent dans sa vue de détail plutôt qu'en colonnes.

## Filtres

Le tableau d'audit porte un seul filtre — **Catégorie**, à choix unique. Le filtre et l'onglet actif se reflètent dans l'URL ; un lien sauvegardé rouvre la même vue. La page se découpe en quatre onglets : **Journaux d'audit** (le tableau que décrit cette page), **Blocages de connexion**, **Journaux d'activité** (un résumé par période avec les compteurs succès, échec et refusé) et **Journaux d'erreurs** ; le filtre de catégorie s'applique sur les onglets audit et erreurs.

## Exporter

Deux formats d'export sont livrés : CSV pour les tableurs et JSON pour les systèmes en aval. Les deux respectent le filtre de catégorie actif — ce que tu exportes est ce que tu vois. Définis le filtre voulu (le filtre mis en pratique ci-dessus est le modèle), puis choisis CSV ou JSON dans la barre d'outils au-dessus du tableau. L'export se construit côté serveur — jusqu'à 10 000 lignes —, se range avec les fichiers de ton organisation et arrive au navigateur comme lien de téléchargement à courte durée de vie.

Le CSV arrive sous `audit-logs-<timestamp>.csv`, une ligne par action, avec une colonne plate par champ ; les horodatages sont en ISO 8601 (UTC) et toute valeur contenant une virgule est mise entre guillemets :

```csv
timestamp,action,category,actorEmail,actorId,actorType,actorRole,resourceType,resourceId,resourceName,status,errorMessage
2026-01-14T03:14:07.000Z,member.role_changed,Member,admin@acme.example,usr_8f3a,user,owner,member,usr_2b91,jordan@acme.example,success,
2026-01-14T03:15:22.000Z,provider.updated,Provider,admin@acme.example,usr_8f3a,user,owner,provider,prov_openai,OpenAI,success,
```

L'export JSON (`audit-logs-<timestamp>.json`) porte les mêmes lignes en objets complets, plus les champs que le CSV aplatit — le diff `previousState`/`newState` et l'`integrityHash` par ligne. Choisis JSON quand un système en aval a besoin de la charge avant/après ou doit re-vérifier chaque ligne contre la chaîne SHA-256 (vois la section « Rétention et intégrité » plus bas) ; choisis CSV quand une personne l'ouvre dans un tableur.

## Rétention et intégrité

Les lignes d'audit sont immuables : les modifications et suppressions sont elles-mêmes auditées, et le schéma de ligne porte un hash d'intégrité que tu peux vérifier contre l'export. Une tâche planifiée quotidienne parcourt la chaîne de hachage côté serveur — ainsi une altération ou une suppression hors bande ressort même si personne ne lance la vérification manuelle. Une vérification en échec déclenche une notification critique dans l'app pour les admins de l'organisation et part vers Slack quand un canal de notification Slack est configuré. Les admins vérifient la chaîne à la demande depuis le panneau **Intégrité de la chaîne** en haut de cette page — il montre le statut courant, la dernière vérification automatique et un bouton **Vérifier maintenant** — et la notification d'une vérification en échec mène droit à la ligne signalée, pour que l'admin atterrisse sur la cassure plutôt qu'en tête du journal. La rétention est de deux ans par défaut et se configure sur la page de politique de rétention — entre un an, le plancher de conformité, et dix. Les lignes qui vieillissent sont retirées par la prochaine passe de nettoyage — il n'y a pas de fenêtre de soft-delete pour les données d'audit.

## Où cela s'inscrit

Le journal d'audit est le côté lecture de toute autre fonction gouvernance : la conservation légale nomme les holds qu'elle a placés, les demandes des personnes concernées loggent chaque étape de cascade. Quand une question commence par _qui, quand, quoi_, le journal d'audit est la réponse. La page compagnon est la [politique de rétention](/fr/platform/admin/governance/policies-and-limits) — elle contrôle combien de temps ces lignes restent avant que le nettoyage ne les retire.
