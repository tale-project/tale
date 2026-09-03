---
title: Rétention
description: Comment la rétention à l'échelle de l'organisation est configurée — bornes opérateur dans les variables d'env et contrôles UI sous Gouvernance pour les chats, documents, audit logs.
---

La rétention dans Tale est la policy qui supprime les vieilles données sur un planning — chats, documents, audit logs, exécutions de workflow, lignes du ledger d'usage de tokens. L'opérateur fixe les bornes (minimums et maximums) par catégorie ; l'admin de chaque organisation choisit la fenêtre de rétention réelle dans ces bornes via **Paramètres > Gouvernance > Politique de rétention**. La séparation existe pour qu'une équipe d'hébergement puisse imposer des planchers de compliance sans micromanager chaque tenant.

Cette page couvre la surface opérateur. Les contrôles côté admin et les descriptions par catégorie vivent dans [Gouvernance > Politique de rétention](/fr/platform/admin/governance/policies-and-limits).

## Comment marchent les bornes

Chaque catégorie de rétention — fils de chat, documents, contacts, fournisseurs, templates de prompt, lignes de ledger, audit logs, exécutions de workflow, logs de triggers de workflow, tentatives de login — a un `min` et un `max`. Un admin d'org fixe une valeur dans cette fenêtre. Resserrer le plancher sur une instance existante est un flow en plusieurs étapes : l'opérateur propose la nouvelle borne, chaque admin affecté voit une bannière, le changement s'applique une fois accepté.

| Catégorie                    | Plancher typique | Pourquoi                                                  |
| ---------------------------- | ---------------- | --------------------------------------------------------- |
| Historique de chat           | 30 j             | La plupart veulent du contexte récent, pas pour toujours  |
| Documents                    | 1 a              | Les connaissances vieillissent lentement                  |
| Audit logs                   | 1 a minimum      | Les frameworks de compliance attendent un an              |
| Ledger d'usage de tokens     | 90 j             | Analytics et rapports de budget s'appuient sur les lignes |
| Logs d'exécution de workflow | 30 j             | Le debugging remonte rarement plus loin                   |
| Tentatives de login          | 30 j             | L'enquête brute-force a besoin de la trace d'audit        |

Les défauts livrés sont lâches ; resserre selon ta posture de compliance.

## Où tu fixes les bornes

Sous la disposition org-first, les bornes de rétention sont **par org** : édite `retention.json` directement dans le sous-arbre d'une org sous `TALE_CONFIG_DIR` (par défaut `/app/data/` dans le conteneur plateforme, le fichier se trouve donc à `/app/data/<org>/retention.json`, p. ex. `/app/data/default/retention.json`). Chaque org a son propre fichier ; celui de l'org `default` est le modèle qu'un nouveau déploiement reprend au premier démarrage.

```json
{
  "chatHistory": { "min": 30, "max": 730, "unit": "days" },
  "documents": { "min": 1, "max": 3650, "unit": "days" },
  "auditLog": { "min": 365, "max": 3650, "unit": "days" },
  "tokenLedger": { "min": 90, "max": 1095, "unit": "days" }
}
```

Le conteneur plateforme surveille le fichier ; les changements proposent une mise à jour de bornes pour chaque org existante. Les admins voient la proposition dans leur écran **Politique de rétention** et l'appliquent eux-mêmes. L'étape propose-puis-applique est délibérée : resserrer un plancher raccourcit l'historique, ce qui est une action destructive qu'aucun opérateur ne devrait poser silencieusement sur chaque tenant.

Les fenêtres de rétention choisies par l'admin vivent dans un fichier distinct, `retention-policy.json`, à côté des bornes dans le même dossier `governance/`. Il contient des champs plats `<catégorie>Enabled` / `<catégorie>RetentionDays` (p. ex. `"auditLogEnabled": true, "auditLogRetentionDays": 730`), pas les bornes `min`/`max`. Ce fichier est écrit par **Paramètres > Gouvernance > Politique de rétention** dans l'app, donc les admins ne l'éditent normalement jamais à la main — garde-le distinct du fichier de bornes géré par l'opérateur.

## Le sweep de rétention

Un job planifié dans `tale-backend-worker` fait la suppression réelle. Chaque catégorie est sweepée indépendamment — un run lent sur une ne bloque pas les autres. Les suppressions sont auditées (chaque catégorie a son propre événement `*.retention_deleted`), et restaurer une entité dans sa fenêtre de grâce est possible depuis **Corbeille** avant le sweep final.

Les entrées d'audit log sont elles-mêmes soumises à la rétention, mais leur plancher est imposé par déploiement, pas par org : la rétention d'audit log la plus stricte (la plus courte) à travers toutes les orgs est ce qui tourne effectivement. Un tenant plus strict tire tout le monde plus serré — garde ça en tête sur les instances multi-tenants.

## Legal hold

Un legal hold gèle la rétention pour un scope spécifique : un fil unique, un enregistrement client, ou toute une organisation. Les entités tenues sautent le sweep jusqu'à ce que le hold soit relâché. Le hold lui-même est audité ; les holds à l'échelle de l'org sont assez bruyants pour que l'UI fasse remonter une confirmation avant qu'ils s'appliquent.

## Où cela s'inscrit

Le fichier de bornes est le levier de l'opérateur ; les fenêtres par catégorie que l'admin voit sont documentées dans [Politique de rétention](/fr/platform/admin/governance/policies-and-limits). Si tu fixes des bornes contre un framework de compliance (RGPD, HIPAA, SOC 2), le plancher d'audit log est habituellement ce que les auditeurs vérifient en premier.
