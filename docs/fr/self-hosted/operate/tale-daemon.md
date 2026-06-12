---
title: tale-daemon
description: Exécuter le travail des tâches sur vos propres machines avec des CLIs d'agents de code locaux (Claude Code, Codex, OpenCode) — installation, cadence, isolation, permissions et gestion des échecs.
---

`tale-daemon` exécute les tâches du board Tale sur une machine que vous contrôlez, avec les CLIs d'agents de code que vous avez déjà : **Claude Code** (`claude`), **Codex** (`codex`) et **OpenCode** (`opencode`). Liez un agent à une runtime dans sa configuration : ses tâches affectées sont envoyées au daemon au lieu de la boucle de modèle interne de Tale ; le résultat revient en commentaire (avec statistique de diff) et la tâche se gare à _En revue_ comme tout travail d'agent.

## Installation

```sh
bunx tale-daemon setup    # URL de base, clé API, espace de travail, plafond de permission
bunx tale-daemon start    # enregistrement + boucle de réclamation (Ctrl-C draine l'exécution)
bunx tale-daemon status   # configuration, CLIs détectées, connectivité serveur
```

`setup` génère une identité stable et stocke la configuration dans `~/.tale-daemon/config.json` (mode 600). Utilisez une clé API Tale normale (**Paramètres → API → REST**) ; définissez `TALE_DAEMON_API_KEY` pour garder la clé hors du fichier. Les daemons connectés apparaissent sous **Paramètres → API → Runtimes** avec leur statut en direct.

## Confidentialité & permissions

- Les **chemins locaux ne quittent jamais la machine** — seules les clés d'espace de travail que vous choisissez sont annoncées au serveur.
- La permission effective d'une exécution est **min(configuration serveur, plafond du daemon)**. `full_auto` (saut des permissions / accès complet) exige donc un opt-in des _deux_ côtés. La valeur par défaut est `safe`.

## Comment les exécutions se déroulent

- **Cadence** : le daemon interroge le serveur avec un backoff piloté par celui-ci (3 s après du travail, 15 s au repos, plafonné à 60 s après dix minutes d'inactivité — un daemon inactif coûte environ une requête par minute). Un battement de cœur de 15 s pendant une exécution renouvelle le bail et récupère les annulations (SIGTERM).
- **Isolation** : chaque exécution se déroule dans son propre worktree git sur une branche `tale/run-…`. Rien n'est poussé ; la statistique de diff accompagne le rapport.
- **Sessions** : les exécutions de révision (retours de revue) reprennent la session CLI précédente quand l'adaptateur le permet.

## Gestion des échecs

| Situation                                          | Comportement                                                                |
| -------------------------------------------------- | --------------------------------------------------------------------------- |
| Aucun daemon ne réclame l'exécution sous 2 minutes | Échec (`runtime_offline`), la tâche revient à _À faire_ avec un commentaire |
| Le daemon meurt en cours d'exécution (bail perdu)  | Une reprise depuis un worktree propre, puis échec                           |
| L'exécution dépasse 30 minutes                     | Timeout dur, traitement comme ci-dessus                                     |
| La CLI sort avec un code d'erreur                  | Une reprise, puis échec avec extrait de l'erreur                            |

Toutes les exécutions externes partagent l'enregistrement interne — budgets, plafonds de simultanéité et métriques s'appliquent à l'identique.
