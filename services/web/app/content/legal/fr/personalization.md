---
title: Personnalisation — Avis de confidentialité
description: Comment la couche de personnalisation de Tale (instructions personnalisées) traite tes données, ce que nous appliquons, et les limites inhérentes au service.
noindex: true
---

**Dernière mise à jour :** 27.09.2026

## 1. L’engagement

La couche de personnalisation de Tale — tes instructions personnalisées — repose sur un engagement unique :

> **Au sein de Tale, aucun autre utilisateur — pas même les administrateurs de ton organisation — ne peut lire tes instructions personnalisées via une interface ou une API. Les instructions personnalisées sont DÉSACTIVÉES par défaut : elles ne s’appliquent que si tu les actives dans Paramètres › Personnalisation, ou si un administrateur les active par défaut pour ton organisation et que tu ne les as pas désactivées toi-même.**

Cette page documente ce que cet engagement couvre et ne couvre pas. Cinq limites sont inhérentes à l’exécution d’un service IA sur un modèle tiers et sur une base de données que quelqu’un doit exploiter ; le seul code de Tale ne peut pas les éliminer.

## 2. Limites inhérentes à la pile LLM

### 2.1 Tes instructions personnalisées sont envoyées au fournisseur LLM configuré à chaque tour de chat

Lorsque tu envoies un message et que des instructions personnalisées s’appliquent à toi, elles sont incluses dans le system prompt envoyé au LLM amont configuré par ton organisation (OpenAI, Anthropic, Google, Azure, ton modèle auto-hébergé, etc.). Elles sont alors soumises aux conditions de conservation et de surveillance des abus de ce fournisseur.

La plupart des grands fournisseurs hébergés conservent les entrées et les sorties pour la surveillance des abus pendant une fenêtre limitée (typiquement 7 à 30 jours, à la mi-2026) et proposent un programme de Zero-Data-Retention ou équivalent pour les clients entreprise éligibles. Durées et critères changent fréquemment — réfère-toi au contrat que ton organisation a conclu avec le fournisseur, ainsi qu’à la politique publiée par chaque fournisseur :

- Anthropic — [Politique de confidentialité](https://www.anthropic.com/legal/privacy) · [FAQ sur la conservation des données](https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data)
- OpenAI — [API Data Usage Policies](https://openai.com/policies/api-data-usage-policies/)
- Google Vertex AI / Gemini — [Gouvernance des données pour l’IA générative](https://cloud.google.com/vertex-ai/generative-ai/docs/data-governance)
- Azure OpenAI / Microsoft Foundry — [Données, confidentialité & sécurité](https://learn.microsoft.com/en-us/azure/ai-foundry/responsible-ai/openai/data-privacy) · [Surveillance des abus](https://learn.microsoft.com/en-us/azure/ai-foundry/openai/concepts/abuse-monitoring)

Pour les modèles auto-hébergés ou les endpoints OpenAI-compatibles personnalisés (Ollama, vLLM, passerelles internes, etc.), aucune conservation tierce ne s’applique — la conservation est entièrement régie par l’opérateur de cet endpoint.

Une fois tes instructions envoyées, **Tale ne peut pas annuler cet envoi**. Si tu les modifies ou les effaces, les requêtes futures portent le nouveau texte, mais les copies déjà transmises au fournisseur restent soumises à ses durées de conservation.

### 2.2 Déploiements auto-hébergés : l’opérateur du déploiement peut lire les lignes brutes

Tale stocke tes instructions personnalisées dans la base de données Postgres de ton déploiement, dans la table `app.user_preferences`. Toute personne ayant accès à cette base ou à ses sauvegardes peut lire ces lignes directement — la restriction de Tale fondée sur les rôles (« un administrateur ne peut pas lire les contenus ») **ne s’étend pas à la couche base de données**. En auto-hébergement, considère les opérateurs de ta base de données comme ayant accès à tout le contenu de personnalisation. Les contrôles SOC 2 / ISO sur l’accès BDD relèvent de ta responsabilité.

### 2.3 Les réponses de l’assistant peuvent citer ou paraphraser tes instructions personnalisées

La réponse du modèle peut restituer tes instructions personnalisées textuellement ou sous une forme paraphrasée. Cette réponse est ensuite stockée dans ton chat sous les **règles de visibilité du chat**, et non sous celles qui protègent tes instructions : si tu partages le chat, la copie partagée contient cette réponse. Modifier ou effacer tes instructions ne retire rien des réponses déjà générées.

### 2.4 Journaux de la base de données et du serveur

Le code applicatif de Tale tient tes instructions personnalisées à l’écart de ses propres journaux et rapports d’erreurs. Le serveur de base de données et l’infrastructure qui l’entoure tiennent toutefois leurs propres journaux : si ton opérateur active la journalisation des requêtes SQL dans Postgres, le texte que tu enregistres peut s’y retrouver. Tale ne peut pas masquer le contenu de ces journaux.

### 2.5 Surveillance des abus côté fournisseur

Les principaux fournisseurs LLM exécutent une détection automatisée d’abus sur les entrées qu’ils reçoivent. Les contenus signalés peuvent être revus par leur équipe de modération. Lorsqu’ils sont disponibles, les endpoints Zero-Data-Retention (ZDR) permettent de s’en désengager. Les requêtes contenant de la personnalisation ne diffèrent pas des autres requêtes à cet égard.

## 3. Ce que Tale applique

- **Désactivé par défaut.** Sans valeur par défaut de l’organisation ni choix de ta part, les instructions personnalisées ne sont jamais envoyées au modèle. Des instructions vides sont considérées comme absentes, même lorsque la fonction est activée.
- **Deux niveaux.** Deux réglages décident si tes instructions personnalisées s’appliquent :
  - **Valeur par défaut de l’organisation** — contrôlée par les administrateurs, dans Paramètres › Gouvernance › Politiques et limites. Quand elle est activée, les instructions sont activées par défaut pour les membres ; sinon, elles sont désactivées.
  - **Ta préférence** — ton choix explicite, activé ou désactivé, dans Paramètres › Personnalisation prime sur la valeur par défaut de l’organisation dans les deux sens. La page t’indique si tu suis cette valeur par défaut ou si tu la remplaces.
- **Pas de contournement administrateur.** Le rôle d’administrateur ne donne pas accès à la ligne d’un autre utilisateur. Chaque lecture et chaque écriture n’atteint que la ligne de l’utilisateur connecté et revérifie son appartenance à l’organisation à chaque requête — ainsi un utilisateur déjà retiré dont la session est encore valide ne peut plus lire cette ligne.
- **Désactiver conserve le texte.** Désactiver tes instructions personnalisées arrête leur envoi, mais le texte reste enregistré et tu le retrouves quand tu les réactives. Pour le supprimer, vide le champ et enregistre ; Tale ne conserve aucune version antérieure.
- **Suppression en cascade.** Le retrait d’un utilisateur d’une organisation, la suppression de l’organisation ou l’exécution d’une demande d’effacement le concernant (déposée par un administrateur dans Paramètres › Gouvernance › Personnes concernées) supprime définitivement les préférences de cet utilisateur dans cette organisation, instructions personnalisées comprises, dans la même opération. Une conservation légale active portant sur l’utilisateur ou sur toute l’organisation bloque ces trois opérations tant qu’elle n’est pas levée. Le journal d’audit consigne chacune de ces opérations, mais jamais le texte des instructions. L’auto-suppression de compte n’est pas encore une fonctionnalité produit ; lorsqu’elle arrivera, elle supprimera aussi ces lignes.

## 4. Annexe DPA (brouillon)

Les clients ayant besoin d’un avenant à leur Accord de traitement des données pour le contenu de personnalisation sont invités à demander le **Personalization Processor Annex**, qui couvre :

- Catégories de données personnelles : instructions libres rédigées par l’utilisateur ; métadonnées d’audit sans contenu des instructions.
- Finalités : personnalisation des réponses de chat par utilisateur uniquement.
- Sous-traitants ultérieurs : le fournisseur LLM configuré par organisation (voir « Tes instructions personnalisées sont envoyées… » ci-dessus).
- Conservation : illimitée tant que l’utilisateur est membre de l’organisation, y compris lorsque la fonction est désactivée ; suppression immédiate lorsque l’utilisateur vide le champ, lors du retrait du membre, lors de la suppression de l’organisation ou à l’exécution d’une demande d’effacement.
- Transferts transfrontaliers : régis par la résidence des données du fournisseur LLM et par la région du fournisseur choisie par le client.
- Droits des personnes concernées : effacement du contenu (Art. 17 par cascade lors du retrait de membre et de la suppression d’organisation, ainsi que par demande d’effacement). Les métadonnées du journal d’audit (sans contenu) sont conservées à des fins de conformité. Un export exécutable par l’opérateur (Art. 15/20) est disponible sur les tables sous-jacentes ; un export self-service intégré au produit est prévu pour la v2.
