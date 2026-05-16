---
title: Versions des agents
description: Itère sur un agent en production en toute sécurité — chaque enregistrement atterrit dans l'historique, et tout snapshot passé peut être comparé à l'état actuel et restauré en un clic.
---

Les agents de Tale s'enregistrent automatiquement pendant que tu les modifies, et chaque enregistrement atterrit dans un historique propre à l'agent. Les instructions, les filtres de connaissances, les outils, le préréglage de modèle, les amorces et les cibles de délégation sont capturés ensemble — restaure un snapshot passé et tout le paquet revient de manière atomique. Cette page couvre la boucle d'itération : ce que contient une entrée d'historique, comment comparer deux snapshots et quand restaurer est le bon geste.

Le modèle mental derrière les quatre boutons que tu règles vit dans [Concepts des agents](/fr/platform/agents/concepts) ; le flux de création qui produit ces snapshots vit dans [Créer un agent](/fr/platform/agents/create).

## Comment fonctionnent les enregistrements et les snapshots

Les modifications de la configuration d'un agent s'enregistrent automatiquement — un indicateur en haut à droite de l'éditeur montre l'état courant (enregistrement, enregistré). Chaque enregistrement crée une entrée d'historique qui capture toute la configuration de l'agent à cet instant : instructions, sélecteur de modèle, périmètre de connaissances, interrupteurs d'outils, amorces, cibles de délégation. Pas d'enregistrement partiel, pas de demi-état ; si l'enregistrement a réussi, l'entrée est complète.

Les conversations en cours continuent contre l'état de l'agent tel qu'il était au moment où le message a démarré — personne ne voit un changement de personnalité au milieu d'une réponse parce que quelqu'un a enregistré une nouvelle modification entre-temps.

## Ouvrir l'historique

Pour parcourir les snapshots, ouvre le menu **Historique** dans l'éditeur d'agent. La liste affiche chaque snapshot avec l'acteur et la date, les plus récents en premier. Chaque ligne correspond à un enregistrement ; survole une ligne pour un aperçu en infobulle, ou ouvre la boîte de dialogue de diff pour comparer un snapshot à l'état actuel.

Si la liste est vide, l'agent n'a pas été modifié depuis sa création — le premier enregistrement créera la première entrée d'historique.

## Comparer deux snapshots

Clique sur une entrée d'historique pour ouvrir la boîte de dialogue **Comparer les modifications**. La vue montre l'état actuel d'un côté et le snapshot de l'autre, avec les différences mises en évidence au niveau du champ. Sers-t'en pour repérer ce qu'une coéquipière ou un coéquipier a changé dans l'enregistrement de mercredi dernier, ou pour vérifier la formulation exacte d'une instruction avant d'y revenir. Si le snapshot est identique à l'état actuel, la boîte de dialogue affiche _Aucune différence trouvée_ et le bouton **Restaurer cette version** est désactivé.

## Restaurer un snapshot passé

Pour ramener l'agent à un snapshot passé, ouvre-le dans la boîte de dialogue de diff et clique sur **Restaurer cette version**. La restauration est destructive pour la configuration actuelle — Tale ne capture pas un snapshot de l'état courant avant d'appliquer la restauration, donc enregistre d'abord si tu veux garder tes modifications en cours. La restauration prend effet immédiatement pour toutes les nouvelles conversations ; les réponses en cours terminent contre leur état d'origine.

Sers-toi de la restauration quand une modification récente s'est mise à produire de moins bonnes réponses — mauvais ton, périmètre manquant, accès d'outil cassé — et que tu veux retirer les changements sans les démêler un par un. Pour un rollback incrémental (ne réinitialiser que les instructions, garder le nouvel outil), ouvre le snapshot en référence et copie le champ souhaité dans l'éditeur actuel, plutôt que de lancer une restauration complète.

## Agents par fichier

Les agents définis dans `TALE_CONFIG_DIR/agents/*.json` portent leur historique de versions dans ton dépôt git plutôt que dans la liste d'historique en-produit. Modifie le fichier, committe le changement, et la plateforme reprend la nouvelle configuration à la prochaine synchronisation. L'interface d'historique dans l'éditeur affiche toujours les snapshots que la plateforme a capturés à la dernière modification du fichier, mais pour les agents par fichier la source de vérité reste le dépôt. Voir [Développement assisté par l'IA](/fr/develop/ai-assisted-development) pour le workflow par fichier.

## Où ça s'inscrit

L'historique est le filet d'itération pour les agents. La seule chose à retenir : chaque enregistrement crée un snapshot, donc réécrire les instructions d'un agent est sans risque — si la nouvelle version produit de moins bonnes réponses, la précédente est à un clic. Sers-toi de la boîte de dialogue de diff pour chaque changement significatif afin de confirmer que le snapshot capture bien ce que tu attendais ; passe à la restauration quand une modification récente s'est mise à produire de moins bons résultats et que tu veux récupérer l'état précédent en bloc.

Pour le flux de création lui-même — nommer, sélectionner le modèle, écrire les instructions, choisir les connaissances et les outils — retourne à [Créer un agent](/fr/platform/agents/create). Pour le modèle mental derrière les quatre boutons que tu règles, [Concepts des agents](/fr/platform/agents/concepts).
