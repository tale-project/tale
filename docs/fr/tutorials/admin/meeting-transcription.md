---
title: Transcription de réunions
description: Capturer l'audio d'une réunion en local avec Meetily et le résumer via un agent Tale.
---

Tale prend en charge la transcription audio de deux façons, et ce tutoriel d'intégration déroule la voie **entièrement locale**. S'il s'agit seulement de résumer des enregistrements ponctuels, déposer un fichier audio ou vidéo dans le chat est le chemin le plus court — la pipeline de transcription de la plateforme s'en occupe côté serveur, documentée sous [Pièces jointes du chat](/fr/platform/chat/attachments#audio-and-video-transcription). Pour un workflow de capture de réunion complet où l'audio brut ne quitte jamais le portable du présentateur, associe Tale à [Meetily](https://github.com/Zackriya-Solutions/meetily) — un enregistreur de réunions sous licence MIT, entièrement local, qui transcrit avec Whisper.cpp sur l'appareil et n'envoie que la transcription à un LLM pour résumé.

Le résultat à la fin est un flux de réunion où les octets audio ne franchissent jamais la frontière du poste, mais où le résumé qui en sort atterrit comme un fil de conversation Tale normal, avec la couverture d'audit et de rétention complète.

## Avant de commencer

Il te faut un accès Admin ou Propriétaire dans Tale, ainsi qu'une instance Tale joignable en HTTPS depuis le portable qui enregistrera. Il te faut aussi au moins un [agent](/fr/platform/agents/create) calibré pour le résumé ; le prompt système de l'étape 1 est un point de départ à coller. Sur le portable d'enregistrement, il te faut Meetily installé — voir la [dernière release](https://github.com/Zackriya-Solutions/meetily/releases) du projet, qui livre des builds pour macOS et Windows.

Pas de feature flag côté Tale, pas de permission par utilisateur au-delà d'Admin.

## Étape 1 — Configurer un agent de résumé

Un agent dédié donne aux résumés le modèle, le ton et la structure que tu veux, et garde les fils de réunion hors de l'historique de l'agent de chat général. Ouvre **Agents > Créer un agent** et colle le prompt ci-dessous comme instructions système :

```text
Tu es l'agent de résumé de réunion.

Entrée : une transcription brute d'une réunion, avec des étiquettes de locuteur possiblement imparfaites.
Sortie, en Markdown :
1. Un résumé d'un paragraphe.
2. Décisions — liste à puces, chacune avec la personne responsable.
3. Actions — liste à puces au format « Responsable — tâche — échéance (si mentionnée) ».
4. Questions ouvertes — liste à puces des points soulevés mais non tranchés.

Règles :
- N'invente pas de contenu. Si quelque chose n'est pas clair, dis-le.
- Préserve la langue de la transcription.
- N'inclus jamais de citation textuelle plus longue qu'une phrase.
```

Choisis un modèle costaud — la qualité prime sur le coût pour un appel une fois par réunion. Le reste de la configuration de l'agent suit [Créer un agent](/fr/platform/agents/create).

L'étape a fonctionné quand l'aperçu de chat de l'agent produit la structure en quatre sections sur une courte transcription de test collée dans le composer.

## Étape 2 — Créer un webhook pour l'agent

Ouvre l'onglet **Webhook** de l'agent et clique sur **Créer**. Tale génère une URL de la forme `https://<ton-instance-tale>/api/agents/wh/<TOKEN>` — le jeton fait 64 caractères hexadécimaux et est le seul identifiant. Quiconque détient l'URL peut invoquer cet agent ; traite-la comme une clé API, et désactive ou supprime le webhook pour révoquer l'accès.

Meetily parle des chat-completions OpenAI-compatibles, donc utilise le sous-chemin `/chat/completions` quand tu le configures à l'étape 4 :

```text
https://<ton-instance-tale>/api/agents/wh/<TOKEN>/chat/completions
```

L'étape a fonctionné quand l'onglet Webhook montre l'URL avec un bouton de copie et un interrupteur « Actif » activé.

## Étape 3 — Installer Meetily

Télécharge et installe Meetily depuis la page de releases du projet. La documentation du projet sur [meetily.ai](https://meetily.ai) et le [README GitHub](https://github.com/Zackriya-Solutions/meetily) couvrent l'installation par OS, y compris les permissions au premier lancement pour l'audio système. Enregistre un court clip de test — quinze secondes de toi en train de lire un paragraphe quelconque — et confirme que la transcription en direct apparaît dans le panneau latéral.

L'étape a fonctionné quand la transcription de test correspond à ce que tu as dit, confirmant que Whisper tourne localement sur le portable.

## Étape 4 — Pointer Meetily sur le webhook Tale

Dans les paramètres de Meetily, ouvre le panneau LLM provider (l'étiquette exacte varie par release — les builds récents utilisent **Settings > Models** ou **Settings > LLM provider**). Choisis l'option **Custom OpenAI-compatible** et configure :

| Champ       | Valeur                                                                                                                              |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| URL de base | L'URL `/chat/completions` de l'étape 2 — par ex. `https://<ton-instance-tale>/api/agents/wh/<TOKEN>/chat/completions`               |
| Clé API     | Toute valeur non vide — le jeton de l'URL est l'identifiant                                                                         |
| Modèle      | Un ID de modèle dans les `supportedModels` de l'agent (par ex. `openai/gpt-4o`) ; les valeurs non reconnues retombent sur le défaut |

Enregistre. Meetily envoie maintenant les résumés à travers l'agent Tale configuré.

L'étape a fonctionné quand l'UI des paramètres de Meetily montre le fournisseur enregistré et que « Test » (s'il existe) renvoie une réponse 200.

## Étape 5 — Enregistrer et résumer une réunion

Clique sur **Start recording** en haut de la prochaine réunion. Meetily transcrit localement — le CPU ou GPU du portable fait le travail, et pendant la réunion rien n'est téléversé. Quand la réunion se termine, arrête l'enregistrement et clique sur **Generate summary**. La transcription est envoyée en POST à Tale, l'agent tourne, et le résumé structuré apparaît dans Meetily à côté de la transcription.

Dans Tale, la requête devient un vrai fil de conversation sous l'agent de résumé — visible dans l'historique de l'agent, compté dans le grand livre d'utilisation de l'organisation, marqué dans le journal d'audit, et gouverné par les règles d'équipe et de base de connaissances de l'agent.

L'étape a fonctionné quand à la fois Meetily montre le résumé et l'historique de conversation de l'agent montre un nouveau fil avec le même contenu.

## Limite de confiance

Ce qui traverse le réseau dans chaque direction :

- **Audio** : ne quitte jamais le portable d'enregistrement. Whisper.cpp tourne localement ; aucun moment du flux n'envoie l'enregistrement brut.
- **Transcription** : traverse le réseau du portable à ton instance Tale via HTTPS, sous ton reverse proxy et ton auth existante. Elle ne va pas chez un tiers — Meetily parle directement à Tale.
- **Appel modèle sortant de Tale** : de Tale vers le fournisseur qui sert le modèle de l'agent. Pour garder ce tronçon dans le réseau aussi, marie ce tutoriel avec [Connecter un fournisseur local](/fr/tutorials/admin/connect-local-provider) — le LLM de résumé reste alors local également.
- **Prompt système du client** : tout message `system` envoyé par Meetily est concaténé après le prompt système propre à l'agent. Le prompt de l'agent cadre l'identité et la forme de sortie ; celui de Meetily ajoute le détail du cas d'usage.

La rétention suit les règles standard de Tale — le fil de résumé expire selon ta politique de rétention d'organisation, et l'accès est limité par l'onglet [Base de connaissances de l'agent](/fr/platform/agents/create#knowledge-tab) et les [règles d'équipe](/fr/platform/admin/teams).

## Dépannage

- **Erreurs de fenêtre de contexte sur de longues réunions** — la transcription dépasse la limite d'entrée du modèle. Bascule l'agent sur un modèle à plus grand contexte, ou pré-découpe la transcription dans les réglages de résumé de Meetily. Voir [Concepts d'agent — Modèle](/fr/platform/agents/concepts#model).
- **Meetily a fini en timeout** — le timeout côté client de Meetily est de 300 secondes, et une longue transcription sur un fournisseur lent peut le dépasser. Bascule sur un modèle plus rapide, raccourcis la transcription, ou réessaie ; le fil dans Tale détient toujours le résumé complet même si Meetily a abandonné.
- **Résumés dans la mauvaise langue** — la transcription était mélangée, ou le prompt n'a pas figé la langue de sortie. Resserre la section « Règles » des instructions de l'agent.
- **401 Unauthorized** — le jeton webhook est invalide ou le webhook est désactivé. Revérifie l'onglet **Webhook** de l'agent, bascule Actif, ou régénère.

## Où ça s'inscrit

Ce que tu as construit est une capture de réunion respectueuse de la confidentialité : l'audio brut reste sur le portable, seule la transcription traverse le réseau, et Tale gère le résumé comme une conversation d'agent normale — auditable, soumise à la rétention, à périmètre de savoir. Le compromis face au chemin de transcription côté serveur est une question de limite de confiance : Meetily place la gestion audio sous ta politique de poste, au prix d'une dépendance bureau supplémentaire.

Deux directions d'ici : fais passer les transcriptions par une automatisation plutôt qu'un appel d'agent unique avec [Déclencher une automatisation via webhook](/fr/tutorials/developer/trigger-automation-via-webhook), ou ferme la boucle côté modèle avec [Connecter un fournisseur local](/fr/tutorials/admin/connect-local-provider) pour que le LLM de résumé reste aussi dans le réseau.
