---
title: Mode Arène
description: La comparaison de modèles côte à côte dans le Chat — comment elle s’affiche, comment choisir les concurrents, comment les verdicts alimentent l’analyse des retours et quand y recourir.
---

Le Mode Arène exécute le même prompt contre deux modèles à la fois et te demande quelle réponse est la meilleure. Le verdict alimente l’analyse des retours de l’organisation ; avec le temps, les données disent quel modèle l’équipe préfère vraiment pour quel type de question, indépendamment du ressenti de chacun.

Va vers l’Arène quand le choix d’un modèle a été un débat plutôt qu’une décision — comparer des réponses côte à côte casse l’impasse avec des preuves plutôt qu’avec des opinions. Pour le travail ordinaire, le sélecteur de modèles classique suffit ; la valeur de l’Arène, ce sont les verdicts qu’elle produit, pas la vue de comparaison elle-même.

## Comment l’Arène s’affiche

Ouvre le menu plus du chat et choisis **Mode Arène** — le chat fait pousser deux sélecteurs de modèles étiquetés **Modèle A** et **Modèle B**. Envoyer un message exécute les deux modèles en parallèle ; l’écran se sépare et chaque réponse arrive en streaming dans sa propre colonne. Une fois les deux terminées, une rangée de verdict apparaît sous les colonnes avec quatre boutons : **A est meilleur**, **B est meilleur**, **Égalité**, **Les deux sont mauvais**.

<Frame caption="Le même prompt traité par deux modèles, avec la rangée de verdict en dessous.">

![Le Mode Arène avec un prompt de checklist de lancement traité dans deux colonnes — à gauche, Claude Haiku 4.5 rend une liste numérotée de cinq étapes, à droite, Claude Sonnet 4.6 regroupe le même travail sous des titres et ajoute les risques à signaler — au-dessus des boutons de verdict A est meilleur, B est meilleur, Égalité et Les deux sont mauvais.](/images/platform/chat-arena-split.webp)

</Frame>

<Note>

Les deux colonnes tournent avec le même agent — choisis l’agent qui t’intéresse avant d’activer l’Arène. La comparaison ne dit quelque chose que si les instructions, les tools et la connaissance sont identiques de part et d’autre.

</Note>

## Choisir les concurrents

Les deux sélecteurs sont indépendants — n’importe quel modèle que la politique de l’agent autorise est valable de chaque côté. Choisir le même modèle des deux côtés est permis (utile pour tester des différences de température si l’agent expose ça), mais la plupart des comparaisons traversent fournisseurs ou tailles. Les instructions, les connaissances et les tools de l’agent s’appliquent aux deux colonnes ; seul le modèle sous-jacent diffère.

## Émettre un verdict

Le verdict se donne en un clic. **A est meilleur** et **B est meilleur** parlent d’eux-mêmes ; **Égalité** sert quand les deux réponses se valent à peu près ; **Les deux sont mauvais** quand aucune n’est acceptable. Le bouton que tu cliques enregistre le verdict et résout le chat sur la colonne gagnante — le message suivant que tu envoies ne va qu’à ce modèle. **Égalité** ou **Les deux sont mauvais** laissent les deux colonnes actives pour un tour de plus.

## Où les verdicts apparaissent

Les verdicts remontent dans l’[Analyse des retours](/fr/platform/admin/governance/feedback-analytics) sous **Verdicts d'arène**, à côté d’un tableau **Top duels de modèles** qui classe les paires par taux de victoire. Les données sont à l’échelle de l’organisation plutôt que par utilisateur : une poignée de verdicts délibérés peut donc peser plus lourd qu’un gros tas d’habitudes quand quelqu’un lit le tableau pour décider vers quel modèle l’équipe devrait aller.

## Quand y recourir

| Utilise … quand                                                         | Mode Arène | Sélecteur classique |
| ----------------------------------------------------------------------- | ---------- | ------------------- |
| Tu décides quel modèle mettre par défaut                                | ✓          |                     |
| Tu soupçonnes une régression de modèle après une mise à niveau          | ✓          |                     |
| Tu sais déjà quel modèle tu veux ; tu veux juste une réponse maintenant |            | ✓                   |
| La requête est courte et ordinaire                                      |            | ✓                   |

## Où ça s’inscrit

L’Arène est la boucle de retour légère par-dessus le choix de modèle. La surface lourde est l’[Analyse des retours](/fr/platform/admin/governance/feedback-analytics) — c’est là que les verdicts que tu émets deviennent un graphique avec lequel quelqu’un argumentera plus tard sur les défauts. Si c’est toi qui liras le graphique, fais une poignée de tours d’Arène avant de le lire ; les verdicts que tu émets toi-même te diront si le cadrage du tableau correspond à ton expérience.
