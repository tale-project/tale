---
title: Webhooks d’agent
description: L’onglet Webhooks de l’agent — des URL uniques que des systèmes externes appellent en POST pour chatter avec l’agent sans passer par l’interface, le token dans l’URL servant d’identifiant.
---

L’onglet **Webhooks** d’un agent crée des URL uniques que des systèmes externes peuvent appeler en POST pour chatter avec l’agent — rien de l’interface n’est impliqué. Va vers lui quand quelque chose hors de Tale a besoin que l’agent réponde : un bot Slack, un gestionnaire de formulaire, un job planifié.

Cette page couvre la seule surface webhook par agent. Pour les déclencheurs entrants qui lancent une automatisation plutôt qu’un agent, voir [Automatisations → déclencheurs](/fr/platform/automations/triggers) ; pour la surface développeur complète, voir [Développer → référence API](/fr/develop/api-reference).

<Frame caption="L’onglet Webhooks — un webhook en service avec son interrupteur Actif et l’heure du dernier déclenchement.">

![L’onglet Webhooks de l’éditeur d’agent montrant le bouton Créer un webhook et un tableau avec une URL de webhook, un interrupteur actif et un dernier déclenchement encore à jamais.](/images/platform/agent-editor-webhooks.webp)

</Frame>

## Créer un webhook

Ouvre l’agent, passe à **Webhooks** et clique sur **Créer un webhook**. Le dialogue montre la nouvelle URL une seule fois — mets-la de côté, parce que le token embarqué dans l’URL fait office d’identifiant d’authentification. Il n’y a ni clé API séparée ni en-tête : quiconque détient l’URL peut chatter avec l’agent, donc traite-la comme un secret.

## L’appeler

Envoie un POST avec un corps JSON portant un champ `message` ; la réponse est celle de l’agent :

```bash
curl -X POST https://tale.yourcompany.com/api/agents/wh/<token> \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello"}'
```

Trois champs façonnent l’appel :

- **`stream`** — ajoute `"stream": true` et la réponse arrive en server-sent events au lieu d’une seule réponse JSON.
- **`threadId`** — sans lui, chaque POST démarre une conversation neuve ; passe l’identifiant de fil d’une réponse précédente pour en continuer une avec son contexte intact.
- **Fichiers** — envoie du `multipart/form-data` avec un champ `message` et un ou plusieurs champs `file` pour joindre des fichiers au message.

L’action **Exemples d'utilisation** de chaque ligne ouvre des exemples prêts à l’emploi pour tout cela, remplis avec la vraie URL de la ligne.

## Le point de terminaison compatible OpenAI

Ajouter `/chat/completions` à l’URL du webhook expose un point de terminaison ChatCompletion à la OpenAI, pour que les clients OpenAI du commerce puissent pointer sur un agent : utilise l’URL du webhook comme URL de base, n’importe quelle valeur non vide comme clé API, et comme identifiant de modèle l’un de ceux que l’organisation propose. L’agent n’épingle aucun modèle propre : c’est donc dans ce champ que l’appelant fait le choix que ferait sinon le composer. Les téléversements de fichiers ne sont pris en charge que sur l’URL de base du webhook, pas sur ce sous-chemin.

## Gérer et révoquer

Le tableau montre l’URL de chaque webhook, un interrupteur **Actif** et le moment de son dernier déclenchement. Éteindre un webhook le met en pause sans perdre l’URL ; le supprimer est le geste de révocation — tout système qui utilise encore cette URL perd l’accès, donc provisionne le webhook de remplacement avant de retirer l’ancien.

## Où ça se situe

Les webhooks sont la surface d’intégration légère, par agent — juste quand l’intégration est « cet agent répond à cette seule chose ». Pour des flux plus riches avec des étapes et des approbations, modélise le travail comme une [automatisation](/fr/platform/automations/concepts) et pointe l’appelant sur le déclencheur webhook de l’automatisation — [Déclencher une automatisation par webhook](/fr/tutorials/developer/trigger-automation-via-webhook) parcourt cette forme de bout en bout.
