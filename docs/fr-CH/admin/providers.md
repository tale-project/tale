---
title: Fournisseurs IA
description: Configure et gère les fournisseurs de modèles IA pour ton organisation.
---

Tale se connecte aux modèles IA via des **fournisseurs** — des endpoints API compatibles OpenAI. Chaque fournisseur a une base URL, une clé API et une ou plusieurs définitions de modèles. En sortie d'usine, Tale livre un fournisseur exemple [OpenRouter](https://openrouter.ai) qui donne accès à des modèles d'OpenAI, Anthropic, Google, Mistral, Meta et d'autres via une seule clé API.

Cette page couvre la gestion quotidienne dans l'admin UI. Pour connecter des modèles auto-hébergés (Ollama, vLLM, LocalAI, etc.), voir [Bring your own model](/fr-CH/build/integrations/providers).

## Gérer les fournisseurs

Les fournisseurs se gèrent dans **Paramètres > Providers** de la management UI. Les admins peuvent :

- **Ajouter un fournisseur** avec nom, display name, base URL, clé API et un ou plusieurs modèles.
- **Éditer un fournisseur** pour modifier display name, description, base URL et modèles par défaut. La description aide les utilisateurs à comprendre l'usage. Les modèles par défaut pré-sélectionnent celui utilisé pour chat, vision et embedding.
- **Supprimer un fournisseur** pour le retirer complètement.

Chaque définition de modèle inclut un ID (doit matcher le nom attendu par l'API), un display name et un ou plusieurs tags (`chat`, `vision`, `embedding`) qui contrôlent où le modèle apparaît dans la plateforme.

### Fichiers provider

La configuration des fournisseurs est stockée en JSON dans le répertoire `providers/` sous `TALE_CONFIG_DIR` :

- `providers/<name>.json` — config publique (base URL, modèles, tags).
- `providers/<name>.secrets.json` — clé API chiffrée par SOPS.

Tu peux aussi éditer ces fichiers directement au lieu de l'UI. Voir la [référence d'environnement](/fr-CH/operate/configuration/environment-reference) pour l'emplacement de `TALE_CONFIG_DIR`.

## Utiliser le fournisseur exemple

Le dépôt inclut une config OpenRouter prête à l'emploi dans `examples/providers/`. Pour l'utiliser :

1. Copie les fichiers exemple dans ton répertoire de config :

```bash
cp examples/providers/openrouter.json $TALE_CONFIG_DIR/providers/
cp examples/providers/openrouter.secrets.json $TALE_CONFIG_DIR/providers/
```

2. Définis ta clé API OpenRouter. Tu en obtiens une sur [openrouter.ai/keys](https://openrouter.ai/keys).

3. Chiffre le fichier secrets avec SOPS ou mets à jour la clé API via l'UI dans **Paramètres > Providers > OpenRouter**.

Le fournisseur exemple inclut des modèles de plusieurs constructeurs :

| Constructeur | Modèles                                    | Tags           |
| ------------ | ------------------------------------------ | -------------- |
| Anthropic    | Claude Opus 4.6, Sonnet 4.6, Haiku 4.5     | chat, vision   |
| OpenAI       | GPT-5.2, GPT-5.2 Instant, GPT-5.2 Pro      | chat, vision   |
| Google       | Gemini 3 Pro, Gemini 3 Flash               | chat, vision   |
| Mistral      | Mistral Large 3, Mistral Medium 3          | chat           |
| Meta         | LLaMA 4 Maverick, LLaMA 4 Scout            | chat           |
| DeepSeek     | DeepSeek V3.2                              | chat           |
| Moonshot     | Kimi K2.5                                  | chat           |
| Qwen         | Qwen3 Next 80B, Qwen3.5 35B, Qwen3 VL 32B  | chat, vision   |

## Rendre les modèles disponibles dans le chat

Après avoir ajouté un fournisseur avec des modèles, il faut aussi ajouter les IDs à la liste `supportedModels` de l'agent. Les configurations d'agents sont dans `TALE_CONFIG_DIR/agents/`. Édite le JSON d'agent pertinent et ajoute les IDs exacts de ta config provider (`models[*].id`) :

```json
{
  "supportedModels": [
    "llama3.3",
    "anthropic/claude-opus-4.6"
  ]
}
```

Les IDs doivent matcher exactement le champ `id` de la définition modèle du provider.

Seuls les modèles listés dans `supportedModels` avec le tag `chat` apparaissent dans le sélecteur de modèle.
