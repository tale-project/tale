---
title: Configuration de rétention
description: Configure combien de temps sont conservés conversations, fichiers, audit et executions.
---

Tale a une configuration de rétention centrale qui s'applique à tous les domaines de données — conversations de chat, fichiers téléversés, audit logs, workflow executions et enregistrements d'analytics. Les valeurs par défaut conviennent à la plupart des déploiements ; ajuste-les quand les règles de conformité, les coûts ou la confidentialité imposent d'autres valeurs.

La rétention se configure à deux endroits :

- **Variables d'environnement** — le plancher, défini par l'opérateur qui déploie Tale. Les utilisateurs ne peuvent pas l'assouplir.
- **Interface de gouvernance** — surcharges par organisation dans la limite environnement. Voir [Gouvernance](/fr-CH/admin/governance).

## Variables d'environnement

Elles s'appliquent à chaque organisation du déploiement. Toutes les valeurs sont en jours.

| Variable                             | Défaut | Gouverne                                                               |
| ------------------------------------ | ------ | ---------------------------------------------------------------------- |
| `TALE_RETENTION_CONVERSATIONS_DAYS`  | `365`  | conversations de chat et leurs messages.                               |
| `TALE_RETENTION_FILES_DAYS`          | `365`  | fichiers téléversés dans le chat ou la base.                           |
| `TALE_RETENTION_AUDIT_DAYS`          | `730`  | entrées d'audit log.                                                   |
| `TALE_RETENTION_EXECUTIONS_DAYS`     | `90`   | détails d'execution de workflow. Résumés gardés 365 jours.             |
| `TALE_RETENTION_ANALYTICS_DAYS`      | `395`  | enregistrements d'analytics par requête.                               |
| `TALE_RETENTION_DELETION_GRACE_DAYS` | `30`   | enregistrements soft-deleted (corbeille) avant suppression définitive. |

Le job de suppression tourne chaque nuit à 03:00 UTC. Définis `TALE_RETENTION_DISABLED=true` pour suspendre totalement la suppression — utile pour debug, non recommandé en prod.

## Ordre et surcharges

La variable d'environnement est la limite supérieure. Une politique de gouvernance dans l'admin UI peut fixer la rétention de l'organisation **égale ou inférieure** à la valeur environnement. Cela permet aux opérateurs d'imposer un plancher de conformité tout en laissant les organisations sensibles à la confidentialité conserver moins.

Si une politique demande une rétention supérieure à celle permise par l'environnement, elle est rejetée avec un message clair.

## Legal hold

Quand un enregistrement d'audit est tagué en legal hold, la rétention est suspendue pour les conversations, fichiers et executions correspondants jusqu'à la levée. Legal hold se gère dans Gouvernance et est loggé dans le flux d'audit.

## Ce qui est supprimé

- Les lignes sont supprimées de la base.
- Les fichiers associés sont supprimés du stockage objet.
- Les embeddings vectoriels des documents supprimés sont retirés du store de connaissances.
- Les détails d'étape des executions sont purgés, mais les totaux agrégés restent pour analytics.

## Lié

- [Référence d'environnement](/fr-CH/operate/configuration/environment-reference) — liste complète des variables d'environnement Tale.
- [Gouvernance](/fr-CH/admin/governance) — surcharges de rétention par organisation et legal hold.
