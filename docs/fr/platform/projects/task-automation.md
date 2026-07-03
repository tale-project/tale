---
title: Automatisation des tâches
description: Le pack task-ops par défaut — comment l'affectation à un agent le met au travail, la revue humaine obligatoire, les garde-fous (budgets, simultanéité, disjoncteurs) et l'arrêt d'urgence.
---

Affecter une tâche du board à un agent IA le met au travail. Le **pack task-ops** — treize workflows en fichiers, provisionnés pour chaque organisation — couvre tout le cycle de vie : triage, exécution, revue, escalade, respect des SLA et nettoyage. Chaque workflow est un fichier JSON qui appartient à votre organisation : ajustez les seuils, modifiez les prompts ou désactivez des déclencheurs individuels sous **Automatisations**.

## La boucle d'exécution

1. **Affectez** une tâche à un agent (ou laissez le _triage des non-affectées_ noter et router automatiquement les nouvelles tâches — les correspondances sûres sont affectées directement, les autres reçoivent un commentaire de suggestion).
2. L'agent **accuse réception** (la tâche passe à _En cours_), travaille dans son propre fil de tâche avec les outils dédiés et publie son résultat en commentaire.
3. La tâche se gare à **_En revue_** — les agents ne peuvent jamais passer une tâche à _Terminé_ ; cette règle est appliquée côté serveur, quelle que soit la configuration des workflows.
4. Un humain **approuve** (le seul chemin automatisé vers _Terminé_) ou **demande des modifications** — le retour réengage le même agent sur le fil partagé et ouvre une nouvelle revue. Les revues se traitent depuis la fiche de tâche ou directement depuis la boîte de réception.

Les échecs ramènent la tâche à _À faire_ avec un commentaire explicatif. Les managers de l'organigramme des agents **découpent** les tâches racines étiquetées `epic` en sous-tâches pour leurs subordonnés directs au lieu de les traiter seuls ; la tâche parente attend la clôture de la dernière sous-tâche puis remonte à _En revue_.

## Mentions, dépendances, échéances

- **@-mentionne un agent** dans un commentaire ou dans la description d'une tâche : il lit le texte qui le mentionne et agit. Taper `@` ouvre une autocomplétion sur les membres et les agents du projet ; le composeur prévisualise si chaque agent mentionné répondra réellement (automatisation coupée, budget épuisé, en pause). Modifier une description ne déclenche que les mentions nouvellement ajoutées ; ce que l'automatisation écrit elle-même ne déclenche personne.
- Quand un **bloqueur se ferme**, les tâches dépendantes reçoivent le décompte des bloqueurs restants ; le travail d'agent totalement débloqué redémarre automatiquement, les humains sont notifiés.
- Les **échéances** pilotent une échelle SLA à quatre niveaux : avertissement à 24 h, relance de retard, exécution directe par l'agent manager, puis escalade humaine vers le créateur du projet et les admins. Chaque niveau ne se déclenche qu'une fois ; repousser l'échéance réinitialise l'échelle.

## Garde-fous

Chaque exécution d'agent — affectation, mention, révision, escalade, externe — passe la même porte d'admission :

- **Budgets** (par agent, mensuels) : au seuil d'alerte l'agent reçoit une consigne d'économie et les admins sont notifiés une fois ; au seuil de pause les nouvelles exécutions sont refusées et les tâches ouvertes sont transférées selon la politique de l'organisation (au manager, ou désaffectées pour le triage). Réinitialisation au changement de mois.
- **Plafonds de simultanéité** (par agent et pour l'organisation) : les exécutions excédentaires attendent et démarrent dès qu'une place se libère.
- **Disjoncteur par tâche** : au-delà du nombre d'exécutions par heure configuré sur une même tâche, son automatisation se met en pause jusqu'à ce qu'un humain change son statut.

Les valeurs par défaut de l'organisation vivent sous **Paramètres → Gouvernance** (politique `agent_workforce`) ; le budget et le parallélisme par agent dans sa configuration.

## L'arrêt d'urgence

**Agents → Workforce** porte l'interrupteur principal : couper l'automatisation des tâches met en pause les déclencheurs du pack ET le chemin d'exécution lui-même — ce qui tourne se termine, rien de nouveau ne démarre. Réservé aux admins, audité. Voir le [runbook d'exploitation](/self-hosted/operate/workforce-operations).
