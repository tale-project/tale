---
title: Exploitation de la workforce
description: Runbook du pack d'automatisation task-ops — vagues de déploiement, arrêt d'urgence, table symptôme→action et où regarder quand l'automatisation des agents déraille.
---

La page de l'opérateur pour l'automatisation de la workforce IA. Les surfaces produit vivent dans l'application (**Agents → Workforce** est le centre opérationnel) ; cette page couvre le déploiement, l'arrêt d'urgence et le diagnostic.

## Vagues de déploiement

Le pack se provisionne par organisation avec des désactivations persistantes (les modifications de l'organisation gagnent toujours ; une ré-exécution ne réactive jamais un déclencheur désactivé par un admin) :

1. **Vague 0 — interne** : activer pour une organisation interne (`provisioning/provision_task_ops_pack` avec activation), surveiller la bande de santé Workforce pendant une semaine. Sortie : zéro échec d'automatisation non traité.
2. **Vague 1 — provisionné, coupé** : toutes les organisations reçoivent le pack inactif ; les admins l'activent eux-mêmes via l'interrupteur Workforce. Sortie : bande de santé propre 72 h sur les organisations activées.
3. **Vague 2 — activé par défaut** : activation par défaut pour les organisations n'ayant jamais touché l'interrupteur.

## L'arrêt d'urgence

**Temps jusqu'au calme : moins de deux minutes.** Couper l'interrupteur principal (Agents → Workforce, admins seulement, audité) — ou exécuter l'opération `workflows/ops/disable_task_ops_pack` — fait deux choses : désactive tous les déclencheurs du pack (l'ordonnanceur cesse de les scanner) et verrouille le chemin d'exécution lui-même (politique `task_automation`), de sorte qu'un événement déjà en file ne démarre plus aucun travail d'agent. Ce qui tourne se termine ; rien de nouveau ne démarre.

Vérification : la page Workforce affiche l'automatisation **coupée** ; les nouvelles affectations ne produisent plus de commentaire d'accusé ; `[TaskOpsKillSwitch]` apparaît dans les logs backend.

## Symptôme → action

| Symptôme                                              | Cause probable                                       | Action                                                                             |
| ----------------------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Les tâches affectées aux agents ne font rien          | Automatisation coupée ou déclencheurs inactifs       | Interrupteur Workforce ; Automatisations → vérifier les déclencheurs `tasks/…`     |
| Travail bloqué _En cours_ > 24 h                      | Exécution morte ; le balayage la ramènera            | Vérifier l'historique d'exécutions ; le balayage horaire remet à _À faire_         |
| Un agent refuse toute exécution                       | Pause budgétaire ou disjoncteur                      | Workforce → files « à traiter » ; relever le budget ou changer le statut en humain |
| Les revues s'accumulent                               | Les relecteurs manquent la boîte de réception        | Les rappels escaladent automatiquement à 4 h / 24 h ; vérifier les préférences     |
| Les exécutions externes échouent en `runtime_offline` | Aucun daemon en ligne pour l'adaptateur              | Paramètres → API → Runtimes : statut ; `tale-daemon status` sur la machine         |
| La synthèse signale des chiffres `capped`             | Journée très active ayant atteint un plafond de scan | Les chiffres sont des bornes basses ; aucune action                                |

## Où regarder

- **Logs** : préfixes stables — `[AgentTaskRun]`, `[ExternalRuns]`, `[WorkforceRollup]`, `[TaskOpsKillSwitch]`, `[RetentionCleanup]` — avec des champs clé=valeur. Les contenus de prompts ne sont jamais journalisés.
- **Trace par tâche** : l'historique d'exécutions de la fiche relie chaque exécution à son exécution d'automatisation.
- **Cycle de vie des données** : les enregistrements suivent la catégorie de rétention `agentRuns` (180 jours par défaut, réglable 30–400) ; les agrégats sont purgés à 400 jours fixes ; les décisions de revue survivent pseudonymisées à un effacement RGPD.
