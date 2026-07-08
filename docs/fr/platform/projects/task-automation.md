---
title: Automatisation des tâches
description: Le pack task-ops par défaut — comment l'affectation à un agent le met au travail, la revue humaine obligatoire, les garde-fous (budgets, simultanéité, disjoncteurs) et l'arrêt d'urgence.
---

Affecter une tâche du board à un agent IA le met au travail. Le **pack task-ops** — onze workflows en fichiers, provisionnés pour chaque organisation — couvre tout le cycle de vie : triage, exécution, revue, escalade, respect des SLA et nettoyage. Chaque workflow est un fichier JSON qui appartient à votre organisation : ajustez les seuils, modifiez les prompts ou désactivez des déclencheurs individuels sur le workflow lui-même. Une tâche qu'une automatisation propose reste dans le [Backlog](/fr/platform/projects/backlog) jusqu'à ce qu'un humain la Démarre — à partir de ce moment, c'est une tâche de tableau comme une autre et elle entre dans la boucle ci-dessous.

## La boucle d'exécution

1. **Affectez** une tâche à un agent (ou laissez le _triage des non-affectées_ noter et router automatiquement les nouvelles tâches — les correspondances sûres sont affectées directement, les autres reçoivent un commentaire de suggestion).
2. L'agent **accuse réception** (la tâche passe à _En cours_), travaille dans son propre fil de tâche avec les outils dédiés et publie son résultat en commentaire.
3. La tâche se gare à **_En revue_** — les agents ne peuvent jamais passer une tâche à _Terminé_ ; cette règle est appliquée côté serveur, quelle que soit la configuration des workflows.
4. Un humain **approuve** (le seul chemin automatisé vers _Terminé_) ou **demande des modifications** — le retour réengage le même agent sur le fil partagé et ouvre une nouvelle revue. Les revues se traitent depuis la fiche de tâche ou directement depuis la boîte de réception.

Les échecs ramènent la tâche à _À faire_ avec un commentaire explicatif. Quand une tâche racine décomposée a des sous-tâches, la tâche parente attend la clôture de la dernière sous-tâche puis remonte à _En revue_.

## Mentions, dépendances, échéances

- **@-mentionne un agent** dans un commentaire ou dans la description d'une tâche : il lit le texte qui le mentionne et agit. Taper `@` ouvre une autocomplétion sur les membres et les agents du projet ; le composeur prévisualise si chaque agent mentionné répondra réellement (automatisation coupée, budget épuisé, en pause). Modifier une description ne déclenche que les mentions nouvellement ajoutées ; ce que l'automatisation écrit elle-même ne déclenche personne.
- Quand un **bloqueur se ferme**, les tâches dépendantes reçoivent le décompte des bloqueurs restants ; le travail d'agent totalement débloqué redémarre automatiquement, les humains sont notifiés.
- Les **échéances** pilotent une échelle SLA : avertissement à 24 h, relance de retard, puis escalade humaine vers le créateur du projet et les admins — répétée une fois si la tâche reste en retard. Chaque niveau ne se déclenche qu'une fois ; repousser l'échéance réinitialise l'échelle.

## Garde-fous

Chaque exécution d'agent — affectation, mention, révision, escalade, externe — passe la même porte d'admission :

- **Budgets** (par agent, mensuels) : au seuil d'alerte l'agent reçoit une consigne d'économie et les admins sont notifiés une fois ; au seuil de pause les nouvelles exécutions sont refusées. Réinitialisation au changement de mois.
- **Plafonds de simultanéité** (par agent et pour l'organisation) : les exécutions excédentaires attendent et démarrent dès qu'une place se libère.
- **Disjoncteur par tâche** : au-delà du nombre d'exécutions par heure configuré sur une même tâche, son automatisation se met en pause jusqu'à ce qu'un humain change son statut.

Les plafonds de l'organisation (simultanéité des exécutions, exécutions par tâche et par heure) sont des valeurs fixes de la plateforme ; le budget et le parallélisme par agent vivent dans sa configuration.

## L'arrêt d'urgence

La politique de gouvernance `task_automation` porte l'interrupteur principal : mettre `enabled: false` dans le fichier de configuration `governance/task-automation.json` de l'organisation arrête le chemin d'exécution — ce qui tourne se termine, rien de nouveau ne démarre. Réservé aux admins, audité.
