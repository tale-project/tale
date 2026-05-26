---
title: Mode Arène
description: Comparaison de modèles côte à côte dans le Chat — comment il s'affiche, comment choisir les concurrents, comment les verdicts alimentent l'analyse des retours et quand y recourir.
---

Le Mode Arène exécute le même prompt contre deux modèles en parallèle et te demande quelle réponse est la meilleure. Le verdict alimente l'analyse des retours de l'organisation ; avec le temps, les données disent quel modèle l'équipe préfère vraiment pour quel type de question, séparé du ressenti de chacun.

Va vers l'Arène quand choisir un modèle a été un débat plutôt qu'une décision — comparer des réponses côte à côte casse l'impasse avec des preuves plutôt qu'avec des opinions. Pour le travail ordinaire, le sélecteur de modèles classique suffit ; la valeur de l'Arène, ce sont les verdicts qu'elle produit, pas la vue de comparaison elle-même.

## Comment l'Arène s'affiche

Active **Activer le mode Arène** dans la zone modèle du composer et le textarea fait pousser deux sélecteurs de modèles étiquetés **Modèle A** et **Modèle B**. Envoyer un message exécute les deux modèles en parallèle ; l'écran se sépare et chaque réponse arrive en streaming dans sa propre colonne. Une fois les deux terminées, **Choisis un verdict** apparaît sous les colonnes avec quatre boutons : **A est meilleur**, **B est meilleur**, **Égalité**, **Les deux sont mauvais**.

## Choisir les concurrents

Les deux sélecteurs sont indépendants — n'importe quel modèle tagué chat que la politique de l'agent autorise est valable de chaque côté. Choisir le même modèle des deux côtés est permis (utile pour tester des différences de température si l'agent expose ça), mais la plupart des comparaisons traversent fournisseurs ou tailles. Les instructions, les connaissances et les outils de l'agent s'appliquent aux deux colonnes ; seul le modèle sous-jacent diffère.

## Émettre un verdict

Le verdict se fait en un clic. **A est meilleur** et **B est meilleur** s'expliquent d'eux-mêmes ; **Égalité** sert quand les deux réponses se valent à peu près ; **Les deux sont mauvais** quand aucune n'est acceptable. Le bouton que tu cliques enregistre le verdict et résout le chat sur la colonne gagnante — le message suivant que tu envoies ne va qu'à ce modèle. **Égalité** ou **Les deux sont mauvais** laissent les deux colonnes actives pour un tour supplémentaire.

## Où les verdicts apparaissent

Les verdicts remontent dans [Analyse des retours](/fr/platform/admin/governance/feedback-analytics) sous **Arena verdicts**, à côté d'un tableau **Top Model Matchups** qui classe les paires par taux de victoire. Les données sont scopées à l'organisation, pas par utilisateur, donc les verdicts d'une petite équipe peuvent peser plus que les défauts d'une grande équipe quand un admin utilise le tableau pour fixer le modèle par défaut de l'organisation.

## Quand y recourir

| Utilise … quand                                                         | Mode Arène | Sélecteur classique |
| ----------------------------------------------------------------------- | ---------- | ------------------- |
| Tu décides quel modèle mettre par défaut                                | ✓          |                     |
| Tu soupçonnes une régression de modèle après une mise à niveau          | ✓          |                     |
| Tu sais déjà quel modèle tu veux ; tu veux juste une réponse maintenant |            | ✓                   |
| La requête est courte et ordinaire                                      |            | ✓                   |

## Où ça s'inscrit

L'Arène est la boucle de retour légère par-dessus le choix de modèle. La surface lourde est [Analyse des retours](/fr/platform/admin/governance/feedback-analytics) — c'est là que les verdicts que tu émets deviennent un graphique avec lequel quelqu'un argumente plus tard sur les défauts. Si tu es celui qui lira le graphique plus tard, fais une poignée de tours d'Arène avant de le lire ; les verdicts que tu émets toi-même te disent si le cadrage du tableau correspond à ton expérience.
