---
title: Connecter un fournisseur local
description: Ajouter Ollama ou vLLM comme fournisseur IA Tale pour que les agents tournent sur des modèles entièrement auto-hébergés.
---

Tale se connecte aux modèles IA via des [fournisseurs IA](/fr/platform/admin/providers) — tout endpoint OpenAI-compatible fait l’affaire, y compris des runtimes locaux comme [Ollama](https://ollama.com), [vLLM](https://docs.vllm.ai) et [LocalAI](https://localai.io). Faire tourner des agents sur un fournisseur local garde prompts, complétions et contexte de base de connaissances à l’intérieur de ton réseau ; rien n’atteint un fournisseur de modèles hébergé. Ce tutoriel déroule l’ajout d’Ollama comme fournisseur, l’attachement d’un modèle à un agent, et l’activation.

Il te faut un accès Admin. Un serveur Ollama ou vLLM qui tourne et que ton instance Tale peut joindre est le seul prérequis externe — voir leurs guides d’installation respectifs.

## Étape 1 — Lancer le runtime local

Pour Ollama sur le même hôte que Tale :

```bash
ollama pull llama3.3
ollama serve
```

Ollama écoute par défaut sur `http://localhost:11434`. Vérifie qu’il répond :

```bash
curl -s http://localhost:11434/api/tags | jq '.models[].name'
```

Si Tale tourne dans Docker, pointe sur l’hôte plutôt que `localhost` — sur Linux, utilise `http://host.docker.internal:11434` avec un extra-host Docker explicite, ou l’IP LAN de l’hôte. Voir [Configuration self-hébergée](/fr/self-hosted/configuration/environment-reference) pour les options réseau.

## Étape 2 — Ajouter le fournisseur dans Tale

Va dans **Paramètres > Fournisseurs IA** et clique **Ajouter un fournisseur**. Remplis :

| Champ           | Valeur                                               |
| --------------- | ---------------------------------------------------- |
| Nom             | `ollama-local` (slug, usage interne)                 |
| Nom d’affichage | `Ollama (local)`                                     |
| URL de base     | `http://host.docker.internal:11434/v1`               |
| Clé API         | N’importe quelle valeur non vide — Ollama n’auth pas |

Ajoute une entrée modèle par modèle runtime à exposer :

| Champ           | Valeur                                             |
| --------------- | -------------------------------------------------- |
| ID              | `llama3.3` (doit correspondre exactement à Ollama) |
| Nom d’affichage | `LLaMA 3.3`                                        |
| Tags            | `chat`                                             |

Sauvegarde. Le fournisseur apparaît dans la liste.

Pour vLLM le processus est identique ; l’URL de base est celle que tu as configurée (souvent `http://vllm.internal:8000/v1`), et l’ID du modèle doit correspondre au flag `--served-model-name` avec lequel tu as démarré vLLM.

## Étape 3 — Ajouter le modèle à un agent

Ouvre **Agents**, choisis l’agent qui doit tourner sur le modèle local, et ouvre son JSON dans `TALE_CONFIG_DIR/agents/<slug>.json`. Ajoute l’ID du modèle à `supportedModels` :

```json
{
  "supportedModels": ["llama3.3"]
}
```

Si deux fournisseurs définissent le même ID de modèle, préfixe avec le slug du fournisseur pour épingler le routage :

```json
{
  "supportedModels": ["ollama-local:llama3.3"]
}
```

Voir [Fournisseurs IA — Rendre les modèles disponibles aux agents](/fr/self-hosted/configuration/providers#rendre-les-modèles-disponibles-aux-agents) pour l’ensemble des règles.

## Étape 4 — Tester depuis le chat

Ouvre **Chat**, choisis l’agent et pose n’importe quelle question. Dans **Paramètres > Usage analytics** ou dans l’historique de conversations de l’agent, vérifie que la requête a été servie par `ollama-local` — l’ID du modèle apparaît dans les métadonnées du thread. La latence sera plus haute qu’un modèle frontier hébergé ; c’est attendu sur la plupart des machines.

Si Tale retombe sur un autre fournisseur, soit l’ID du modèle ne correspond pas à la liste Ollama, soit `supportedModels` contient encore une entrée de modèle frontier qui prend le pas — à retirer ou réordonner.

## Étape 5 — Brancher dans les tutoriels must-have

Les deux must-haves Admin profitent d’un fournisseur local :

- **Office Agents** — l’add-in frappe Tale ; Tale route vers le modèle local. Aucun changement côté add-in. Voir [Add-in Word & Excel](/fr/tutorials/admin/office-add-in).
- **Transcription de réunions** — Meetily fait déjà tourner Whisper en local ; ajouter un fournisseur local boucle la boucle pour que le LLM de résumé soit lui aussi local. Voir [Transcription de réunions](/fr/tutorials/admin/meeting-transcription).

## Dépannage

- **Tale ne joint pas Ollama depuis Docker** — `localhost` dans le conteneur Tale n’est pas l’hôte. Utilise `host.docker.internal` (Docker Desktop), l’IP LAN de l’hôte, ou mets Ollama et Tale sur le même réseau Docker.
- **404 sur modèle** — l’ID du modèle est sensible à la casse et doit correspondre à ce que `ollama list` affiche.
- **Réponses vides ou très courtes** — la fenêtre de contexte Ollama par défaut est petite. Tire une variante avec plus de contexte, ou override `num_ctx` dans le `Modelfile` du modèle.
- **Clé API chiffrée requise** — si tu édites les fichiers de fournisseurs directement, le fichier de clé API doit être chiffré avec SOPS. Définir la clé via l’UI gère le chiffrement ; voir [Fournisseurs IA — Secrets chiffrés par SOPS](/fr/self-hosted/configuration/providers#secrets-chiffrés-par-sops).
