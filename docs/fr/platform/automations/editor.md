---
title: L’éditeur de workflow
description: Le manuel d’exploitation de l’onglet Éditeur d’une automatisation — où vit son workflow, comment le lancer, le mettre en pause et le désactiver, comment l’éditer et comment l’historique versionné fonctionne. Lis ceci quand tu fais tourner un workflow au quotidien, pas quand tu apprends le modèle.
---

Cette page est le manuel d’exploitation du workflow qui vit dans une automatisation — la surface derrière l’onglet **Éditeur**. Le modèle mental — ce qu’une automatisation empaquette et ce qu’est une définition, un déclencheur et une exécution — vit sur [Concepts d’automatisation](/fr/platform/automations/concepts). Cette page est la moitié pratique : où vit le workflow, comment tu le lances depuis l’UI, comment tu le mets en pause sans le supprimer, comment tu édites et comment l’historique versionné fonctionne. Les rôles Éditeur et Développeur lisent ceci quand ils travaillent avec un workflow au quotidien.

## Où vivent les workflows

Les workflows n’ont pas d’onglet à eux dans la barre latérale. Un workflow appartient à l’automatisation qu’il fait tourner — ouvre l’automatisation et son onglet **Éditeur** est le workflow ; tu gères tout ce qui suit depuis là. Un lien direct vers un workflow continue de fonctionner quand quelqu’un le partage ; les favoris et les liens des cartes d’approbation et des vues d’exécution atterrissent sur le workflow lui-même. Chaque surface que cette page couvre (l’éditeur, l’onglet exécutions, l’historique de versions) pend à un workflow unique que tu as ouvert.

## Lancer un workflow

Trois chemins déclenchent un workflow.

L’onglet **Déclencheurs** du workflow attache les chemins de production : les **Planifications** se déclenchent sur un cron, les **Webhooks** acceptent un POST externe et les **Événements** s’abonnent à des signaux internes comme `task.created`. La [référence des déclencheurs](/fr/platform/automations/triggers) couvre chacun en profondeur.

**Tester le workflow** dans la barre d’outils de l’éditeur ouvre le panneau de test et lance une exécution ponctuelle. Colle le JSON d’entrée que l’exécution doit recevoir, clique sur **Exécuter**, et l’exécution apparaît dans l’onglet Exécutions avec son ID. Sers-toi du panneau de test quand tu itères sur un workflow et veux voir le journal d’exécution complet sans câbler de déclencheur d’abord.

Pendant que l’exécution tourne, le canevas la reflète en direct : chaque étape porte un badge de statut — un spinner pendant l’exécution, une coche en cas de succès, une alerte en cas d’échec, une icône pause en attente de saisie — et une bannière au-dessus du canevas nomme l’exécution affichée. Clique sur un badge pour inspecter la durée de l’étape, son erreur et un aperçu de sa sortie. L’exécution affichée tient dans le paramètre d’URL `execution` et survit donc à un rechargement ; ferme la bannière pour effacer les badges.

Le panneau de test reflète le même flux sous forme de liste d’étapes : chaque étape exécutée apparaît avec son statut en direct, les étapes répétées ou en boucle portent un compteur de tentatives, et une étape en échec affiche son message d’erreur en ligne — clique sur le nom de l’étape pour sauter directement à ses réglages. Quand une exécution échoue avant qu’aucune étape n’ait tourné — jamais démarrée, délai dépassé ou annulée —, le panneau nomme cette raison à la place. Les exécutions de test valident aussi l’entrée côté serveur contre le schéma de l’étape de départ : un champ manquant ou mal typé est rejeté avec un message précis avant même que l’exécution ne soit créée.

Le bouton **Déboguer** dans le même panneau lance l’exécution en mode pas à pas. Le moteur s’arrête avant chaque étape : l’étape en pause porte un badge de débogage sur le canevas, et le panneau montre quelle étape vient ensuite, avec les variables de l’exécution et la sortie de chaque étape terminée — tu vérifies donc ce qu’une étape va recevoir avant de la laisser tourner. **Pas à pas** exécute l’étape en pause et s’arrête de nouveau avant la suivante, **Continuer** déroule le reste du workflow sans autre pause, **Arrêter** annule l’exécution. Les exécutions de débogage apparaissent dans l’onglet Exécutions avec un badge _En pause (débogage)_ tant qu’elles sont en pause et `debug` comme source de déclenchement.

Le bouton **Exécution à blanc** dans le même panneau simule une exécution sans effets de bord — le workflow valide l’entrée, parcourt le graphe d’étapes et signale erreurs et avertissements sans appeler le moindre agent, la moindre API ni le moindre serveur de mail. Sers-toi de l’exécution à blanc quand le workflow n’est pas encore sûr à exécuter de bout en bout.

## Mettre en pause et désactiver

Mettre un workflow en pause sans le supprimer passe par les déclencheurs — chaque ligne de déclencheur porte un interrupteur **Actif**. Bascule chaque déclencheur sur off et le workflow cesse de se déclencher ; remets-les sur on pour reprendre. Le workflow lui-même reste en place et son historique reste intact.

Supprimer un workflow est permanent. Tale demande confirmation avant la suppression ; les exécutions et l’historique de versions partent avec le workflow.

## Éditer

Ouvre le workflow et l’éditeur affiche le graphe d’étapes sur un canevas — c’est la vue **Graphe**, l’une des deux façons de lire la même définition. Bascule sur **Spécification** et le même workflow se lit comme une description en langage naturel que tu peux éditer directement ; régénérer depuis l’une ou l’autre vue garde les deux synchronisées, et une bannière avertit quand elles ont divergé. Clique sur une étape du graphe pour ouvrir son panneau **Éditeur d'étapes** à droite ; le panneau porte le nom de l’étape, son type, sa configuration et les transitions vers les étapes suivantes en cas de succès et d’échec. La barre d’outils du canevas porte les contrôles de zoom, **Tester le workflow** et le bouton **Éditeur IA** — un chat qui édite le workflow à ta place, le même [Assistant d’automatisation](/fr/platform/automations/assistant) embarqué ici. Ajouter des étapes directement sur le canevas n’est pas encore possible ; les nouvelles étapes viennent de l’éditeur IA ou de la spécification.

La bannière **Ce workflow est actif — les modifications enregistrées s’appliquent aux nouvelles exécutions.** au-dessus du canevas dit exactement cela : les modifications d’un workflow déclenché prennent effet à la prochaine exécution. Désactive d’abord ses déclencheurs quand les modifications ne sont pas prêtes.

## Versionnage et historique

Chaque sauvegarde fige une nouvelle version du workflow. **Historique** dans la navigation du workflow liste les versions, plus récente en tête, chacune avec un horodatage et le membre qui a sauvegardé. En ouvrir une montre un diff **Comparer les modifications** contre la définition actuelle ; clique sur **Restaurer** pour revenir à cette capture. Restaurer crée une nouvelle version au sommet de l’historique — l’état restauré devient le nouvel état courant, et la version que tu as remplacée reste dans la liste.

L’historique est par workflow, pas par étape. Restaurer rétablit toute la définition ; les restaurations partielles vivent dans l’éditeur (copie la config de l’étape depuis le diff et colle-la dans la version actuelle).

Réinstaller ou mettre à jour l’automatisation à laquelle ce workflow appartient ne touche jamais à ces étapes — un workflow est exempté de cet écrasement, précisément pour que tes modifications survivent à une mise à jour du catalogue. Désinstalle l’automatisation et réinstalle-la pour récupérer à la place son dernier workflow livré.

## Où ça s’inscrit

Cette page est le manuel d’exploitation ; [Concepts d’automatisation](/fr/platform/automations/concepts) est le modèle mental. Les voisins naturels sont les [déclencheurs](/fr/platform/automations/triggers) (le coup d’envoi), les [journaux d’exécution](/fr/platform/automations/execution-logs) (le détail par exécution) et les [approbations dans les workflows](/fr/platform/automations/approvals-in-workflows) (la barrière humaine entre les étapes). Sers-toi de cette page quand tu travailles sur un workflow qui existe déjà ; sers-toi des concepts quand tu construis le premier.
