---
title: Sous-traitants ultérieurs
description: Les sous-traitants tiers que Tale Cloud utilise pour livrer le service, ce que chacun traite et où se déroule le traitement.
noindex: true
---

Un sous-traitant ultérieur est un tiers que Tale engage pour traiter les données personnelles des clients pour son compte. La liste ci-dessous couvre Tale Cloud ; les opérateurs auto-hébergés contrôlent leur propre infrastructure et la liste de sous-traitants pour ces déploiements est celle des fournisseurs que tu choisis. Les ajouts substantiels sont annoncés 30 jours à l’avance et les Propriétaires d’org sont avertis par courriel.

Lis ceci quand un auditeur demande qui d’autre touche tes données. Reviens-y quand une revue d’achats a besoin de la liste actuelle de fournisseurs et de la localisation de chacun. Cette page reprend l’**Annexe A** de l’[Accord de traitement des données](/fr/legal/data-processing-agreement) — les deux sont mis à jour dans le même changement. Les endpoints et flux de données de la plateforme Tale elle-même sont décrits dans la [documentation API](https://demo.tale.dev/docs) publique.

## Aucune utilisation des données du client pour l’entraînement de modèles

Tale n’utilise pas les données du client — prompts, entrées, sorties, embeddings, audio, images ou artefacts dérivés — pour entraîner, ajuster ou améliorer un modèle d’IA. Chaque sous-traitant ultérieur d’IA listé ci-dessous est contractuellement tenu, via ses conditions Enterprise ou API avec Tale, à la même chose. Une dérogation n’est possible que par un accord opt-in écrit séparé signé par les deux parties ; l’usage continu des services, des interrupteurs dans le produit ou un consentement implicite ne suffisent pas. La clause contraignante figure à l’[Accord de traitement des données § 5](/fr/legal/data-processing-agreement#5-traitement-par-ia--aucune-utilisation-pour-lentrainement-ou-lamelioration).

## Sous-traitants ultérieurs actuels

Chaque nom renvoie au DPA public du fournisseur (ou aux conditions équivalentes). Les certifications et pages de confiance figurent dans la section suivante.

| Sous-traitant ultérieur                                         | Finalité                                                                    | Catégories de données                                                                                  | Localisation | Entraînement sur les données du client                        |
| --------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------ | ------------------------------------------------------------- |
| [Exoscale](https://www.exoscale.com/dpa/)                       | Hébergement cloud pour la middleware Tale Cloud (VM et runtime conteneurs). | Données applicatives en transit à travers la middleware ; pas de stockage persistant sur cette couche. | Suisse       | Non (infrastructure uniquement ; aucun entraînement IA).      |
| [Convex](https://www.convex.dev/legal/dpa)                      | Base de données applicative et plateforme backend.                          | Données de compte, données applicatives, métadonnées opérationnelles.                                  | États-Unis   | Non (stockage uniquement ; aucun entraînement IA).            |
| [Cloudflare](https://www.cloudflare.com/trust-hub/gdpr/)        | DNS, terminaison TLS de bord, protection DDoS.                              | Métadonnées de connexion, adresses IP, en-têtes de requête.                                            | Edge global  | Non.                                                          |
| [OpenRouter](https://openrouter.ai/privacy)                     | Inférence LLM (chat, vision, embeddings).                                   | Prompts et réponses pour l’appel d’inférence concerné.                                                 | États-Unis   | Non — contractuellement interdit.                             |
| [OpenAI](https://openai.com/policies/data-processing-addendum/) | Traitement audio uniquement : Speech-to-Text (Whisper) et Text-to-Speech.   | Payloads audio et texte transcrit ou synthétisé pour l’appel concerné.                                 | États-Unis   | Non — contractuellement interdit (conditions Enterprise/API). |
| [Vercel AI Gateway](https://vercel.com/legal/dpa)               | Traitement et génération d’images.                                          | Prompts d’images et images générées pour l’appel concerné.                                             | États-Unis   | Non — contractuellement interdit.                             |

Deux remarques sur les sous-traitants ultérieurs d’IA (OpenRouter, OpenAI, Vercel AI Gateway) : chacun n’est engagé que lorsque la fonctionnalité concernée route un appel vers lui. Une org qui n’utilise aucune fonctionnalité audio n’envoie aucune donnée à OpenAI ; une qui n’utilise pas la génération d’images n’envoie aucune donnée à Vercel AI Gateway. Les fournisseurs de modèles accessibles via OpenRouter (Anthropic, Google, Meta, Mistral, etc.) sont des fournisseurs amont d’OpenRouter, pas des sous-traitants ultérieurs directs de Tale — ils opèrent sous les conditions contractuelles propres à OpenRouter.

## Certifications et pages de confiance

Chaque sous-traitant ultérieur détient ses propres certifications de sécurité et les publie sur sa page de confiance :

- **Exoscale** — ISO/IEC 27001:2022, ISO/IEC 27017, ISO/IEC 27018, SOC 2 Type II, PCI DSS v4.0, HDS, BSI C5, TISAX. Page de confiance : [exoscale.com/compliance](https://www.exoscale.com/compliance/).
- **Convex** — SOC 2 Type II, HIPAA (avec BAA). Page de confiance : [convex.dev/security](https://www.convex.dev/security).
- **Cloudflare** — ISO/IEC 27001:2022, ISO 27701, ISO 27018, SOC 2 Type II, PCI DSS Level 1, BSI C5, EU Cloud CoC. Page de confiance : [cloudflare.com/trust-hub](https://www.cloudflare.com/trust-hub/).
- **OpenRouter** — aucune certification séparément publiée. Le fournisseur opère sous ses [Terms of Service](https://openrouter.ai/terms) et sa [Privacy Policy](https://openrouter.ai/privacy) ; les clauses contractuelles types de l’UE s’appliquent aux transferts transfrontaliers.
- **OpenAI** — SOC 2 Type 2, ISO/IEC 27001:2022, ISO/IEC 27701:2019, CSA STAR (offres API et ChatGPT Enterprise). Page de confiance : [trust.openai.com](https://trust.openai.com).
- **Vercel AI Gateway** — couvert par les certifications enterprise de Vercel : SOC 2 Type 2, ISO/IEC 27001, PCI DSS, HIPAA, TISAX L2, Data Privacy Framework UE-US / Suisse-US / UK. Page de confiance : [security.vercel.com](https://security.vercel.com/).

## Périmètre du traitement

Pour chaque sous-traitant ultérieur :

- **Exoscale** exécute la middleware Tale Cloud sur des VM et une infrastructure conteneurs en Suisse. Les données applicatives passent par cette couche en transit mais n’y sont pas stockées durablement — l’état durable réside dans Convex.
- **Convex** traite tout ce que la plateforme persiste — la base est le substrat durable des données de compte, applicatives et opérationnelles. Le chiffrement au repos est fourni par Convex.
- **Cloudflare** ne traite que les données de la couche connexion. TLS termine au bord et rechiffre vers l’origine ; Cloudflare ne voit pas les payloads de la couche application en clair au-delà de ce qui est nécessaire pour router la requête.
- **OpenRouter** traite les prompts et réponses de l’appel LLM concerné (chat, vision, embeddings). Les données partent via l’API d’OpenRouter et ne sont pas conservées côté Tale comme copie séparée.
- **OpenAI** traite les payloads audio pour le Speech-to-Text (Whisper) et l’entrée texte pour le Text-to-Speech. OpenAI n’est pas utilisé pour le chat ni pour une inférence non audio.
- **Vercel AI Gateway** traite les prompts d’images et les images générées de l’appel concerné. Il n’est pas utilisé pour le chat, l’audio ou les workloads d’embedding.

## Sous-sous-traitants

Chaque sous-traitant ultérieur ci-dessus engage ses propres sous-traitants (hébergement cloud, CDN, magasins de secrets). Leurs listes sont publiques et liées depuis la page de confiance de chaque fournisseur ; Tale suit les changements substantiels aux listes amont via le même mécanisme de préavis de 30 jours.

## Auto-hébergé : ce qui change

Si tu fais tourner Tale sur ta propre infrastructure, les seules données que Tale traite pour ton compte sont le trafic de support et de mise à jour auquel tu consens (tirages d’images depuis le registre, télémétrie optionnelle, tickets de support). Les fournisseurs de modèles, la base et le bord dans le tableau ci-dessus sont opérés par toi, pas par Tale ; la liste de sous-traitants de ton déploiement est la stack que tu assembles.

## Où cela s’inscrit

Les sous-traitants ultérieurs sont l’inventaire des fournisseurs ; l’[Accord de traitement des données](/fr/legal/data-processing-agreement) est le contrat sous lequel ils opèrent (l’Annexe A est la liste de référence) ; la [Politique de confidentialité](/fr/legal/privacy) est la politique côté utilisateur ; [Confiance et conformité](/fr/cloud/trust-and-compliance) est la preuve opérationnelle. Un auditeur veut généralement les quatre ensemble — la liste de fournisseurs, le contrat, la politique et les contrôles — donc les pages liées sont mutuellement cohérentes et mises à jour dans le même changement.
