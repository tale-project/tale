---
title: Comparer les modèles dans l’Arène
description: Envoie une même demande à deux modèles, évalue leurs réponses et choisis comment poursuivre le chat.
---

Le **Mode Arène** compare deux modèles à partir du même message. Les deux côtés utilisent l’assistant de chat et le même contexte de départ. Choisis une question dont tu peux vérifier la réponse : une préférence ne suffit pas à établir l’exactitude.

## Lancer une comparaison

Ouvre un chat privé, puis le menu **+** de la zone de saisie et choisis **Mode Arène**. Un chat partagé ne peut pas entrer dans ce mode. Choisis les modèles sous **Modèle A** et **Modèle B**, puis envoie ton message. Tu peux sélectionner deux fois le même modèle pour observer les variations, ou deux modèles différents pour comparer leur comportement.

Pour commencer, fournis une source courte et une demande précise, par exemple : « Liste les trois décisions de ces notes de réunion et cite la phrase qui justifie chacune. » Conserve la même source, les mêmes instructions et le même format demandé des deux côtés.

<Frame caption="Le même prompt traité par deux modèles, avec la rangée de verdict en dessous.">

![Le Mode Arène avec un prompt de checklist de lancement traité dans deux colonnes — à gauche, Claude Haiku 4.5 rend une liste numérotée de cinq étapes, à droite, Claude Sonnet 4.6 regroupe le même travail sous des titres et ajoute les risques à signaler — au-dessus des boutons de verdict A est meilleur, B est meilleur, Égalité et Les deux sont mauvais.](/images/platform/chat-arena-split.webp)

</Frame>

Chaque réponse apparaît dans sa colonne. Attends qu’elles soient toutes deux terminées avant de choisir un verdict ; les boutons restent indisponibles tant qu’un côté répond. Le délai fait aussi partie du résultat. Si un côté échoue, examine son erreur avant d’en tirer un jugement sur la qualité.

## Évaluer les réponses

Vérifie les faits dans la source, le respect des instructions, les informations essentielles manquantes et les corrections nécessaires avant utilisation. Une réponse plus longue ou plus assurée n’est pas forcément meilleure.

| Verdict | Quand le choisir | Le chat continue avec |
| --- | --- | --- |
| **A est meilleur** | A est plus utile ou plus exact. | La colonne A. |
| **B est meilleur** | B est plus utile ou plus exact. | La colonne B. |
| **Égalité** | Les deux répondent aussi bien à la demande. | La colonne A. |
| **Les deux sont mauvais** | Aucune réponse n’est acceptable. | La colonne A. |
| **Quitter sans verdict** | Tu ne souhaites pas noter ce résultat. | La colonne A, sans verdict. |

Chaque choix termine la comparaison à deux colonnes. Le message suivant est envoyé dans le chat conservé. Réactive l’Arène pour comparer à nouveau : une égalité ne maintient pas les deux colonnes actives.

## Retrouver le feedback enregistré

Lorsque les deux modèles ont répondu, le verdict alimente l’[analyse des retours](/fr/platform/admin/governance/feedback-analytics) de l’organisation. Les administrateurs peuvent y examiner les verdicts de l’Arène et les comparaisons entre modèles. Quitter sans verdict n’ajoute aucune note.

Essaie plusieurs questions représentatives avant de conclure sur un modèle. Un bon résumé court ne prédit pas forcément ses résultats sur du code ou de longs documents. Les préférences de l’organisation incluent aussi les tâches des autres personnes.

## Débloquer une comparaison

Si un modèle manque, consulte le [catalogue des modèles](/fr/platform/models) pour vérifier son fournisseur et les règles d’accès. Si les boutons de verdict restent indisponibles, les deux générations doivent d’abord se terminer. Un échec peut venir des identifiants, de la disponibilité ou d’une règle : utilise la cause affichée pour décider quoi corriger avant de réessayer.
