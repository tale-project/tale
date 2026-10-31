---
title: Comprendre la résidence des données Cloud
description: Distinguer le stockage des flux vers les fournisseurs et les connectors avant de choisir un déploiement Cloud.
---

La résidence des données concerne leur stockage et leur traitement. Choisir une région Cloud définit l’emplacement du service hébergé, mais ne détermine pas à lui seul où chaque fournisseur de modèles ou service connecté traite tes données.

## Confirmer l’hébergement

Avant la configuration, confirme avec Tale la région principale, les emplacements de sauvegarde, la conservation, les objectifs de reprise et le processus d’assistance. Le contrat de service et les accords de traitement précisent les engagements de ton déploiement. Un libellé de région dans le produit ne permet pas de déduire une ville de sauvegarde ni une garantie de reprise.

Tale exploite le service Cloud. Les fichiers de configuration, les identifiants de base de données et les variables d’environnement de l’hôte relèvent de l’opérateur. La [référence d’auto-hébergement](/fr/self-hosted/configuration/data-residency) explique ce modèle technique.

## Suivre les données d’une requête

Un message de chat arrive sur ton instance Tale. Quand l’assistant utilise les connaissances, il récupère les contenus pertinents dans le stockage de l’organisation. Le message et le contexte sélectionné sont ensuite envoyés au fournisseur du modèle utilisé pour la réponse. Un outil peut contacter un autre service, comme un site web ou une application connectée.

| Flux de données | Point à vérifier |
| --- | --- |
| Chats, documents et configuration stockés | Emplacements d’hébergement et de sauvegarde convenus |
| Indexation des connaissances | Fournisseur d’embeddings qui reçoit les documents |
| Inférence du modèle | Point d’accès, conditions de traitement et conservation du fournisseur |
| Connectors et outils web | Systèmes externes qui reçoivent requêtes et contenus |
| Données d’exploitation | Traitement convenu des journaux, sauvegardes et accès d’assistance |

Un fournisseur peut proposer des points d’accès régionaux ou locaux. Vérifie celui qui est configuré : son nom commercial ne suffit pas à établir le lieu du traitement.

<Tip>

Vérifie le fournisseur d’embeddings en plus du modèle de chat. Un document peut lui être envoyé pendant l’indexation, avant même qu’une question soit posée à son sujet.

</Tip>

## Garder les prompts sur des endpoints dans l’UE {#eu-processing}

Le lieu où un modèle traite un prompt dépend de l’endpoint qu’appelle son fournisseur, pas de l’endroit où Tale s’exécute. Quand **Traiter les prompts uniquement dans l'UE/EEE** est activé, sous **Paramètres > Gouvernance > Modèles**, Tale n’envoie un appel de modèle qu’à l’endpoint dans l’UE d’un fournisseur ou à un hôte que ton organisation a confirmé, et refuse tout autre appel avant que le prompt ne quitte Tale. [Traiter les prompts uniquement dans l’UE/EEE](/fr/platform/admin/governance/content-models#eu-processing) décrit l’interrupteur et les appels qu’il couvre.

| Endpoint | Où un prompt est traité | Avec l’interrupteur activé |
| --- | --- | --- |
| `eu.openrouter.ai` | En Europe telle qu’OpenRouter la définit : dans l’UE/EEE, au Royaume-Uni et en Suisse | Autorisé |
| `eu.api.openai.com` | Dans la région Europe d’OpenAI : dans l’EEE et en Suisse | Autorisé |
| `api.eu.mistral.ai` | Dans les centres de données de Mistral situés dans des pays de l’UE et de l’AELE : dans l’EEE et en Suisse | Autorisé |
| Un autre hôte d’OpenRouter, d’OpenAI ou de Mistral, comme `openrouter.ai`, `api.openai.com` ou `us.api.openai.com` | Là où le fournisseur achemine la requête, ou aux États-Unis pour un endpoint américain | Refusé, et impossible à confirmer |
| Azure OpenAI, un déploiement de type Standard ou Regional Provisioned dans une région de l’UE/EEE | Dans la zone géographique Azure de sa région, par exemple en Suède pour Sweden Central | Autorisé une fois l’hôte de sa ressource confirmé |
| Azure OpenAI, un déploiement Data Zone UE | Dans la limite de données de l’UE (EU Data Boundary) : dans l’UE et les pays de l’AELE, Suisse comprise | Autorisé une fois l’hôte de sa ressource confirmé |
| Azure OpenAI, un déploiement de type Global ou Developer | Dans n’importe quelle région Azure | Refusé, sauf si sa ressource est confirmée |
| Tout autre endpoint, comme le serveur d’un fournisseur personnalisé ou un serveur de modèles que tu exploites | Là où ce serveur exécute le modèle. Un proxy ou un routeur transmet le prompt, qui est donc traité là où s’exécute le service vers lequel il le transmet | Autorisé une fois son hôte confirmé |

Chaque fournisseur trace sa propre Europe : aucun des trois endpoints dans l’UE ne s’arrête à l’UE/EEE, pas plus que les déploiements Data Zone UE. Si une exigence exclut la Suisse ou le Royaume-Uni, utilise un déploiement Azure OpenAI de type Standard ou Regional Provisioned dans une région de l’UE/EEE, ou un serveur qui s’exécute dans l’UE/EEE. Les régions Azure Switzerland North, Switzerland West, UK South et UK West se trouvent hors de l’UE/EEE.

La confirmation porte sur un hôte, pas sur un déploiement : confirmer une ressource Azure admet chacun de ses déploiements, y compris un déploiement de type Global. Place donc les déploiements de type Global et Developer dans une ressource que tu ne confirmes pas.

Chaque fournisseur fixe ses propres conditions pour son endpoint dans l’UE, comme un forfait ou une autorisation, peut conserver les données de compte, de facturation et d’autres données d’exploitation hors de la région, et n’y sert que les modèles qu’il y propose. Vérifie les conditions d’[OpenRouter](https://openrouter.ai/docs/guides/features/sovereign-ai), d’[OpenAI](https://developers.openai.com/api/docs/guides/your-data), de [Mistral](https://docs.mistral.ai/inference/regional-inference) et d’[Azure OpenAI](https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/deployment-types) avant de t’appuyer sur l’un d’eux.

### Passer l’organisation sur des endpoints dans l’UE

1. Donne à chaque fournisseur utilisé par l’organisation un endpoint du tableau. Pour OpenRouter, OpenAI ou Mistral, définis un [fournisseur personnalisé](/fr/platform/admin/providers#definir-un-fournisseur-personnalise) dont l’URL de base est l’endpoint du fournisseur dans l’UE, par exemple `https://eu.openrouter.ai/api/v1`.
2. Confirme les hôtes de tes ressources Azure et de tes propres serveurs sous **Endpoints dont le traitement dans l'UE/EEE est confirmé**, puis active **Traiter les prompts uniquement dans l'UE/EEE**, comme le décrit [Traiter les prompts uniquement dans l’UE/EEE](/fr/platform/admin/governance/content-models#eu-processing).
3. Envoie un message dans un chat et choisis **Afficher les informations** sous la réponse. **Région** dans **Informations sur le message** affiche **Europe** pour l’endpoint dans l’UE d’un fournisseur, ou la région indiquée par Azure OpenAI, par exemple Sweden Central. Un serveur à toi n’en indique généralement aucune, et la ligne affiche alors **Non indiquée** : l’interrupteur décide d’après l’endpoint avant l’appel, quoi qu’indique cette ligne. [Voir comment une réponse a été produite](/fr/platform/chat/basics#reply-details) explique cette ligne.

### Reconnaître un refus

Tant que l’interrupteur est activé, les sélecteurs de modèle ne proposent que les modèles dont il laisse passer l’endpoint, et un sélecteur qui laisse des modèles de côté dit pourquoi. Un appel vers tout autre endpoint, par exemple vers un modèle choisi avant l’activation de l’interrupteur, est refusé avant que quoi que ce soit ne soit envoyé. Le refus indique pourquoi et ce qu’un admin peut changer, et l’endroit où il apparaît dépend de ce qui a déclenché l’appel :

- **Chat** : la réponse n’est pas générée et le chat affiche la raison. La même règle s’applique aux titres des chats, à **Améliorer avec l'IA**, aux réponses d’un agent dans une tâche et à la génération d’images.
- **Automatisations** : l’étape `llm` échoue avec **La politique d’accès aux modèles a arrêté l’étape**.
- **Transcription et sortie vocale** : la dictée et les fichiers audio importés dans le chat signalent que le modèle de transcription audio n’est pas connu pour traiter les prompts dans l’UE/EEE, et la sortie vocale signale que le fournisseur vocal n’est pas autorisé.
- **Connaissances** : l’indexation des documents, des e-mails et des sites web est refusée, tout comme la recherche dans ces contenus. Un document en échec affiche la raison. Une fois son endpoint corrigé ou confirmé, choisis **Relancer l'indexation** : un changement de politique ne remet pas le document en file d’attente, contrairement à l’enregistrement du modèle d’embedding ou de ses identifiants.
- **API** : les [endpoints de modèles pour les clés API](/fr/platform/admin/governance/content-models#model-endpoints) ne listent que les modèles que l’interrupteur laisse passer, et un appel qui en nomme un autre reçoit la réponse `403` avec `MODEL_API_MODEL_FORBIDDEN` et la raison. Un modèle d’un fournisseur du catalogue livré y est refusé même sur un endpoint dans l’UE, car la passerelle de modèles appelle pour lui l’endpoint propre au fournisseur.
- **Garde-fous** : le [fournisseur de modération](/fr/platform/admin/governance/guardrails#moderation) ne reçoit aucun texte, et sa vérification échoue avec la classe d’erreur `eu_processing`, comme si le fournisseur était indisponible. Fail-open laisse passer le message et fail-closed le refuse : un appel aux endpoints de modèles pour les clés API reçoit alors la réponse `503` avec `MODEL_API_GUARDRAIL_UNAVAILABLE`. L’enregistrement du fournisseur avec un tel endpoint est refusé, et le message indique quoi changer.
- **Agents de programmation dans une sandbox** : Claude Code, Codex et les autres agents de programmation ne reçoivent ni clé ni identifiants pour l’endpoint. L’exécution d’agent d’une tâche échoue avant le démarrage de l’agent, sans nouvelle tentative automatique : la tâche affiche **L’agent n’a pas pu terminer cette tâche**, et **Voir**, sur l’exécution dans l’historique de la tâche, montre la raison. L’étape d’agent d’une automatisation échoue avec la raison, sans nouvelle tentative automatique non plus.

Sur la page Modèles, les réglages de génération d’images et de transcription audio signalent aussi quand l’endpoint de leur modèle n’est pas connu pour traiter les prompts dans l’UE/EEE. Un refus est consigné dans le [journal d’audit](/fr/platform/admin/governance/audit-logs), sous **Paramètres > Gouvernance > Journaux**, comme **Accès au modèle refusé**, avec la fonction à l’origine de l’appel, le fournisseur, le modèle et l’hôte.

Un élément ne suit pas encore l’interrupteur : le sélecteur du modèle qui lit les images propose encore tous les modèles.

## Examiner une nouvelle intégration

Avant de connecter un service, identifie les données envoyées par la tâche prévue et le compte utilisé par le connector. Vérifie les conditions de traitement, limite les accès et teste avec des exemples non sensibles. Consigne la décision dans ta [revue de sécurité](/fr/cloud/trust-and-compliance).

## Changer de région

Organise le changement avec Tale. Le plan de migration doit couvrir les données stockées, les sauvegardes, les points d’accès externes, l’interruption et la validation. Créer une deuxième organisation ne déplace pas les données de la première.

Le [guide de préparation d’une migration](/fr/cloud/migrate-to-self-hosted) présente des questions et des vérifications utiles aussi pour un déplacement entre régions Cloud.
