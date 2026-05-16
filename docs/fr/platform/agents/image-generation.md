---
title: Agents de génération d'images
description: Configure des agents qui génèrent ou éditent des images avec FLUX, Imagen, Nano Banana, GPT-Image ou tout modèle compatible.
---

Les agents de génération d'images prennent un prompt, éventuellement une image de référence, et produisent une image comme réponse de l'assistant. Ils réutilisent la configuration standard d'un agent — instructions, connaissances, outils, amorces de conversation — mais sont liés à un modèle taggé `image-generation` ou `image-edit` au lieu d'un modèle de chat. Imagine un agent pour des miniatures marketing, des maquettes produit, des cartes pour les réseaux sociaux ou du concept-art rapide — ce que l'équipe veut traiter en un aller-retour d'un message plutôt qu'en workflow d'édition d'image complet.

Le sélecteur de modèle dans le chat fait apparaître les agents de génération d'images aux côtés des agents de chat. Quand un utilisateur en choisit un, le composeur bascule en mode image : un sélecteur de miniatures pour les images de référence, un placeholder qui lit _Décris une image à créer…_, et un panneau d'aperçu sur les réponses de l'assistant.

## Les deux modes d'invocation

Chaque modèle d'image est câblé sur l'un des deux modes d'invocation. Le mode se définit par modèle dans la page de configuration du fournisseur et décide quel endpoint compatible OpenAI Tale appelle.

| Mode              | Endpoint                 | Utilisé par                    | Voie d'édition                                                  |
| ----------------- | ------------------------ | ------------------------------ | --------------------------------------------------------------- |
| `images-api`      | `/v1/images/generations` | FLUX, Imagen, OpenAI DALL-E    | `/v1/images/edits` avec image de référence.                     |
| `chat-multimodal` | `/v1/chat/completions`   | Nano Banana, GPT-Image, Gemini | Image de référence en content part dans le message utilisateur. |

Choisis le mode que documente ton fournisseur. `images-api` est plus simple — l'entrée est une chaîne, la sortie une image — et fonctionne pour tout fournisseur qui expose la forme de l'endpoint OpenAI Images. `chat-multimodal` est requis pour les modèles comme Gemini qui émettent les images directement depuis l'endpoint chat-completion et acceptent les images de référence comme content parts en ligne.

## Enregistrer le modèle chez ton fournisseur

Ouvre **Paramètres > Fournisseurs IA**, édite le fournisseur et ajoute un modèle avec le tag `image-generation` (ou `image-edit` si le modèle sait retoucher une image existante). Pour chaque modèle d'image, règle le **Mode de génération d'image** — `images-api` ou `chat-multimodal` — et, dans la section **Modèles par défaut**, choisis le modèle d'image préféré du fournisseur pour que les utilisateurs tombent sur le bon modèle en ouvrant l'agent.

Les modèles d'image sont facturés à l'image générée et non au token. Le registre d'usage enregistre le nombre d'images et tout coût côté fournisseur séparément des tokens de chat.

## Créer l'agent de génération d'images

Ouvre **Agents > Créer un agent** et remplis les champs de base — nom d'affichage, nom, description. Dans l'onglet **Instructions et modèle**, choisis le modèle d'image enregistré au-dessus comme modèle de l'agent ; seuls les modèles taggés `image-generation` ou `image-edit` apparaissent dans le sélecteur. Écris un bloc d'instructions système qui décrit ce dans quoi l'agent doit exceller — _« Tu produis des miniatures marketing minimalistes : aplats de couleur, un seul sujet, pas de texte en surimpression »_ guide bien plus fiablement qu'aucune instruction.

Connaissances, Outils, Amorces, Délégation et Workers fonctionnent comme pour les agents de chat. Voir [Créer un agent](/fr/platform/agents/create) pour le flux de construction complet.

## L'utiliser dans le chat

Choisis l'agent de génération d'images dans le sélecteur d'agent et le comportement du composeur s'adapte. En **mode création**, le placeholder lit _Décris une image à créer…_ ; tape un prompt et envoie. Pour basculer en **mode édition**, clique sur une image plus haut dans le fil, ou attache une image de référence avec le sélecteur de miniatures ; le placeholder passe à _Décris la modification…_ et la référence part vers l'endpoint d'édition (ou comme content part pour les modèles `chat-multimodal`). Si le modèle actif ne sait que générer, le composeur lit _Ce modèle ne crée que de nouvelles images. Passe à un modèle d'édition pour appliquer des modifications._ — choisis alors un modèle taggé `image-edit`.

Les images générées sont enregistrées comme pièces jointes du message, stockées sous la même politique de rétention que les autres pièces jointes, et peuvent être téléchargées, ouvertes dans Canevas ou réutilisées comme entrée d'édition pour les tours suivants.

## Où ça s'inscrit

Les agents de génération d'images sont la surface d'image en un tour à l'intérieur du chat — un moyen rapide de produire une miniature marketing, une maquette produit, une esquisse conceptuelle. Ils ne remplacent pas un outil d'édition d'image dédié ; le compromis porte sur la vitesse et l'accessibilité conversationnelle, pas sur le contrôle au pixel près. Pour des workflows d'images à l'échelle de l'équipe qui demandent du suivi d'itérations, un agent qui délègue à un service d'image externe via une [intégration](/fr/platform/integrations/overview) est mieux adapté.

Pour configurer les modèles sous-jacents, un Admin met en place les tags de modèle `image-generation` et `image-edit` dans [Fournisseurs IA](/fr/platform/admin/providers).
