---
title: Connecte ton propre modèle
description: Connecte des serveurs d'inférence auto-hébergés (Ollama, vLLM, LocalAI) comme fournisseurs Tale.
---

Tout serveur d'inférence qui expose une API compatible OpenAI peut être utilisé comme fournisseur. Ça permet de faire tourner Tale contre des modèles sur ton matériel, en gardant prompts et réponses entièrement sur ton infrastructure.

Serveurs couramment utilisés :

- [Ollama](https://ollama.com) — `http://localhost:11434/v1`
- [vLLM](https://docs.vllm.ai) — `http://localhost:8000/v1`
- [LocalAI](https://localai.io) — `http://localhost:8080/v1`
- [llama.cpp server](https://github.com/ggerganov/llama.cpp) — `http://localhost:8080/v1`

## Connecter un modèle auto-hébergé

1. Va dans **Paramètres > Fournisseurs IA** et clique **Ajouter un fournisseur**.
2. Entre un nom (ex. `ollama`), un nom d'affichage et la base URL de ton serveur.
3. Entre une clé API (n'importe quelle chaîne non vide si ton serveur ne demande pas d'auth).
4. Ajoute un ou plusieurs modèles — l'ID doit matcher le nom servi par ton endpoint (ex. `llama3` pour Ollama).
5. Choisis les tags (en général `chat` pour les modèles de langue).

### Exemple : Ollama

```json
{
  "displayName": "Ollama (local)",
  "baseUrl": "http://localhost:11434/v1",
  "models": [
    {
      "id": "llama3.3",
      "displayName": "LLaMA 3.3",
      "tags": ["chat"]
    },
    {
      "id": "mistral",
      "displayName": "Mistral 7B",
      "tags": ["chat"]
    }
  ]
}
```

## Notes réseau

Quand Tale tourne en Docker et Ollama sur l'hôte Docker, utilise `http://host.docker.internal:11434/v1` comme base URL sur Mac et Windows. Sous Linux, ajoute `extra_hosts: ["host.docker.internal:host-gateway"]` au service platform dans `compose.yml` ou utilise l'IP de la gateway bridge Docker.

## Voir aussi

- [Fournisseurs IA](/fr/platform/admin/providers) — gestion des fournisseurs au quotidien dans l'admin UI.
- [Référence d'environnement](/fr/self-hosted/configuration/environment-reference) — `TALE_CONFIG_DIR` et variables liées.
