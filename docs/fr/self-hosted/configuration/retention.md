---
title: Définir les limites de conservation
description: Fixe les limites par organisation, applique les changements après examen et comprends la suppression des données.
---
La conservation détermine combien de temps Tale garde chaque catégorie de données. L’opérateur fixe les limites autorisées ; l’admin de l’organisation active les catégories et choisit une durée dans ces limites. Une durée plus courte peut supprimer un historique existant : examine son effet avant de l’appliquer.

## Distinguer limites et politique

Deux fichiers sous `TALE_CONFIG_DIR/<orgSlug>/governance/` ont des fonctions différentes :

| Fichier | Fonction |
| --- | --- |
| `retention.yml` | Limites et valeurs par défaut définies par l’opérateur pour chaque catégorie. JSON est aussi accepté. |
| `retention-policy.yml` | Catégories actives et durées choisies par l’organisation. Les paramètres de gouvernance gèrent ce fichier. |

Chaque organisation reçoit ses propres fichiers à sa création. Modifier ceux d’une organisation ne change pas la politique d’une autre. Si son fichier de limites manque, Tale ne reprend pas celui d’une organisation `default`.

Chaque catégorie contient `min`, `max`, `default` et `unit`. Augmenter `min` impose de garder les données plus longtemps ; diminuer `max` réduit la durée autorisée. Aucune de ces valeurs n’active seule le nettoyage. La politique appliquée détermine si la catégorie est active.

## Modifier les limites d’une organisation

Pars de son fichier complet existant et conserve les catégories que tu ne modifies pas. Cet extrait montre une seule catégorie ; il ne remplace pas le fichier entier :

```yaml
chatHistory:
  min: 30
  max: 730
  default: 90
  unit: days
```

La plupart des catégories utilisent les jours ; `userTempHours` et `agentTempHours` utilisent les heures. La catégorie de consommation de tokens s’appelle `usageLedger`. Reprends les identifiants du fichier existant pour que la validation puisse détecter les erreurs.

Les variables d’environnement sont associées explicitement dans `_metadata.envNames`, à la racine du fichier, avec un préfixe facultatif `_metadata.envPrefix`. Le fichier livré associe par exemple `TALE_RETENTION_AUDIT_MIN` à `auditLog.min`. Une variable ne peut qu’augmenter le minimum ou diminuer le maximum. Redémarre les processus backend après avoir modifié leur environnement.

Deux minimums sont imposés : `auditLog.min` ne peut pas descendre sous 180 jours, ni `loginAttempt.min` sous 90 jours. Tale ne charge pas un fichier qui passe sous l’un d’eux. Tant que tu ne l’as pas corrigé, la **Politique de rétention** de l’organisation n’affiche aucune plage autorisée et ne peut pas être enregistrée ; les journaux du backend indiquent les deux minimums. Le nettoyage planifié continue d’utiliser les dernières limites appliquées.

Avec le fichier livré, une organisation peut conserver les journaux d’audit de 180 à 3650 jours. Une mise à niveau de Tale ne réécrit pas le fichier d’une organisation : une organisation créée par une version antérieure peut donc encore contenir `auditLog.min: 365`. Abaisse cette valeur pour autoriser une conservation plus courte des journaux d’audit, ou augmente-la si une réglementation ou un contrat exige un historique d’audit plus long.

## Examiner et appliquer un changement

Après avoir modifié les limites, demande à l’admin de l’organisation d’examiner la proposition dans [Politiques et limites](/fr/platform/admin/governance/policies-and-limits). Le nettoyage utilise les limites déjà appliquées ; une modification du fichier par l’opérateur ne les active pas silencieusement.

Vérifie les catégories actives, les anciennes et nouvelles durées et les éventuels délais de grâce. `auditLogRetentionDays: 730` est une durée choisie, tandis que `auditLog.min: 180` est une limite minimale. Distingue ces deux sens pendant la revue du diff.

<Tip>

Teste d’abord une durée réduite sur des données synthétiques. Vérifie qu’une donnée encore dans la période reste présente, qu’une donnée expirée suit le comportement de sa catégorie et qu’une donnée sous conservation légale reste protégée.

</Tip>

## Comprendre le nettoyage

Le worker backend effectue le nettoyage planifié par organisation. Les threads, documents, contacts et conversations externes ont un cycle de vie ; les catégories de lignes individuelles peuvent être supprimées directement après leur durée de conservation et leur délai de grâce. Ne suppose pas que chaque élément supprimé passe par la Corbeille.

Chaque cycle supprime un nombre limité d’éléments par catégorie et par organisation : jusqu’à 50 000 événements chat-filter, et des lots de 1 000 éléments au plus pour toutes les autres catégories. Un arriéré plus important, comme un long historique lors de la première activation d’une catégorie, se résorbe sur plusieurs cycles quotidiens.

La rétention des journaux d’audit est aussi propre à chaque organisation. Elle supprime le début éligible de sa chaîne d’audit, du plus ancien au plus récent, et s’arrête lorsqu’une ligne sous conservation légale doit rester. La durée plus courte d’un tenant ne réduit pas l’historique d’un autre.

Chaque nettoyage est consigné dans le [journal d’audit](/fr/platform/admin/governance/audit-logs) de l’organisation sous forme d’événements système de la catégorie Données. Il commence par **Cycle de rétention démarré**, ajoute un seul événement par catégorie où il a supprimé des éléments, avec leur nombre plutôt qu’un événement par élément, et se termine par **Cycle de rétention terminé**. Un cycle qui s’arrête sur une erreur, ou qui conserve des éléments arrivés à échéance parce que leur suppression a échoué, se termine plutôt par **Cycle de rétention en échec** ; le prochain nettoyage planifié tente à nouveau de les supprimer. Tous les événements d’un même cycle désignent le même cycle de rétention comme cible, et un cycle qui ne trouve rien à supprimer consigne tout de même son début et sa fin.

`TALE_RETENTION_DISABLED=true` suspend le nettoyage planifié pendant une maintenance contrôlée par l’opérateur. Cette variable ne restaure pas les données et ne désactive pas les autres voies de suppression. Consigne son activation et retire-la à la fin de la maintenance.

## Préserver les données sous conservation légale

Les conservations légales priment sur la rétention dans leur périmètre. Une conservation de l’organisation la protège dans son ensemble ; une conservation plus ciblée protège les entités ou personnes concernées. Consulte le [parcours de la conservation légale](/fr/platform/admin/governance/legal-hold) avant de modifier une politique qui les touche.

Une conservation légale ne remplace pas une sauvegarde. Une fois la suppression achevée hors conservation légale, augmenter la durée de rétention ne récupère pas les données. La restauration dépend d’une sauvegarde conservée et de l’état de déploiement correspondant.
