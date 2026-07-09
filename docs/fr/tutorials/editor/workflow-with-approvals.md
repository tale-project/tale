---
title: Construire un workflow avec approbation
description: Laisse l'Éditeur IA construire un workflow à trois étapes où une décision humaine s'intercale entre le brouillon et l'envoi, approuve sa proposition, puis lance le tout et inspecte le journal.
---

Un workflow avec une décision humaine au milieu est la forme vers laquelle tu te tournes quand le travail comporte un brouillon, une relecture et une action — et que tu veux une personne entre le brouillon et l'action. Le run se met en pause comme **En attente de saisie** jusqu'à ce que quelqu'un réponde ; l'étape suivante ne se déclenche qu'avec le feu vert. Ce parcours construit un workflow de résumé quotidien de cette façon, et tu croises en chemin les deux portes humaines : approuver la proposition de l'Éditeur IA, puis répondre au run en pause.

Il te faut un rôle Éditeur et un agent qui produit un brouillon (le premier agent utile de [Construire ton premier agent](/fr/tutorials/editor/first-agent-end-to-end) suffit). Le côté conceptuel vit dans [Concepts d’automatisation](/fr/platform/automations/concepts) et [Concepts d'approbation](/fr/platform/approvals/concepts) ; ce parcours est le mécanisme de bout en bout.

## Avant de commencer

Confirme trois choses. Ton rôle est au moins Éditeur — l'édition de workflow est verrouillée à Éditeur et au-dessus. Tu as un agent rédacteur de brouillon prêt ; sans lui, l'étape de brouillon n'a rien à invoquer. Et tu peux répondre à la relecture toi-même — le run en pause attend un humain, et dans ce parcours, cet humain, c'est toi.

## Étape 1 — Ouvrir un workflow dans l'éditeur

Les workflows vivent dans l'automatisation qu'ils animent : ouvre l'automatisation et son onglet **Éditeur** est le workflow, avec le graphe d'étapes sur le canevas. Pour ce parcours, ouvre un workflow à toi ou un workflow du pack task-ops provisionné dans ton organisation — tout ce que tu as le droit de modifier convient, puisque c'est de toute façon l'Éditeur IA qui construit la nouvelle définition pour toi.

## Étape 2 — Décrire le workflow à l'Éditeur IA

Active l'**Éditeur IA** dans la barre d'outils du canevas et décris toute la forme en un seul message :

> Chaque jour ouvré à 8 h, fais résumer par l'agent <ton agent> les messages clients non lus d'hier en un paragraphe, puis fais relire le brouillon par un humain, et n'envoie au canal d'équipe que le texte approuvé.

L'Éditeur IA répond par une carte de proposition — **Créer le workflow** avec le nombre d'étapes, ou **Mettre à jour le workflow** s'il retravaille celui que tu as ouvert. Tant que la carte est en attente, rien ne touche la définition : déplie-la, vérifie les étapes listées — une étape **LLM** pour le brouillon, la pause de relecture, l'envoi — et approuve-la. Le changement s'applique et se versionne comme n'importe quelle sauvegarde manuelle.

## Étape 3 — Attacher la planification

Passe à l'onglet **Déclencheurs** et clique **Ajouter une planification**. Prends le préréglage **Tous les jours** et ajuste le cron aux jours ouvrés (`0 8 * * 1-5`) — ou décris l'horaire en langage courant et clique **Générer** pour laisser l'IA écrire le cron. **Variables du workflow** se préremplit depuis le schéma d'entrée du workflow ; laisse la proposition telle quelle. La ligne apparaît avec l'interrupteur **Actif** déjà activé.

## Étape 4 — Lancer et répondre à la relecture

De retour dans l'éditeur, ouvre **Tester le workflow**, colle le JSON d'entrée proposé et clique **Exécuter**. Le panneau reflète le run étape par étape : l'étape de brouillon se déclenche, puis le run se met en pause — **En attente de saisie** — et la relecture arrive comme une carte-formulaire qui porte le brouillon. Remplis-la et clique **Soumettre la réponse** pour approuver, ou **Répondre différemment** pour renvoyer du texte libre ; le run reprend avec ta réponse et l'étape d'envoi se déclenche.

Ouvre l'onglet **Exécutions** et déplie le run : le journal montre une entrée par étape — le brouillon produit par l'agent, qui a répondu à la relecture et quoi, et l'envoi avec sa sortie. Ce journal est la piste d'audit ; le même enregistrement naît à chaque futur run planifié.

## Où ça mène

Rédiger, décider, agir — avec la décision entre les mains d'un humain — est le plus petit workflow-avec-approbation utile, et tu l'as construit sans poser une seule étape à la main : l'Éditeur IA a proposé, tu as approuvé, le run a demandé, tu as répondu. La même forme passe à l'échelle — ajoute une seconde relecture avant une étape destructrice, ou laisse [Approbations dans les workflows](/fr/platform/automations/approvals-in-workflows) te montrer les autres portes autour d'un workflow. Pour le vocabulaire derrière définition, déclencheur et exécution, [Concepts d’automatisation](/fr/platform/automations/concepts) est la page que ce parcours a supposée connue.
