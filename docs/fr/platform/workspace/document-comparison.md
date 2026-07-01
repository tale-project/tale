---
title: Comparaison de documents
description: La boîte de dialogue diff côte à côte qui prend deux documents — téléversés ou tirés de la bibliothèque — et parcourt les différences paragraphe par paragraphe avec un résumé assisté par RAG.
---

La comparaison de documents est la boîte de dialogue qui répond à la question « qu'est-ce qui a changé entre ces deux versions ». Tu lui pointes un document de base et un document de comparaison ; Tale les passe tous deux dans le même pipeline d'extraction qui alimente la base de connaissances, lance un diff déterministe au niveau du paragraphe, et rend le résultat sous la forme d'un parcours structuré des paragraphes ajoutés, supprimés et modifiés. C'est le bon outil pour les contrats avant-après, les révisions de politique, deux brouillons d'une même proposition — tout ce où les mots comptent et où les mots ont bougé.

La boîte de dialogue vit à côté des documents que tu compares : ouvre-la depuis **Connaissances > Documents** avec l'action **Comparer les documents**. Les fichiers de base et de comparaison peuvent chacun être un document déjà indexé de la bibliothèque ou un téléversement ponctuel, donc il n'y a pas besoin de charger les deux côtés dans la base de connaissances si tu veux seulement regarder un diff.

## Choisir les deux côtés

Deux sélecteurs siègent côte à côte : **Document de base** à gauche, **Document de comparaison** à droite. Chaque sélecteur a deux onglets — **Téléverser** et **Existant** — et chaque onglet remplit la même fente.

L'onglet Téléverser prend n'importe lequel des formats que le pipeline de la base de connaissances gère déjà : PDF, DOCX, DOC, ODT, XLSX, PPTX, texte brut, Markdown, CSV. Le fichier part dans le stockage objet de Tale, le même endroit que vivent les pièces jointes de chat et les documents de la bibliothèque ; il n'est pas indexé et pas lié à un agent, donc le téléversement est une entrée ponctuelle pour ce diff et rien d'autre. L'onglet Existant liste chaque document de la bibliothèque ayant un fichier téléchargeable — choisis-en un via le sélecteur recherchable et la fente se remplit avec le nom du document.

Mélange les onglets librement. Compare deux téléversements l'un contre l'autre quand aucune version n'est dans la bibliothèque, compare un téléversement contre un document de bibliothèque existant quand tu veux voir ce qu'un brouillon entrant change, ou compare deux documents de bibliothèque quand tu les as versionnés dans Connaissances.

## Lancer le diff

Clique **Comparer**. La boîte de dialogue affiche un spinner pendant que Tale télécharge les deux fichiers, extrait le texte, normalise les frontières de paragraphes, et lance un diff déterministe au niveau du paragraphe. La comparaison est le seul chemin sans modèle de la fonctionnalité — le diff lui-même est du pur appariement de chaînes, donc la sortie est reproductible pour les mêmes entrées.

L'attente est bornée — la requête timeoute à deux minutes si la comparaison n'a pas renvoyé de résultat. Les gros fichiers atteignent le timeout plus souvent que les petits ; s'il déclenche, retente une fois et envisage de tailler le fichier sur la partie qui compte.

## Lire le résultat

Quatre badges statistiques siègent au-dessus du diff : **Ajoutés**, **Supprimés**, **Modifiés**, **Inchangés**, chacun portant le nombre de paragraphes pour ce seau. Les badges sont aussi la légende du schéma de couleurs en dessous — vert pour ajouté, rouge pour supprimé, jaune pour modifié, neutre pour le contexte inchangé.

Sous les badges siège la liste des changements. Chaque entrée est un **bloc de changement** — une plage de changements contigus plus un paragraphe de contexte avant et après — rendu comme une seule carte. À l'intérieur de la carte, chaque paragraphe porte un signe en tête (`+` ajouté, `-` supprimé, `~` modifié, vide pour contexte) et un remplissage de couleur. Les paragraphes modifiés rendent le diff inline quand l'endpoint en fournit un — texte supprimé barré, texte ajouté surligné — et retombent sur la paire complète avant-après quand il n'en fournit pas.

Quand la base et la comparaison ont si peu en commun que le diff dit essentiellement « supprime tout, ajoute tout », un avertissement **Forte divergence** siège au-dessus de la liste des changements. C'est le diff qui te dit que les deux fichiers ne sont en fait pas deux versions du même document — ils peuvent être partis du même modèle mais les corps ont dérivé au-delà du point où un diff au niveau du paragraphe est la bonne forme.

## La bannière de troncature

L'endpoint plafonne le nombre de blocs de changement pour que la boîte de dialogue reste utilisable. Quand le plafond mord, une bannière **Résultats tronqués** siège sous les stats : les blocs affichés sont les plus significatifs, les totaux dans les badges reflètent toujours la paire de fichiers complète. Le plafond porte uniquement sur l'affichage — le diff sous-jacent voit chaque paragraphe.

## Quand y recourir

Recours à la comparaison de documents quand la question est « qu'est-ce qui a changé », pas « que dit ce texte ». Pour « que dit ce texte », téléverse le fichier en tant que pièce jointe de chat ou charge-le dans la base de connaissances et demande à un agent — le modèle est meilleur pour lire de la prose que le diff. Le diff est meilleur pour lire deux fichiers en parallèle et rapporter quels paragraphes diffèrent, ce que fait tout outil diff à numéros de ligne, mais étendu au texte extrait de tout format que le pipeline supporte. La lecture suivante à mettre en file est [Documents](/fr/platform/knowledge/documents) — elle couvre le pipeline d'indexation que la comparaison partage avec le reste de la base de connaissances, et où vivent les documents versionnés une fois que tu les as comparés.
