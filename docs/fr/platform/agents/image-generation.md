---
title: Agents de génération d'images
description: Configurer des agents qui génèrent ou éditent des images avec FLUX, Imagen, Nano Banana, GPT-Image ou tout modèle compatible.
---

Les agents de génération d'images prennent un prompt, éventuellement une image de référence, et produisent une nouvelle image en guise de réponse de l'assistant. Ils réutilisent la configuration standard d'un agent (instructions, connaissances, outils, conversations starters) mais sont liés à un modèle taggé `image-generation` ou `image-edit` au lieu d'un modèle de chat. Imagine un agent pour des miniatures marketing, des maquettes produit, des cartes pour les réseaux sociaux ou du concept-art rapide — tout ce que l'équipe veut traiter en un aller-retour plutôt que dans un workflow d'édition complet.

Le sélecteur de modèle dans le chat fait apparaître les agents de génération d'images aux côtés des agents de chat. Quand un utilisateur en choisit un, le composeur bascule en mode image : un sélecteur de miniatures pour les images de référence, un placeholder _Décris une image à créer…_, et un panneau d'aperçu sur les réponses de l'assistant.

## Modes de génération d'images

Chaque modèle d'image est câblé sur l'un des deux modes d'invocation. Le mode se définit par modèle dans **Paramètres > Fournisseurs IA** et détermine quel endpoint compatible OpenAI Tale appelle.

| Mode              | Endpoint                 | Utilisé par                    | Voie d'édition                                                    |
| ----------------- | ------------------------ | ------------------------------ | ----------------------------------------------------------------- |
| `images-api`      | `/v1/images/generations` | FLUX, Imagen, OpenAI DALL-E    | `/v1/images/edits` avec image de référence                        |
| `chat-multimodal` | `/v1/chat/completions`   | Nano Banana, GPT-Image, Gemini | Image de référence comme content part dans le message utilisateur |

Choisis le mode que documente ton fournisseur. `images-api` est plus simple — l'entrée est une chaîne, la sortie une image — et fonctionne pour tout fournisseur qui expose la forme de l'endpoint OpenAI Images. `chat-multimodal` est nécessaire pour les modèles comme Gemini qui produisent les images directement depuis l'endpoint chat completion et qui acceptent les images de référence sous forme de content parts inline.

## Configurer le modèle chez ton fournisseur

Ouvre **Paramètres > Fournisseurs IA**, édite le fournisseur et ajoute un modèle avec le tag `image-generation` (ou `image-edit` s'il sait retoucher une image existante). Pour chaque modèle d'image, règle :

- **Image generation mode** — soit `images-api`, soit `chat-multimodal`. Tale affiche sous le champ une ligne d'aide expliquant chaque mode ; choisis celui que documente ton fournisseur.
- **Modèles par défaut** — renseigne le modèle d'image préféré du fournisseur dans la section **Modèles par défaut** pour que les utilisateurs atterrissent sur le bon modèle quand ils choisissent l'agent.

Les modèles d'image sont facturés à l'image générée, pas au token. Le ledger d'usage enregistre donc le nombre d'images et tout coût côté fournisseur séparément des tokens de chat.

## Créer un agent de génération d'images

Pars depuis **Agents > New Agent** et remplis les champs de base — nom, slug, description. Dans l'onglet **Instructions** :

- **Préréglage de modèle** — choisis le modèle d'image enregistré ci-dessus. Le sélecteur n'affiche que les modèles taggés `image-generation` ou `image-edit`.
- **Instructions système** — décris ce dans quoi l'agent doit exceller. _« Tu produis des miniatures marketing minimalistes : aplats de couleur, un seul sujet, pas de texte »_ guide bien plus fiablement qu'aucune instruction.

Connaissances, outils, conversations starters, délégation et webhook fonctionnent comme pour les agents de chat — voir [Créer un agent](/fr/platform/agents/create).

## L'utiliser dans le chat

Choisis l'agent de génération d'images dans le sélecteur d'agent. Le composeur s'adapte :

- **Mode création** — le placeholder est _Décris une image à créer…_. Tape un prompt et envoie.
- **Mode édition** — clique sur une image plus haut dans le thread, ou attache une image de référence avec le sélecteur de miniatures, et le placeholder bascule en _Décris la modification…_. L'image de référence part vers l'endpoint d'édition (ou en tant que content part pour les modèles `chat-multimodal`).
- **Modèle incapable d'éditer** — si le modèle choisi est uniquement `image-generation`, le composeur affiche _Ce modèle ne crée que de nouvelles images. Passe à un modèle d'édition pour appliquer des changements._ Choisis alors un modèle avec le tag `image-edit`.

Les images générées sont stockées comme pièces jointes du message, suivent la même politique de rétention que les autres pièces jointes, et peuvent être téléchargées, ouvertes dans le Canevas ou réutilisées comme entrée d'édition pour des tours suivants.
