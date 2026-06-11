---
title: Sous-traitants ultérieurs
description: Les sous-traitants tiers que Tale Cloud utilise pour livrer le service, ce que chacun traite et où se déroule le traitement.
noindex: true
---

Un sous-traitant ultérieur est un tiers que Tale engage pour traiter les données personnelles des clients pour son compte. La liste ci-dessous couvre Tale Cloud ; les opérateurs auto-hébergés contrôlent leur propre infrastructure et la liste de sous-traitants pour ces déploiements est celle des fournisseurs que tu choisis. Les ajouts substantiels sont annoncés 30 jours à l’avance et les Propriétaires d’org sont avertis par courriel.

Lis ceci quand un auditeur demande qui d’autre touche tes données. Reviens-y quand une revue d’achats a besoin de la liste actuelle de fournisseurs et de la localisation de chacun. Cette page reprend l’**Annexe A** de l’[Accord de traitement des données](https://tale.dev/fr/legal/data-processing-agreement) — les deux sont mis à jour dans le même changement. Les endpoints et flux de données de la plateforme Tale elle-même sont décrits dans la [documentation API](https://demo.tale.dev/docs) publique.

## Aucune utilisation des données du client pour l’entraînement de modèles

Tale n’utilise pas les données du client — prompts, entrées, sorties, embeddings, audio, images ou artefacts dérivés — pour entraîner, ajuster ou améliorer un modèle d’IA. Chaque sous-traitant ultérieur d’IA listé ci-dessous est contractuellement tenu, via ses conditions Enterprise ou API avec Tale, à la même chose. Une dérogation n’est possible que par un accord opt-in écrit séparé signé par les deux parties ; l’usage continu des services, des interrupteurs dans le produit ou un consentement implicite ne suffisent pas. La clause contraignante figure à l’[Accord de traitement des données § 5](https://tale.dev/fr/legal/data-processing-agreement#5-traitement-par-ia--aucune-utilisation-pour-lentrainement-ou-lamelioration).

## Sous-traitants ultérieurs actuels

Chaque nom renvoie au DPA public du fournisseur (ou aux conditions équivalentes). Les certifications et pages de confiance figurent dans la section suivante. L’hébergement de la plateforme suit la résidence de données choisie par ton org : le premier tableau s’applique aux orgs de l’UE/EEE, le second aux orgs suisses. Les appels IA (inférence LLM, traitement audio et traitement d’images) sont traités dans l’UE/EEE pour toutes les orgs — aucun sous-traitant ultérieur d’IA engagé par Tale n’opère de région suisse, et aucun de ces appels n’est traité dans des pays tiers comme les États-Unis.

### Orgs de l’UE/EEE

| Sous-traitant ultérieur (entité juridique)                                  | Adresse du siège                                                                              | Nature de la prestation                                                                                                                   | Lieu du traitement                                                                                                 |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| [Akenes SA (Exoscale)](https://www.exoscale.com/dpa/)                       | Boulevard de Grancy 19A, 1006 Lausanne, Suisse                                                | Infrastructure cloud (centre de données) : hébergement de la plateforme Tale Cloud — VM, runtime conteneurs, base de données et stockage. | Allemagne (région de Francfort).                                                                                   |
| [OpenRouter, Inc.](https://openrouter.ai/privacy)                           | 169 Madison Avenue, New York, NY 10016, États-Unis                                            | Inférence LLM (chat, vision, embeddings) ainsi que traitement et génération d’images.                                                     | Union européenne (routage in-region via `eu.openrouter.ai` : prompts et réponses traités exclusivement dans l’UE). |
| [OpenAI Ireland Ltd](https://openai.com/policies/data-processing-addendum/) | 1st Floor, The Liffey Trust Centre, 117–126 Sheriff Street Upper, Dublin 1, D01 YC43, Irlande | Traitement audio : Speech-to-Text et Text-to-Speech.                                                                                      | Union européenne/EEE (région de résidence de données OpenAI Europe, endpoint `eu.api.openai.com`).                 |

### Orgs suisses

| Sous-traitant ultérieur (entité juridique)                                  | Adresse du siège                                                                              | Nature de la prestation                                                                                                                   | Lieu du traitement                                                                                                |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| [Akenes SA (Exoscale)](https://www.exoscale.com/dpa/)                       | Boulevard de Grancy 19A, 1006 Lausanne, Suisse                                                | Infrastructure cloud (centre de données) : hébergement de la plateforme Tale Cloud — VM, runtime conteneurs, base de données et stockage. | Suisse (Zurich ; réplique de reprise après sinistre à Genève).                                                    |
| [OpenRouter, Inc.](https://openrouter.ai/privacy)                           | 169 Madison Avenue, New York, NY 10016, États-Unis                                            | Inférence LLM (chat, vision, embeddings) ainsi que traitement et génération d’images.                                                     | Union européenne (routage in-region via `eu.openrouter.ai`).                                                      |
| [OpenAI Ireland Ltd](https://openai.com/policies/data-processing-addendum/) | 1st Floor, The Liffey Trust Centre, 117–126 Sheriff Street Upper, Dublin 1, D01 YC43, Irlande | Traitement audio : Speech-to-Text et Text-to-Speech.                                                                                      | Union européenne/EEE (région de résidence de données OpenAI Europe (EEE + Suisse), endpoint `eu.api.openai.com`). |

Pour les orgs suisses, l’hébergement de la plateforme reste intégralement en Suisse. Les sous-traitants ultérieurs d’IA n’offrent pas de région suisse ; ces appels sont traités dans l’UE/EEE — tous les pays de l’UE/EEE figurent sur la liste d’adéquation du Conseil fédéral au sens de l’art. 16 LPD, le transfert n’exige donc aucune garantie supplémentaire.

Deux remarques sur les sous-traitants ultérieurs d’IA (OpenRouter, OpenAI) : chacun n’est engagé que lorsque la fonctionnalité concernée route un appel vers lui. Une org qui n’utilise aucune fonctionnalité audio n’envoie aucune donnée à OpenAI ; une qui n’utilise ni l’inférence LLM ni la génération d’images n’envoie aucune donnée à OpenRouter. Les fournisseurs de modèles accessibles via OpenRouter (Anthropic, Google, Meta, Mistral, etc.) sont des fournisseurs amont d’OpenRouter, pas des sous-traitants ultérieurs directs de Tale — ils opèrent sous les conditions contractuelles propres à OpenRouter ; le routage in-region limite chaque appel aux endpoints de fournisseurs situés dans l’UE.

## Certifications et pages de confiance

Chaque sous-traitant ultérieur détient ses propres certifications de sécurité et les publie sur sa page de confiance :

- **Exoscale (Akenes SA)** — ISO/IEC 27001:2022, ISO/IEC 27017, ISO/IEC 27018, SOC 2 Type II, PCI DSS v4.0, HDS, BSI C5, TISAX. Page de confiance : [exoscale.com/compliance](https://www.exoscale.com/compliance/).
- **OpenRouter, Inc.** — SOC 2 ; preuves disponibles via le portail de confiance à accès restreint [trust.openrouter.ai](https://trust.openrouter.ai). Les clauses contractuelles types de l’UE s’appliquent aux transferts hors UE/EEE.
- **OpenAI Ireland Ltd** — SOC 2 Type 2, ISO/IEC 27001:2022, ISO/IEC 27701:2019, CSA STAR (offres API et ChatGPT Enterprise). Page de confiance : [trust.openai.com](https://trust.openai.com).

## Périmètre du traitement

Pour chaque sous-traitant ultérieur :

- **Exoscale (Akenes SA)** exécute la middleware Tale Cloud, l’état applicatif et l’infrastructure de support sur des VM et une infrastructure conteneurs dans la région choisie par ton org (Suisse : Zurich avec reprise après sinistre à Genève ; UE : Francfort). Le chiffrement au repos est fourni par la couche de stockage d’Exoscale.
- **OpenRouter** traite les prompts et réponses de l’appel LLM concerné (chat, vision, embeddings), ainsi que les prompts d’images et les images générées. Les données partent via le routage in-region d’OpenRouter (`eu.openrouter.ai`) et ne sont pas conservées côté Tale comme copie séparée.
- **OpenAI** traite les payloads audio pour le Speech-to-Text et l’entrée texte pour le Text-to-Speech via la région de résidence de données UE (`eu.api.openai.com`). OpenAI n’est pas utilisé pour le chat ni pour une inférence non audio.

## Sous-sous-traitants

Chaque sous-traitant ultérieur ci-dessus engage ses propres sous-traitants (hébergement cloud, CDN, magasins de secrets). Leurs listes sont publiques et liées depuis la page de confiance de chaque fournisseur ; Tale suit les changements substantiels aux listes amont via le même mécanisme de préavis de 30 jours.

## Auto-hébergé : ce qui change

Si tu fais tourner Tale sur ta propre infrastructure, les seules données que Tale traite pour ton compte sont le trafic de support et de mise à jour auquel tu consens (tirages d’images depuis le registre, télémétrie optionnelle, tickets de support). Les fournisseurs d’hébergement et de modèles dans le tableau ci-dessus sont opérés par toi, pas par Tale ; la liste de sous-traitants de ton déploiement est la stack que tu assembles.

## Où cela s’inscrit

Les sous-traitants ultérieurs sont l’inventaire des fournisseurs ; l’[Accord de traitement des données](https://tale.dev/fr/legal/data-processing-agreement) est le contrat sous lequel ils opèrent (l’Annexe A est la liste de référence) ; la [Politique de confidentialité](/fr/legal/privacy) est la politique côté utilisateur ; [Confiance et conformité](/fr/cloud/trust-and-compliance) est la preuve opérationnelle. Un auditeur veut généralement les quatre ensemble — la liste de fournisseurs, le contrat, la politique et les contrôles — donc les pages liées sont mutuellement cohérentes et mises à jour dans le même changement.
