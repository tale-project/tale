---
title: Fournisseurs IA
description: Paramètres > Fournisseurs IA est l’endroit où les Administrateurs connectent les fournisseurs compatibles OpenAI derrière chaque réponse, choisissent quels modèles l’organisation peut appeler, et fixent les défauts. Chaque réponse que Tale diffuse vient d’un modèle résolu via cette page.
---

Paramètres > Fournisseurs IA est la surface où Tale rencontre les modèles qu’il sert. Une organisation toute neuve embarque un fournisseur connecté — **OpenRouter**, dont l’unique clé atteint les modèles de chat, vision, embedding, transcription, voix et image — et les Administrateurs ajoutent, éditent ou retirent des fournisseurs depuis ici. Chaque réponse que Tale diffuse est routée via un modèle résolu sur cette page ; y toucher change ce que le reste du produit peut faire.

<Frame caption="Paramètres > Fournisseurs IA — les fournisseurs connectés, chacun avec son statut d’identifiant et sa liste de modèles.">

![La page de paramètres Fournisseurs IA montrant l’entrée du fournisseur OpenRouter avec sa liste de modèles.](/images/get-started/settings-providers.webp)

</Frame>

## Ce que montre la liste

Ouvre **Paramètres > Fournisseurs IA** et tu atterris sur les fournisseurs que l’organisation a connectés. Chaque ligne nomme le fournisseur et montre si sa clé API est configurée. Cliquer une ligne ouvre le tiroir du fournisseur : son URL de base et sa clé, ses **Modèles par défaut**, et la liste **Modèles** elle-même — cherchable, avec les étiquettes de capacité qui décident où chaque modèle est utilisable.

Le tiroir est là où se passe tout le travail par fournisseur. La vue liste est volontairement mince ; la profondeur est à un clic dedans.

## Ajouter un fournisseur

Clique **Ajouter un fournisseur**. **Partir d'un fournisseur connu** choisit OpenAI, Anthropic ou OpenRouter et remplit le nom du fournisseur et l’URL de base — il ne reste plus qu’à ajouter ta clé API. Modifier le nom ou l’URL de base à la main fait revenir le sélecteur sur **Personnalisé**, la voie manuelle : un fournisseur est une **URL de base** plus une **clé API** — l’endpoint propre à un fournisseur direct, OpenRouter (`https://openrouter.ai/api/v1`) pour le catalogue le plus large, ou un serveur Ollama ou vLLM local sur ton réseau. La clé est stockée chiffrée et utilisée seulement pour appeler ce fournisseur.

Une fois l’identifiant posé, remplis la liste de modèles : **Récupérer les modèles** tire la liste que l’API du fournisseur rapporte, **Ajouter un modèle** en déclare un à la main, et — une fois le catalogue de modèles de l’organisation synchronisé — choisir un modèle dans le catalogue depuis cette boîte de dialogue remplit son ID et ses capacités connues (fenêtre de contexte, tarification, raisonnement) au lieu de les saisir. Aucun modèle n’est appelable tant qu’il n’est pas dans la liste du fournisseur avec la bonne étiquette de capacité.

Pour OpenAI, Anthropic et OpenRouter, l’URL de base reste verrouillée sur l’endpoint publié même après la création du fournisseur — ouvre le tiroir de la ligne, clique sur **Modifier les détails** sous **Général**, et le champ apparaît en lecture seule avec un bouton **Remplacer l'URL de base** à côté. Ne recours au remplacement que pour pointer le slug de ce fournisseur vers un proxy compatible ou un autre endpoint du même fournisseur ; l’URL de base de tout autre fournisseur reste modifiable directement, sans remplacement.

## La liste de modèles et les étiquettes de capacité

Chaque modèle porte une ou plusieurs étiquettes de capacité — **Chat**, **Vision**, **Embedding**, **Transcription**, **Synthèse vocale**, **Génération d'images**, **Édition d'images**. Les étiquettes sont porteuses : elles décident dans quels sélecteurs un modèle apparaît et quelle capacité de la plateforme peut l’appeler. Un modèle sans étiquette correspondante n’apparaît jamais là où cette capacité est requise.

**Masqué des sélecteurs de modèles** retire un modèle du composeur de chat et de la sélection de modèle des agents tout en le laissant pleinement utilisable par les agents et workflows qui le référencent déjà. C’est ainsi qu’une version supplantée ou dépréciée prend sa retraite sans casser les agents qui y sont liés.

## Modèles par défaut

La carte **Modèles par défaut** nomme quel modèle chaque capacité utilise quand rien de plus spécifique n’est lié — le défaut de chat pour les nouveaux chats et nouveaux agents, plus les défauts de vision, embedding, génération d’images et transcription qu’utilisent les services d’arrière-plan. Changer un défaut n’affecte que les nouveaux objets ; les chats et agents existants gardent le modèle auquel ils étaient liés. Va vers les défauts quand tu déploies une nouvelle génération de modèle dans toute l’organisation sans rééditer chaque agent.

## Garder le catalogue à jour

Deux contrôles gardent le catalogue à jour sans édition manuelle. La carte **Catalogue de modèles** rafraîchit les capacités de chaque modèle — tarification, fenêtre de contexte, raisonnement, vision — depuis le catalogue public d’OpenRouter chaque jour. La bascule **Auto-sync hebdomadaire de la config fournisseur** fusionne les nouvelles versions phares une fois par semaine dans la config fournisseur de l’organisation, masque les versions supplantées et laisse intact tout champ que tu as personnalisé.

## Où cela s’inscrit

Les fournisseurs sont le bas de la pile — chaque agent, chaque chat, chaque étape de workflow qui produit du texte se résout via eux. Le catalogue de ce que chaque fournisseur livre et des étiquettes qu’il porte vit dans [Modèles](/fr/platform/models) ; la forme basée fichier de la même configuration vit sous [Configuration → providers](/fr/self-hosted/configuration/providers) ; et [Concepts d’agent](/fr/platform/agents/concepts) couvre comment le bouton modèle s’inscrit dans le modèle à quatre boutons dont un agent est bâti.
