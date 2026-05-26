---
title: Sous-traitants ultérieurs
description: Les sous-traitants tiers que Tale Cloud utilise pour livrer le service, ce que chacun traite et où se déroule le traitement.
noindex: true
---

Un sous-traitant ultérieur est un tiers que Tale engage pour traiter les données personnelles des clients pour son compte. La liste ci-dessous couvre Tale Cloud ; les opérateurs auto-hébergés contrôlent leur propre infrastructure et la liste de sous-traitants pour ces déploiements est celle des fournisseurs que tu choisis. Les ajouts substantiels sont annoncés 30 jours à l'avance et les Propriétaires d'org sont avertis par courriel.

Lis ceci quand un auditeur demande qui d'autre touche tes données. Reviens-y quand une revue d'achats a besoin de la liste actuelle de fournisseurs et de la localisation de chacun.

## Sous-traitants actuels

| Sous-traitant | Finalité                                                  | Catégories de données                                                  | Localisation |
| ------------- | --------------------------------------------------------- | ---------------------------------------------------------------------- | ------------ |
| Convex        | Base de données applicative et plateforme backend.        | Données de compte, données produit, métadonnées opérationnelles.       | États-Unis   |
| Cloudflare    | DNS, TLS de bord et protection DDoS pour Tale Cloud.      | Métadonnées de connexion, adresses IP, en-têtes de requête.            | Bord global  |
| Anthropic     | API du modèle Claude pour le chat et l'exécution d'agent. | Payloads de prompt et de réponse pour les appels Claude routés.        | États-Unis   |
| OpenAI        | API du modèle GPT pour le chat et l'exécution d'agent.    | Payloads de prompt et de réponse pour les appels OpenAI routés.        | États-Unis   |
| OpenRouter    | Routeur de modèles pour les fournisseurs tiers.           | Payloads de prompt et de réponse pour les appels routés via le router. | États-Unis   |

Deux remarques sur les fournisseurs de modèles (Anthropic, OpenAI, OpenRouter) : chacun n'est engagé que lorsque la configuration de l'org du client route un appel vers ce fournisseur. Une org qui n'utilise que des modèles Anthropic ne fait circuler aucune donnée vers OpenAI ou OpenRouter, et inversement. Les fournisseurs configurés par org sont visibles aux Propriétaires d'org sous **Paramètres > Fournisseurs**.

## Périmètre du traitement

Pour chaque sous-traitant :

- **Convex** traite tout ce que la plateforme stocke — la base est le substrat durable des données de compte, produit et opérationnelles. Le chiffrement au repos est fourni par Convex.
- **Cloudflare** ne traite que les données de la couche connexion. TLS termine au bord et rechiffre vers l'origine ; Cloudflare ne voit pas les payloads de la couche application en clair au-delà de ce qui est nécessaire pour router la requête.
- **Anthropic, OpenAI, OpenRouter** traitent chacun le payload de prompt et de réponse de l'appel d'inférence spécifique qui leur est routé. La donnée part via l'API du fournisseur, n'est pas stockée côté Tale comme copie séparée, et la politique de rétention propre au fournisseur s'applique à cette copie. Les termes contractuels de Tale avec chaque fournisseur interdisent l'usage des payloads clients pour l'entraînement de modèles.

## Sous-sous-traitants

Chaque sous-traitant ci-dessus engage ses propres sous-traitants (hébergement cloud, CDN, magasins de secrets). Leurs listes sont publiques et liées depuis la page de confiance de chaque fournisseur ; Tale suit les changements substantiels aux listes amont via le même mécanisme de préavis de 30 jours.

## Auto-hébergé : ce qui change

Si tu fais tourner Tale sur ta propre infrastructure, les seules données que Tale traite pour ton compte sont le trafic de support et de mise à jour auquel tu consens (tirages d'images depuis le registre, télémétrie optionnelle, tickets de support). Les fournisseurs de modèles, la base et le bord dans le tableau ci-dessus sont opérés par toi, pas par Tale ; la liste de sous-traitants de ton déploiement est la stack que tu assembles.

## Où cela s'inscrit

Les sous-traitants sont l'inventaire des fournisseurs ; la [Politique de confidentialité](/fr/legal/privacy) est la politique sous laquelle ils opèrent ; [Confiance et conformité](/fr/cloud/trust-and-compliance) est la preuve opérationnelle. Un auditeur veut généralement les trois ensemble — la liste de fournisseurs, la politique et les contrôles — donc les pages liées sont mutuellement cohérentes et mises à jour dans le même changement.
