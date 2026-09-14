---
title: Sous-traitants ultérieurs
description: Trouve la liste de référence de Tale Cloud et distingue hébergement, fournisseurs de modèles et intégrations de ton organisation.
noindex: true
---

Un sous-traitant ultérieur est un tiers chargé de traiter des données personnelles pour le compte d'un client. **L'annexe A de l'[accord de traitement des données (DPA)](https://tale.dev/fr/legal/data-processing-agreement)** constitue la liste de référence de Tale Cloud. Elle indique les entités juridiques, les services, les lieux de traitement et les catégories de données. Utilise cette annexe et ton contrat pour une évaluation fournisseur ou une revue de confidentialité.

## Lire la liste par service

L'annexe publiée distingue l'hébergement de la plateforme du traitement par l'IA. Elle mentionne **Akenes SA (Exoscale)** pour l'infrastructure et **OpenRouter, Inc.** pour les appels d'IA acheminés par ce service. L'adresse du siège d'un fournisseur et le lieu de traitement contractuel sont deux informations différentes.

| Ce que tu vérifies | Où regarder |
| --- | --- |
| Région d'hébergement et site de reprise | Les tableaux UE/EEE et Suisse de l'annexe, ainsi que ton contrat de service |
| Données envoyées pour un modèle, une transcription ou une fonction d'image | Les colonnes des services et des catégories de données, puis la section IA du DPA |
| Modèles accessibles par un intermédiaire | Les notes sur les fournisseurs en amont et les conditions de l'intermédiaire |
| Restrictions sur l'entraînement | La section 5 du DPA, y compris l'exigence d'un accord écrit distinct |
| Modification de la liste et procédure d'opposition | La section 6 du DPA et ses conditions de notification et d'abonnement |
| Preuves de sécurité | Les liens de confiance de l'annexe et le [guide de confiance de Tale](/fr/cloud/trust-and-compliance) |

## Tenir compte des intégrations de ton organisation

L'administration peut configurer d'autres fournisseurs de modèles et connectors. Examine leurs destinations et leurs conditions dans le cadre des choix de traitement de ton organisation. La liste des prestataires contractuels de Tale Cloud n'inventorie pas tous les services que ton organisation peut décider de connecter.

Par exemple, un chat avec un modèle externe transmet les entrées nécessaires à l'appel au fournisseur configuré. Un connector peut envoyer une recherche ou les paramètres d'une action à un autre système. Les documents importés peuvent aussi être traités par le service d'embedding configuré. Le [guide de résidence des données](/fr/cloud/data-residency) explique ces chemins distincts.

## Si tu héberges Tale

Ton exploitant choisit l'hébergement, les fournisseurs de modèles, le stockage objet et les intégrations. La liste des prestataires Cloud ne décrit donc pas automatiquement cette installation. Utilise la [référence de résidence des données en auto-hébergement](/fr/self-hosted/configuration/data-residency) pour examiner la configuration et documenter vos lieux de traitement.

Pour une évaluation, rassemble le DPA actuel, ton contrat de service, les informations de confidentialité applicables et les preuves de sécurité correspondant à ton installation. Pour des précisions ou des justificatifs, contacte Tale par le moyen indiqué dans le DPA.
