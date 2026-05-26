---
title: Connecter un fournisseur local
description: Ajouter Ollama ou vLLM comme fournisseur IA Tale pour que les agents tournent sur des modèles entièrement auto-hébergés.
---

Tale se connecte aux modèles IA à travers des [fournisseurs](/fr/platform/admin/providers) — n'importe quel point de terminaison OpenAI-compatible convient, y compris des runtimes locaux comme [Ollama](https://ollama.com), [vLLM](https://docs.vllm.ai) et [LocalAI](https://localai.io). Faire tourner les agents sur un fournisseur local garde les prompts, complétions et contexte de base de connaissances dans ton propre réseau ; rien n'atteint un fournisseur de modèle hébergé. Ce tutoriel d'intégration parcourt l'ajout d'Ollama comme fournisseur, l'exposition d'un modèle aux agents, et la confirmation que l'inférence est locale.

Le résultat à la fin est un chemin d'isolation réseau fonctionnel : chaque chat ou automatisation qui choisit le modèle local route à travers du matériel que tu contrôles.

## Avant de commencer

Il te faut un accès Admin ou Propriétaire dans Tale — les deux rôles peuvent éditer les fournisseurs. Il te faut aussi un serveur Ollama ou vLLM fonctionnel et joignable depuis ton instance Tale en HTTP ; leurs guides d'installation respectifs couvrent le setup. Si Tale tourne en Docker, le runtime doit être joignable à travers le réseau Docker (la [référence réseau auto-hébergé](/fr/self-hosted/configuration/environment-reference) couvre les options). Pour Ollama il te faut en plus au moins un modèle déjà tiré — `ollama pull <name>` le télécharge.

Pas de compte externe, pas de clé API, pas de feature flag.

## Étape 1 — Démarrer le runtime local et vérifier qu'il répond

Un fournisseur qui n'atteint pas son point de terminaison est l'échec de configuration le plus fréquent, donc assure-toi que le runtime sert vraiment avant de pointer Tale sur lui. Pour Ollama sur le même hôte :

```bash
ollama pull llama3.3
ollama serve
```

Ollama écoute sur `http://localhost:11434` par défaut. Confirme avec une liste de modèles :

```bash
curl -s http://localhost:11434/api/tags | jq '.models[].name'
```

Si Tale tourne en Docker, `localhost` à l'intérieur du conteneur Tale est le conteneur lui-même — pointe sur l'hôte à la place. Sous Docker Desktop, utilise `http://host.docker.internal:11434` ; sous Linux, l'IP LAN de l'hôte avec une entrée `extra_hosts` explicite, ou mets Ollama et Tale sur le même réseau Docker.

L'étape a fonctionné quand le `curl` ci-dessus liste au moins un nom de modèle.

## Étape 2 — Ajouter le fournisseur dans Tale

Ouvre **Paramètres > Fournisseurs IA** et clique sur **Ajouter un fournisseur**. Remplis :

| Champ           | Valeur                                        |
| --------------- | --------------------------------------------- |
| Nom             | `ollama-local` (slug, utilisé en interne)     |
| Nom d'affichage | `Ollama (local)`                              |
| URL de base     | `http://host.docker.internal:11434/v1`        |
| Clé API         | Toute valeur non vide — Ollama n'a pas d'auth |

Ajoute une entrée de modèle par modèle runtime que tu veux exposer aux agents :

| Champ           | Valeur                                             |
| --------------- | -------------------------------------------------- |
| ID              | `llama3.3` (doit correspondre exactement à Ollama) |
| Nom d'affichage | `LLaMA 3.3`                                        |
| Étiquettes      | `chat`                                             |

Enregistre. Pour vLLM la procédure est identique — l'URL de base est celle avec laquelle tu as démarré vLLM (souvent `http://vllm.internal:8000/v1`) et l'ID de modèle doit correspondre à l'indicateur `--served-model-name`.

L'étape a fonctionné quand le fournisseur apparaît dans la liste des Fournisseurs IA avec un indicateur de santé vert.

## Étape 3 — Autoriser le modèle sur un agent

Ouvre **Agents**, choisis l'agent qui doit tourner sur le modèle local, et ouvre son fichier sous `TALE_CONFIG_DIR/agents/<slug>.json`. Ajoute l'ID de modèle à `supportedModels` :

```json
{
  "supportedModels": ["llama3.3"]
}
```

Si deux fournisseurs exposent le même ID, préfixe avec le slug du fournisseur pour figer le routage :

```json
{
  "supportedModels": ["ollama-local:llama3.3"]
}
```

Les règles complètes de routage — préférence de fournisseur, repli, quand le préfixe est requis — vivent dans [Fournisseurs — Rendre les modèles disponibles aux agents](/fr/self-hosted/configuration/providers#making-models-available-to-agents).

L'étape a fonctionné quand le composer de l'agent montre le modèle dans son menu déroulant de sélection.

## Étape 4 — Tester depuis le chat et confirmer que le modèle a servi la requête

Ouvre **Chat**, choisis l'agent, envoie un prompt court. La latence sera plus élevée qu'avec un modèle frontière hébergé — c'est normal. Ouvre ensuite l'historique de conversation de l'agent (ou **Analyse d'utilisation**) et confirme que le modèle utilisé pour la réponse était `llama3.3` et que le fournisseur était `ollama-local`.

Si un fournisseur différent a répondu, soit l'ID de modèle ne correspond pas à la liste d'Ollama (sensible à la casse), soit `supportedModels` contient encore une entrée de modèle frontière qui prime au routage.

L'étape a fonctionné quand les métadonnées du fil montrent `ollama-local` comme fournisseur.

## Limite de confiance

Ce qui traverse le réseau dans chaque direction, ce qui ne le fait pas :

- **De Tale au runtime local** : requêtes HTTP uniquement sur ton réseau privé, portant prompts, instructions système et tout morceau de base de connaissances récupéré. Avec Ollama ou vLLM sur le même hôte, le trafic ne quitte jamais le loopback.
- **Du runtime local à Tale** : réponses HTTP avec les complétions du modèle.
- **Du runtime local au fournisseur de modèle** : rien. Ollama et vLLM servent des modèles à poids ouverts depuis des fichiers locaux ; il n'y a pas d'appel amont.
- **De Tale à un fournisseur hébergé** : rien, **à condition** que chaque modèle vers lequel un agent pourrait basculer soit aussi local. Si `supportedModels` inclut un modèle hébergé à côté du local, une décision de routage pourrait envoyer une requête dehors — audite la liste avant de revendiquer l'isolation réseau.

Ce dernier point est l'écart le plus fréquent dans les déploiements revendiqués comme isolés : le fournisseur local est branché correctement, mais un repli sur un fournisseur hébergé est à une entrée de distance dans la configuration de l'agent.

## Dépannage

- **Tale n'atteint pas Ollama depuis Docker** — `localhost` dans le conteneur Tale est le conteneur, pas l'hôte. Bascule sur `host.docker.internal` (Docker Desktop), l'IP LAN de l'hôte avec une entrée `extra_hosts`, ou un réseau Docker partagé.
- **404 sur le modèle** — l'ID est sensible à la casse et doit correspondre exactement à ce qu'affiche `ollama list`. Recopie depuis le runtime, pas depuis la carte du modèle.
- **Réponses vides ou d'une phrase** — la fenêtre de contexte par défaut d'Ollama est petite. Tire une variante à plus grand contexte (`llama3.3:8k`, `llama3.3:128k`) ou redéfinis `num_ctx` dans le Modelfile du modèle.
- **Erreur de format de fichier clé API à l'édition** — éditer les fichiers de fournisseur directement nécessite de correspondre au mode de chiffrement : SOPS-chiffré quand `SOPS_AGE_KEY` est défini, JSON en clair sinon. Définir la clé via l'UI écrit la bonne forme pour toi. Voir [Fournisseurs — Stockage des secrets de fournisseur](/fr/self-hosted/configuration/providers#provider-secrets-storage).

## Où ça s'inscrit

Connecter un fournisseur local est le bloc d'isolation réseau : une fois en place, chaque autre surface Tale — agents, automatisations, chat — l'utilise de la même façon qu'elle utiliserait un fournisseur hébergé. La différence est opérationnelle (matériel local, latence plus lente, pas de coût par token) et de limite de confiance (pas de trafic vers un fournisseur de modèle) ; le comportement est le même.

Le chemin du fournisseur local se marie proprement avec deux autres tutoriels d'intégration : [Transcription de réunions](/fr/tutorials/admin/meeting-transcription) garde le chemin audio sur l'appareil pendant que le LLM de résumé reste local, et [Add-in Word & Excel](/fr/tutorials/admin/office-add-in) route le trafic Office à travers Tale vers le fournisseur que tu as configuré.
