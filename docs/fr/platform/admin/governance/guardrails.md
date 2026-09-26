---
title: Garde-fous
description: Configure les filtres de chat, la protection des données personnelles et la modération, puis examine les détections et erreurs.
---

En tant qu’admin ou propriétaire, utilise **Paramètres > Gouvernance > Garde-fous** pour contrôler la vérification des textes avant et après un appel au modèle. Les couches actives s’exécutent dans cet ordre : sécurité du contenu, détection des données personnelles, puis modération externe. Commence par une règle claire et vérifie son effet avant de l’élargir.

<Frame caption="Gouvernance > Garde-fous — les trois cartes de statut des couches de filtres (sécurité du contenu, détection PII, fournisseur de modération), au-dessus du journal des événements récents.">

![La page de gouvernance Garde-fous montrant trois cartes de statut — Sécurité du contenu inactive, Détection DCP inactive et Fournisseur de modération non configuré — au-dessus du flux des événements récents, qui n’en signale encore aucun, et des instructions personnalisées de l’organisation.](/images/platform/governance-guardrails.webp)

</Frame>

## Ajouter une règle de contenu

1. Dans la sécurité du contenu, choisis de vérifier les saisies des utilisateurs, les réponses du modèle ou les deux.
2. Ajoute une catégorie, donne-lui un libellé reconnaissable et choisis son mode.
3. Ajoute les mots ou expressions à détecter, une entrée par ligne. Tu peux importer une liste texte ; relis-la avant de l’appliquer.
4. Enregistre la catégorie, active la catégorie et la couche voulues, puis enregistre les changements de la page.
5. Teste avec un texte fictif contenant une correspondance, puis un texte normal qui doit passer. Vérifie les événements récents et le résultat visible dans le chat.

| Mode | Effet d’une correspondance |
| --- | --- |
| Signaler | Enregistre la détection et laisse passer le message. Utile pour affiner une règle. |
| Masquer | Remplace le texte détecté par le substitut configuré. |
| Bloquer | Refuse le message. |

Si plusieurs catégories correspondent, bloquer passe avant masquer, puis signaler. La recherche de mots ignore la casse. Vérifie les variantes et faux positifs importants dans tes langues. Un test réussi ne démontre pas une couverture complète.

## Protéger les données personnelles

La protection PII détecte des formats configurés, comme les adresses e-mail, numéros de téléphone et identifiants. Sélectionne les types intégrés utiles et les motifs personnalisés, puis le comportement souhaité.

Le masquage retire les valeurs détectées du texte transmis. Dans un chat, Tale enregistre et affiche aussi le texte masqué comme message ; la formulation d’origine n’est pas conservée. Le blocage refuse une correspondance. La tokenisation remplace les valeurs par des tokens numérotés pour le modèle, puis les restaure dans sa réponse. Elle réduit l’exposition pendant le traitement, sans garantir une réponse finale dépourvue de données personnelles.

Un identifiant intégré composé uniquement de chiffres, comme un numéro de passeport suédois ou un identifiant fiscal ukrainien, n’est reconnu qu’à côté d’un mot qui le nomme, par exemple `passnummer` ou `ІПН`. Les numéros de commande, les dates compactes et les numéros de build passent tels quels. Chaque détection dans **Événements récents** nomme le motif déclenché, par exemple `se-passport`.

Teste tes formats réels avec des valeurs fictives. La détection peut manquer des formats inhabituels et signaler à tort du texte ordinaire. Vérifie séparément l’entrée et la sortie.

## Ajouter une modération externe

La couche de modération envoie du texte à un classificateur configuré, comme OpenAI, Azure, Perspective ou un point de terminaison personnalisé. Configure ses identifiants, catégories et actions, puis les directions à inspecter.

Décide du comportement si le fournisseur est indisponible : fail-open laisse passer le message, fail-closed le refuse. Examine les erreurs fournisseur et les événements de circuit ouvert en cas de refus inattendus ou de messages non filtrés. Cette couche ajoute un service qui traite le texte. Utilise le fournisseur et l’adresse approuvés pour ton organisation.

## Définir les instructions de l’organisation

Les instructions personnalisées de l’organisation sont ajoutées avant celles des agents. Les membres ne peuvent pas modifier cette règle d’organisation. Utilise-les pour le comportement et le vocabulaire communs. Pour les restrictions à imposer indépendamment du respect d’un texte par le modèle, utilise les règles d’accès et les filtres.

## Examiner et ajuster

Les événements récents affichent les 50 dernières détections, blocages et erreurs fournisseur. Filtre par couche ou résultat et examine la catégorie, la direction et la date. Le texte brut détecté n’est pas conservé dans ces événements : la ligne explique la détection sans reproduire la valeur sensible.

Si une règle est trop large, ajuste sa catégorie ou ses motifs et répète les tests fictifs. Si une détection manque, vérifie l’activation de la couche, de la catégorie et de la direction voulue. L’historique dépend de la [règle de rétention](/fr/platform/admin/governance/policies-and-limits) des événements de filtre de chat ; ne suppose pas une durée d’archivage fixe.
