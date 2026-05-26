---
title: Workflows
description: Le manuel d'exploitation de la fonctionnalité workflows — la vue liste, comment lancer un workflow, comment le mettre en pause et le désactiver, comment l'éditer et comment l'historique versionné fonctionne. Lis ceci quand tu fais tourner des automatisations au quotidien, pas quand tu apprends le modèle.
---

Workflows est le manuel d'exploitation de la fonctionnalité. Le modèle mental — ce qu'est un workflow, un trigger, une étape et une exécution — vit sur [Concepts des automatisations](/fr/platform/automations/concepts). Cette page est l'autre moitié : comment la vue liste est agencée, comment tu lances un workflow depuis l'UI, comment tu en mets un en pause sans le supprimer, comment tu édites et comment l'historique versionné fonctionne. Les rôles Éditeur et Développeur lisent ceci quand ils travaillent avec des workflows au quotidien.

La fonctionnalité s'atteint depuis **Automatisations** dans la barre latérale. La vue liste est le point d'entrée ; toute autre surface (l'éditeur, l'onglet exécutions, le tableau de bord des métriques) pend à un workflow unique que tu as ouvert depuis la liste.

## La vue liste

La liste affiche chaque workflow de l'organisation. La barre d'outils porte une zone de recherche, un bouton **Créer une automatisation** et une entrée de menu **Importer depuis un fichier** pour importer un JSON de workflow. Les colonnes sont le nom du workflow, la description, l'ensemble de triggers, l'horodatage de la dernière exécution et un menu d'actions de ligne (renommer, dupliquer, supprimer).

La liste charge en lazy au défilement. La recherche s'applique au nom et à la description. Un clic sur une ligne ouvre le workflow.

## Lancer un workflow

Trois chemins déclenchent un workflow.

L'onglet **Triggers** sur le workflow attache les chemins de déclenchement : un trigger manuel fait apparaître un bouton sous **Automatisations > Exécutions manuelles** que les membres peuvent cliquer, un trigger planifié se déclenche sur un cron, un trigger webhook accepte un POST externe, un trigger d'événement s'abonne à des événements internes. La [référence des triggers](/fr/platform/automations/triggers) couvre chacun en profondeur.

Le panneau **Tester l'automatisation** dans la barre d'outils de l'éditeur déclenche une exécution ponctuelle directement depuis l'éditeur. Colle le JSON d'entrée que l'exécution doit recevoir, clique **Exécuter** et l'exécution apparaît dans l'onglet Exécutions avec son ID. Sers-toi du panneau de test quand tu itères sur un workflow et veux voir le journal d'exécution complet sans câbler de trigger d'abord.

Le bouton **Dry run** dans le même panneau simule une exécution sans effets de bord — le workflow valide contre l'entrée, parcourt le graphe d'étapes et signale erreurs et avertissements sans appeler aucun agent, API ou serveur de mail. Sers-toi du dry run quand le workflow n'est pas encore sûr à exécuter de bout en bout.

## Mettre en pause et désactiver

Mettre un workflow en pause sans le supprimer passe par les triggers — chaque trigger porte un bouton **Activé**. Bascule chaque trigger sur off et le workflow cesse de se déclencher ; remets-les sur on pour reprendre. Le workflow lui-même reste dans la liste et son historique reste intact.

Supprimer un workflow est permanent et vit dans le menu d'actions de ligne de la vue liste. Tale demande confirmation avant la suppression ; les exécutions et l'historique de versions partent avec le workflow.

## Éditer

Ouvre le workflow et l'éditeur affiche le graphe d'étapes sur une canvas. Un clic sur une étape ouvre son panneau à droite ; le panneau porte le nom de l'étape, son type, sa configuration et les transitions vers les étapes suivantes en cas de succès et d'échec. La barre d'outils en haut de la canvas porte **Focus** (zoomer le graphe), **Assistant IA** (un chat qui édite le workflow à ta place), **Tester l'automatisation** et **Ajouter une étape**.

Un bandeau au-dessus de la canvas avertit quand le workflow a des triggers actifs — les modifications sur un workflow déclenché prennent effet immédiatement, donc une sauvegarde en pleine itération peut changer le comportement d'une exécution en cours. Mets les triggers en pause d'abord quand les modifications ne sont pas encore prêtes.

## Versionnage et historique

Chaque sauvegarde fige une nouvelle version du workflow. L'onglet **Historique** dans le rail gauche de l'éditeur liste les versions, plus récente en tête, chacune avec un horodatage et le membre qui a sauvegardé. Un clic sur une ligne ouvre un diff contre la définition actuelle ; un clic sur **Restaurer** revient à cette capture. Restaurer crée une nouvelle version en haut de l'historique — l'état restauré est le nouvel état courant, et la version que tu as remplacée reste dans la liste.

L'historique est par workflow, pas par étape. Restaurer rétablit toute la définition ; les restaurations partielles vivent dans l'éditeur (copie la config de l'étape depuis le diff et colle-la dans la version actuelle).

## Où ça s'inscrit

Workflows est le manuel d'exploitation ; [Concepts des automatisations](/fr/platform/automations/concepts) est le modèle mental. Les voisins naturels sont les [triggers](/fr/platform/automations/triggers) (le déclenchement), les [logs d'exécution](/fr/platform/automations/execution-logs) (le détail par exécution), les [métriques](/fr/platform/automations/metrics) (le bilan global) et les [approbations dans les workflows](/fr/platform/automations/approvals-in-workflows) (la barrière humaine entre étapes). Sers-toi de cette page quand tu travailles sur un workflow qui existe déjà ; sers-toi des concepts quand tu construis le premier.
