---
title: Construire un outil personnalisé
description: Empaquette une fonction personnalisée en outil que les agents peuvent appeler, attache-la à un agent et observe-la apparaître en tool-call pendant un chat.
---

Un outil personnalisé est une fonction que tu écris et que le modèle d'un agent peut appeler par son nom. Tu déclares le schéma d'entrée et la forme de retour ; Tale s'occupe de la sérialisation, de la carte d'appel d'outil dans le chat et du renvoi du résultat au modèle. Ce parcours mène un outil personnalisé neuf de « j'ai une fonction en tête » à « l'agent l'appelle depuis un chat » sur une seule instance.

Il te faut le rôle Developer dans l'organisation et l'accès au panneau **Paramètres > Outils personnalisés** ; tout le reste se passe dans l'UI. Le concept sous-jacent vit dans [Outils d'agent](/fr/platform/agents/tools) ; la surface côté développeur — schémas, transport, erreurs — est l'objet ici.

## Avant de commencer

Confirme deux choses. Premièrement, ton rôle est au moins Developer — le panneau est caché en-dessous. Deuxièmement, tu as un agent éditable ; sinon, crée-en un via [Créer un agent](/fr/platform/agents/create) avant de continuer. Le parcours utilise un outil à une entrée et une sortie nommé `lookup_order` qui prend un ID de commande et renvoie une chaîne de statut — la plus petite forme qui exerce le schéma, l'appel et le rendu du résultat.

## Étape 1 — Définir l'outil dans Outils personnalisés

Le premier geste est d'enregistrer le nom de l'outil et son JSON Schema. Le schéma est ce que voit le modèle ; sans schéma, le modèle n'a aucune idée des arguments à émettre, et l'appel ne se produit jamais.

Ouvre **Paramètres > Outils personnalisés** et clique **Nouvel outil**. Donne-lui un nom (`lookup_order`), une description d'une phrase (`Look up the status of an order by ID`) et un JSON Schema pour l'entrée :

```json
{
  "type": "object",
  "properties": {
    "orderId": {
      "type": "string",
      "description": "The order ID, e.g. ORD-12345"
    }
  },
  "required": ["orderId"]
}
```

Enregistre. L'outil est désormais enregistré dans le registre des outils personnalisés de l'organisation ; aucun agent ne l'utilise encore.

## Étape 2 — Câbler l'implémentation

Un outil enregistré sans implémentation renvoie une erreur au modèle. Tale expose deux modes d'implémentation : un script sandbox inline (Python ou JavaScript, exécuté dans la sandbox de Tale) et un appel HTTPS sortant (Tale POST les arguments à ton endpoint, tu renvoies du JSON).

Choisis le mode HTTPS pour ce parcours — c'est la forme vers laquelle tu te tournes en production. Dans le panneau de détail de l'outil, règle :

- **URL de l'endpoint** — `https://your-api.example.com/lookup-order`
- **Méthode** — `POST`
- **En-tête d'auth** — un bearer token issu de ton gestionnaire de secrets

Tale POST `{ "orderId": "..." }` à ton endpoint ; ton endpoint renvoie `{ "status": "shipped", "carrier": "DHL", "eta": "2026-06-01" }`. Enregistre. L'outil personnalisé est câblé.

## Étape 3 — Attacher l'outil à un agent

Un outil câblé reste invisible aux agents jusqu'à ce qu'on en autorise un à l'appeler. Ouvre l'agent à étendre, clique **Outils**, descends jusqu'à **Outils personnalisés** et active `lookup_order`. Enregistre l'agent.

Ouvre un chat avec l'agent et demande « what is the status of order ORD-12345 ». Le chat affiche une carte d'appel d'outil `lookup_order` repliée entre ton message et la réponse ; la déplier montre les arguments émis par le modèle (`{ "orderId": "ORD-12345" }`) et le JSON renvoyé par ton endpoint. Le modèle écrit ensuite la réponse avec le résultat de l'outil.

## Où ça s'utilise

Un outil personnalisé est la couture entre un agent et ton domaine — recherche de commande, recherche interne, calculatrice, tout ce qu'une connector prête à l'emploi ne couvre pas. Le schéma est ce que le modèle utilise pour décider d'appeler, alors prends le temps d'écrire une description serrée et de ne garder que les champs nécessaires.

Pour des outils à partager entre organisations, voir [Serveur MCP depuis zéro](/fr/tutorials/developer/mcp-server-from-scratch) — MCP est le protocole pour « un outil, plusieurs instances Tale ». Pour le côté conceptuel de ce que font les outils dans un agent, voir [Outils d'agent](/fr/platform/agents/tools).
