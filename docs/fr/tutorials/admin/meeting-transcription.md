---
title: Transcription de réunions
description: Capturer l'audio d'une réunion en local avec Meetily et la résumer via un agent Tale.
---

Tale ne transcrit pas l'audio côté serveur — la dictée du chat tourne entièrement dans le navigateur, et la plateforme n'a pas d'endpoint Whisper. Pour un workflow complet de capture de réunion (enregistrer l'audio système, transcrire, résumer, archiver), tu associes Tale à un outil local qui prend en charge l'audio. [Meetily](https://github.com/Zackriya-Solutions/meetily) est un enregistreur de réunions sous licence MIT, 100 % local, qui transcrit via Whisper.cpp sur l'appareil et n'envoie que la transcription à un LLM pour le résumé.

Ce découpage est important : l'audio brut ne quitte jamais le poste, Whisper tourne sur le laptop de la personne, et Tale ne voit que du texte. Tes règles de sécurité au niveau ligne, ta journalisation d'audit et ta gouvernance couvrent tout le chemin sensible, car tout ce qui atteint Tale est déjà un vrai thread de conversation d'agent.

## Ce que tu vas construire

Un flux de réunion où Meetily capture et transcrit l'audio en local, puis remet la transcription à un agent Tale qui produit un résumé structuré — participants, décisions, actions — stocké comme un thread de conversation normal sous cet agent.

## Prérequis

- Une instance Tale joignable en HTTPS, avec accès Admin et au moins un [agent](/fr/platform/agents/create) apte au résumé. Le prompt système de l'étape 1 ci-dessous est un bon point de départ.
- Meetily installé sur le poste qui enregistrera la réunion — voir la [dernière release](https://github.com/Zackriya-Solutions/meetily/releases) du projet. macOS et Windows sont supportés.

## Étape 1 — Configurer un agent de résumé

Crée un agent dédié pour que les résumés utilisent le modèle, le ton et le format voulus. Un prompt système de départ :

```text
Tu es l'agent de résumé de réunion.

Entrée : une transcription brute de réunion, éventuellement avec des étiquettes de locuteurs imparfaites.
Sortie en Markdown :
1. Un paragraphe de résumé.
2. Décisions — liste à puces, avec la personne responsable.
3. Actions — liste à puces au format « Owner — tâche — échéance (si indiquée) ».
4. Questions ouvertes — liste à puces des points soulevés mais non résolus.

Règles :
- Ne rien inventer. Si un point est flou, le dire.
- Conserver la langue de la transcription.
- Ne jamais citer de passage brut de plus d'une phrase.
```

Choisis un modèle capable — la qualité compte plus que le coût sur un appel ponctuel par réunion. Voir [Créer un agent](/fr/platform/agents/create) pour le reste de la configuration.

## Étape 2 — Créer un webhook pour l'agent

Ouvre l'onglet **Webhook** de l'agent et clique sur **Créer**. Tale génère une URL de la forme `https://<ton-instance-tale>/api/agents/wh/<TOKEN>`. Copie-la — tu la colleras dans Meetily à l'étape 4.

Traite l'URL du webhook comme une clé API : qui la possède peut invoquer cet agent. Désactiver ou supprimer le webhook révoque l'accès.

## Étape 3 — Installer Meetily

Télécharge et installe Meetily depuis la page des releases du projet ; les docs du projet sur [meetily.ai](https://meetily.ai) et le [README GitHub](https://github.com/Zackriya-Solutions/meetily) couvrent les étapes d'installation par OS, y compris les autorisations à accorder au premier lancement pour l'audio système. Vérifie que tu peux enregistrer un court clip et voir une transcription avant de continuer — ça confirme que Whisper tourne bien en local.

## Étape 4 — Pointer Meetily sur le webhook Tale

Dans `Settings > LLM provider` de Meetily (le label varie selon la version), choisis **Custom OpenAI-compatible** et règle :

| Champ    | Valeur                                                                        |
| -------- | ----------------------------------------------------------------------------- |
| Base URL | L'URL du webhook de l'étape 2 (p. ex. `https://<tale>/api/agents/wh/<TOKEN>`) |
| API key  | N'importe quelle valeur non-vide — le credential est le token dans l'URL      |
| Model    | N'importe quelle valeur — le modèle configuré de l'agent gagne                |

Sauvegarde. Meetily ajoutera automatiquement `/chat/completions` à la Base URL ; chaque résumé généré passe désormais par l'agent Tale configuré.

## Étape 5 — Enregistrer et résumer une réunion

À la prochaine réunion, clique **Start recording** en haut. Meetily affiche la transcription en direct dans un volet — l'audio est transcrit sur le CPU/GPU du laptop, rien n'est uploadé. À la fin, clique **Stop** puis **Generate summary**. La transcription est postée sur Tale, l'agent tourne, et le résumé apparaît à côté de la transcription dans Meetily.

Dans Tale, la requête devient un vrai thread de conversation sous l'agent de résumé — visible dans l'historique de conversations de l'agent, comptabilisé dans le ledger d'usage de l'organisation, tagué dans le journal d'audit, et régie par les règles d'équipe et de base de connaissances de l'agent.

## Notes de confidentialité

- **L'audio ne traverse pas le réseau.** Whisper.cpp tourne en local.
- **La transcription, elle, traverse le réseau** — vers ton instance Tale, en HTTPS, derrière ton reverse proxy et ton auth. Aucun tiers ne la voit.
- **La rétention** suit les règles standard de Tale. Si ta politique d'organisation est de sept jours, le thread de résumé expire sur ce calendrier ; voir [Gouvernance](/fr/platform/admin/governance).
- **L'accès** au résumé est cadré par l'[onglet Base de connaissances](/fr/platform/agents/create#onglet-base-de-connaissances) de l'agent et les règles d'[équipe](/fr/platform/admin/teams) — RLS d'agent standard.
- **Prompt système du client.** Tout message `system` envoyé par Meetily est concaténé après le prompt système de l'agent — les règles de l'agent cadrent l'identité et le format, le prompt de Meetily ajoute les détails d'usage.

## Dépannage

- **Erreurs de fenêtre de contexte sur les longues réunions** — la transcription dépasse la limite d'entrée du modèle. Bascule l'agent sur un modèle à plus grand contexte, ou pré-découpe la transcription dans les réglages de résumé de Meetily. Voir [Concepts d'agents — Modèle](/fr/platform/agents/concepts#modèle).
- **Timeout Meetily** — le timeout côté client de Meetily est de 300 secondes. Sur un fournisseur lent, une transcription longue peut le dépasser. Options : choisir un modèle plus rapide, raccourcir la transcription, ou réessayer après la fin de la génération (le thread dans Tale contiendra toujours le résumé complet).
- **Résumés dans la mauvaise langue** — soit la transcription était mixte, soit le prompt système n'épingle pas la langue de sortie. Resserre la section « Règles » du prompt.
- **Résumé vide ou refusé** — inspecte le thread de conversation de l'agent dans Tale ; la réponse complète du modèle (y compris les refus ou messages de gouvernance) y apparaît.
- **401 Unauthorized** — l'URL du webhook est invalide ou le webhook est désactivé. Vérifie Paramètres > agent > onglet **Webhook** ; bascule en actif, ou supprime et régénère.

## Ensuite

- Faire passer la même transcription dans un workflow plutôt qu'un appel d'agent unique : [Déclencher une automatisation via webhook](/fr/tutorials/developer/trigger-automation-via-webhook).
- Faire tourner le résumeur avec un modèle entièrement local comme backend : [Connecter un fournisseur local](/fr/tutorials/admin/connect-local-provider).
