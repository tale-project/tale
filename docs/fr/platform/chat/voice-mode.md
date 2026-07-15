---
title: Mode vocal
description: Parler au lieu de taper — comment fonctionne l’aller-retour, quel modèle gère la reconnaissance vocale, lequel gère la synthèse, et ce que couvre la frontière de confidentialité.
---

Le mode vocal transforme le chat en microphone. Tu parles, Tale transcrit, l’agent répond en texte, et la réponse est lue à voix haute en retour. Toute la boucle se fait sans les mains — utile quand tu marches, tu conduis (légalement), tu cuisines, ou tu en as assez de taper.

Le chemin vocal du chat traverse deux fournisseurs de modèles (reconnaissance vocale, puis synthèse) et un ou deux appels d’agent entre les deux. Savoir quel fournisseur tient quel morceau de l’audio fait la différence entre « c’est pratique » et « c’est imprudent » pour les données de ton organisation.

## Comment le mode vocal s’exécute

Touche l’icône microphone sur le chat et l’enregistrement démarre ; touche-la à nouveau pour arrêter. Tale téléverse le clip audio, le modèle de reconnaissance vocale le transcrit, et la transcription devient le message suivant du chat — exactement comme si tu l’avais tapée. L’agent répond en texte ; une fois la réponse complète, Tale la route vers un modèle de synthèse et joue l’audio en retour. Pendant que la réponse défile, **Arrêté** met fin à la lecture plus tôt ; **Lire la sortie vocale** rejoue la dernière réponse.

## Passations STT et TTS

Deux choix de modèles comptent, et ils se configurent séparément du modèle de chat. La **reconnaissance vocale** tourne une fois par message parlé — l’audio est téléversé, transcrit, et la transcription est ce que l’agent voit. La **synthèse vocale** tourne une fois par réponse — Tale découpe la réponse en segments de sortie vocale et streame l’audio en retour. L’agent lui-même ne change pas ; le mode vocal est une enveloppe autour du même chat.

## Choisir la voix

Chaque agent peut épingler une voix préférée dans ses réglages ; sans choix par agent, le mode vocal utilise la voix par défaut de l’organisation. Les voix sont liées à des fournisseurs TTS précis — changer de fournisseur change les voix disponibles. Si un chat utilise un agent dont le fournisseur de voix n’est plus configuré, Tale retombe sur la voix par défaut de l’organisation plutôt que de faire échouer la réponse.

## La frontière de confidentialité

Le clip audio que tu enregistres quitte ton appareil. Il est téléversé dans le stockage de Tale, envoyé au fournisseur de reconnaissance vocale que tu as configuré, et la transcription est conservée dans l’historique du chat à côté des messages tapés. L’audio lui-même est conservé selon la politique de rétention de l’organisation. Les réponses partent vers le fournisseur de synthèse en texte brut ; la réponse audio est streamée vers ton appareil et n’est pas stockée sur disque par défaut.

<Warning>

Les organisations avec des règles strictes de sortie de région devraient choisir des fournisseurs STT et TTS dans la même région que le reste de la pile — voir [Résidence des données](/fr/cloud/data-residency).

</Warning>

## Quand la voix bat le texte

La voix est plus rapide que le clavier pour des questions courtes et conversationnelles, et nettement plus lente que le clavier pour du code, des listes, ou tout ce que tu recopierais. Les réponses vocales plafonnent à une limite de segments — les réponses longues s’arrêtent en cours de lecture et affichent un avis. Va vers la voix quand la réponse sera entendue une fois puis oubliée ; va vers le texte quand la réponse doit être parcourue ou conservée.

## Quand y recourir

| Utilise … quand                                           | Mode vocal | Texte |
| --------------------------------------------------------- | ---------- | ----- |
| Tu as les mains prises et tu veux un fait rapide          | ✓          |       |
| La réponse sera une longue liste ou un bloc de code       |            | ✓     |
| La réponse de l’agent nourrira une tâche écrite plus tard |            | ✓     |
| Tu pratiques une langue et tu veux l’entendre             | ✓          |       |

## Où ça s’inscrit

Le mode vocal est l’une des trois « formes d’entrée » sur le même chat : le texte (le défaut), les pièces jointes et la voix. L’histoire de la confidentialité compte le plus ici parce que deux fournisseurs supplémentaires touchent les données, donc la page à lire ensuite est [Résidence des données](/fr/cloud/data-residency) sur Cloud ou [Configuration → fournisseurs](/fr/self-hosted/configuration/providers) en auto-hébergé, selon l’édition que tu fais tourner.
