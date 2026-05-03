---
title: Personnalisation & Mémoire — Avis de confidentialité
description: Comment la couche de personnalisation de Tale (Custom Instructions et Memories) traite tes données, ce que nous appliquons, et les limites inhérentes au service.
noindex: true
---

**Dernière mise à jour :** 03.05.2026

## 1. L'engagement

La couche de personnalisation de Tale (Custom Instructions et Memories) repose sur un engagement unique :

> **Au sein de Tale, aucun autre utilisateur — y compris les administrateurs de ton organisation — ne peut lire tes Custom Instructions ou le contenu de tes Memories via une interface ou une API. La personnalisation est DÉSACTIVÉE par défaut ; tu dois l'activer explicitement dans `/settings/personalization`.**

Cette page documente ce que cet engagement couvre et ne couvre pas. Cinq limites sont inhérentes à l'exécution d'un service IA sur un modèle tiers et ne peuvent pas être éliminées par le seul code de Tale.

## 2. Limites inhérentes à la pile LLM

### 2.1 Le contenu des Memories est envoyé au fournisseur LLM configuré à chaque tour de chat

Lorsque tu envoies un message et que la personnalisation est active, tes Custom Instructions et tes Memories approuvées sont incluses dans le system prompt envoyé au LLM amont configuré par ton organisation (OpenAI, Anthropic, Google, Azure, ton modèle auto-hébergé, etc.). Le contenu des Memories est alors soumis aux conditions de rétention et de surveillance des abus de ce fournisseur.

La plupart des grands fournisseurs hébergés conservent les entrées et les sorties pour la surveillance des abus pendant une fenêtre limitée (typiquement 7 à 30 jours, à la mi-2026) et proposent un programme de Zero-Data-Retention ou équivalent pour les clients enterprise qualifiés. Durées et critères changent fréquemment — réfère-toi au contrat que ton organisation a conclu avec le fournisseur, ainsi qu'à la politique publiée par chaque fournisseur :

- Anthropic — [Politique de confidentialité](https://www.anthropic.com/legal/privacy) · [FAQ sur la conservation des données](https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data)
- OpenAI — [API Data Usage Policies](https://openai.com/policies/api-data-usage-policies/)
- Google Vertex AI / Gemini — [Gouvernance des données pour l'IA générative](https://cloud.google.com/vertex-ai/generative-ai/docs/data-governance)
- Azure OpenAI / Microsoft Foundry — [Données, confidentialité & sécurité](https://learn.microsoft.com/en-us/azure/ai-foundry/responsible-ai/openai/data-privacy) · [Surveillance des abus](https://learn.microsoft.com/en-us/azure/ai-foundry/openai/concepts/abuse-monitoring)

Pour les modèles auto-hébergés ou les endpoints OpenAI-compatibles personnalisés (Ollama, vLLM, passerelles internes, etc.), aucune rétention tierce ne s'applique — la rétention est entièrement régie par l'opérateur de cet endpoint.

Une fois le contenu envoyé, **Tale ne peut pas le rappeler**. Si tu supprimes un Memory, les requêtes futures cessent de l'inclure, mais les copies déjà envoyées chez le fournisseur suivent son calendrier de rétention.

### 2.2 Déploiements auto-hébergés : l'opérateur du déploiement peut lire les lignes brutes

Tale prend en charge l'auto-hébergement Convex. Toute personne disposant d'un accès à la base de données ou au tableau de bord Convex de ton déploiement peut lire les lignes brutes de `userPreferences` et `userMemories` — la restriction d'accès admin de Tale (« l'admin ne peut pas lire les contenus ») **ne s'étend pas à la couche base de données**. En auto-hébergement, considère tes opérateurs Convex comme ayant accès à tout le contenu de personnalisation. Les contrôles SOC 2 / ISO sur l'accès BDD relèvent de ta responsabilité.

### 2.3 Les réponses de l'assistant peuvent citer ou paraphraser tes Memories

La réponse du modèle, lorsqu'elle est générée à partir d'un Memory, peut le restituer textuellement ou paraphrasé. Cette réponse est ensuite stockée dans ton fil sous les **règles de visibilité du fil**, et non celles du Memory. Le partage d'un fil désactive automatiquement la personnalisation pour les tours suivants du propriétaire, mais les réponses déjà générées sous personnalisation restent dans le fil partagé ; supprimer un Memory ne rédige pas rétroactivement les réponses passées.

### 2.4 Logs de la plateforme Convex

Les logs internes d'appels de fonctions de Convex peuvent inclure les arguments des mutations. Les arguments des mutations d'écriture de Memories peuvent y atterrir. Tale rédige les debug logs pré-appel LLM et évite de logguer le contenu des Memories depuis le code applicatif, mais les logs structurels de la plateforme sortent du périmètre de rédaction de Tale.

### 2.5 Surveillance des abus côté fournisseur

Les principaux fournisseurs LLM exécutent une détection automatisée d'abus sur les entrées qu'ils reçoivent. Les contenus signalés peuvent être revus par leur équipe de modération. Lorsqu'ils sont disponibles, les endpoints Zero-Data-Retention (ZDR) permettent de s'en désengager. Les requêtes contenant de la personnalisation ne diffèrent pas des autres requêtes à cet égard.

## 3. Ce que Tale applique

- **Désactivé par défaut.** Sans politique d'organisation ni opt-in utilisateur, la personnalisation n'est jamais envoyée au modèle — les chemins de lecture et d'écriture sont court-circuités.
- **Triple verrou.** L'application ou non de la personnalisation à un chat dépend de la combinaison de trois signaux indépendants ; si l'un d'eux bloque, ni Custom Instructions ni Memories ne sont envoyées :
  - **Défaut d'organisation** — contrôlé par l'admin. Quand activé, les membres héritent de « activé » ; quand désactivé ou absent, les membres héritent de « désactivé ».
  - **Ta préférence** — ton choix explicite on/off prime sur le défaut d'organisation dans les deux sens.
  - **Désactivation au niveau du fil** — un off dur par fil (par ex. fils partagés).
- **Pas de contournement admin.** Le rôle admin ne contourne pas la ligne d'un autre utilisateur. Chaque surface publique de lecture et d'écriture exige une correspondance exacte d'identifiant utilisateur et une vérification de l'appartenance à l'organisation en temps réel — ainsi un utilisateur déjà retiré mais dont le token est encore valide ne peut plus lire d'anciennes lignes.
- **Désactivation automatique au partage.** Le partage d'un fil désactive automatiquement la personnalisation pour ce fil ; en retirant le partage, elle est réactivée.
- **Suppression en cascade.** Le retrait d'un utilisateur d'une organisation, ou la suppression de l'organisation, supprime immédiatement et durement toutes les lignes de personnalisation correspondantes (Custom Instructions, Memories, entrées du journal d'audit, préférences). L'auto-suppression de compte n'est pas encore une fonctionnalité produit ; le hook de cascade correspondant accompagnera le plugin de suppression d'utilisateur.
- **Fenêtre de soft-delete pour les Memories approuvées.** La suppression par l'utilisateur d'un Memory approuvé déclenche une fenêtre de soft-delete de 30 jours avant que le stockage ne soit récupéré par un nettoyage opportuniste. Une proposition rejetée — depuis la carte inline du chat ou l'onglet « En attente » — est supprimée durement au moment du rejet.

## 4. Annexe DPA (brouillon)

Les clients ayant besoin d'un avenant à leur Accord de traitement des données pour le contenu de personnalisation peuvent demander le **Personalization & Memory Processor Annex**, qui couvre :

- Catégories de données personnelles : instructions libres rédigées par l'utilisateur ; faits sur l'utilisateur médiés par le LLM ; métadonnées d'audit en clair.
- Finalités : personnalisation des réponses de chat par utilisateur uniquement.
- Sous-traitants : le fournisseur LLM configuré par organisation (voir « Le contenu des Memories est envoyé… » ci-dessus).
- Conservation : illimitée tant que l'utilisateur est membre de l'organisation et que la personnalisation reste activée ; 30 jours après le soft-delete ; immédiate à la suppression dure.
- Transferts hors frontière : régis par la résidence du fournisseur LLM et le choix de région du client.
- Droits des personnes concernées : effacement (Art. 17 par cascade lors du retrait de membre et de la suppression d'organisation). Un export exécutable par l'opérateur (Art. 15/20) est disponible sur les tables sous-jacentes ; un export self-service intégré au produit est prévu pour la v2.
