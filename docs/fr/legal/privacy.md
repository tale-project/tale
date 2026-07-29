---
title: Politique de confidentialité
description: Ce que Tale collecte, pourquoi, combien de temps c'est conservé, qui d'autre le traite, et les droits que tu as sur tes données.
noindex: true
---

Cette politique décrit comment Tale traite les données personnelles quand tu utilises Tale Cloud, le site de docs, le site marketing ou les fonctionnalités dans le produit. La forme est la même que tu sois utilisateur final, admin d'org ou visiteur lisant les docs — des surfaces différentes collectent des données différentes, et chacune est nommée plus bas. La politique s'applique à Tale Cloud ; les instances auto-hébergées sont opérées par l'organisation qui les fait tourner, et le responsable de traitement est cette organisation, pas Tale.

Lis ceci quand tu veux savoir ce que Tale conserve à ton sujet, pourquoi, et comment l'enlever. Reviens-y quand la politique change — les changements substantiels sont annoncés sur la page de statut et envoyés par courriel aux Propriétaires d'org.

## Ce que nous collectons

Trois seaux de données existent, chacun avec sa propre règle de conservation :

- **Données de compte.** Nom, courriel, organisation, rôle et identifiants avec lesquels tu te connectes. Nécessaires pour opérer le service.
- **Données produit.** Tout ce que tu mets dans le produit — agents, workflows, documents, conversations, entrées de base de connaissances, identifiants de connector. Stockées tant que l'org parente existe ; supprimées à la suppression de l'org ou via le flux de demande de la personne concernée.
- **Données opérationnelles.** Journaux serveur, pistes d'audit, contenu des tickets de support, métriques de performance. Liées à ton compte ou à ton org tant que la donnée sert à la sécurité, au débogage et à la conformité — typiquement jusqu'à 90 jours pour les journaux et indéfiniment pour les pistes d'audit.

Nous ne vendons pas de données personnelles. Nous n'utilisons pas les données produit pour entraîner des modèles — tes conversations et tes documents ne font partie d'aucun jeu d'entraînement de modèle, ni le nôtre ni celui d'aucun fournisseur, sauf quand tu as explicitement activé une fonctionnalité qui le requiert et confirmé l'invite de consentement.

## Pourquoi nous le collectons

La base légale de chaque seau est l'une de :

- **Nécessité contractuelle.** Les données de compte et les données produit que tu crées existent parce que tu nous as demandé de fournir le service. Nous ne pouvons pas opérer la plateforme sans elles.
- **Intérêt légitime.** Les données opérationnelles sont collectées pour garder la plateforme sûre, déboguer les pannes et respecter les SLA contractuels.
- **Consentement.** Les communications marketing, l'analytique sur le site marketing et toute fonctionnalité qui traite des données au-delà du contrat sont fondées sur le consentement — opt-in, révocable et tracé.

La ventilation de la base légale par catégorie de donnée vit dans l'Accord de Traitement de Données disponible aux clients entreprise sur demande.

## Combien de temps nous le gardons

| Donnée                      | Conservation                                                                    |
| --------------------------- | ------------------------------------------------------------------------------- |
| Données de compte           | Vie de l'org plus 30 jours après suppression                                    |
| Données produit             | Vie de l'org ; effacement immédiat à la suppression de l'org                    |
| Documents et téléversements | Vie de l'enregistrement parent ; enregistrements soft-deleted purgés à 30 jours |
| Journaux serveur            | 90 jours                                                                        |
| Journaux d'audit            | Plancher configurable par l'org ; défaut 365 jours, pas de plafond              |
| Sauvegardes                 | 30 jours, chiffrées au repos                                                    |

L'effacement suit le flux de demande de la personne concernée documenté dans le produit — voir la page gouvernance dans le produit pour la surface opérateur.

## Sous-traitants ultérieurs

Tale Cloud utilise un petit nombre de tiers pour livrer le service. Chacun est nommé, localisé et périmétré sur la page [Sous-traitants ultérieurs](/fr/legal/subprocessors). Les changements substantiels à la liste des sous-traitants sont annoncés 30 jours avant prise d'effet ; les Propriétaires d'org peuvent s'opposer via le support et faire résilier le contrat si le nouveau sous-traitant n'est pas acceptable.

## Tes droits

Tu as les droits accordés par le RGPD (et les droits FADP équivalents pour les personnes concernées suisses) : accès, rectification, effacement, restriction, portabilité et opposition. La mécanique :

- **Accès et portabilité.** Exporte tes données depuis le produit ou via l'API ; les exports bruts des données au périmètre org sont disponibles sur demande.
- **Rectification.** Édite les données de compte et les données produit depuis le produit. Pour les données que tu n'atteins pas (journaux serveur, entrées d'audit avec ton ID utilisateur), soumets une demande via le support.
- **Effacement.** Utilise le flux de demande de la personne concernée sous **Paramètres > Gouvernance > Demandes des personnes concernées**. L'effacement traverse chaque service qui détient la donnée, y compris les sauvegardes via destruction de clé.
- **Restriction et opposition.** Soumets via le support ; Tale accuse réception sous cinq jours ouvrés.

Contact : `privacy@tale.dev`. Pour les plaintes, l'autorité de contrôle est l'autorité de protection des données du pays où tu résides.

## Où cela s'inscrit

La confidentialité est le contrat de traitement des données ; [Confiance et conformité](/fr/cloud/trust-and-compliance) est la preuve opérationnelle qui en découle. Si tu veux savoir quels tiers touchent tes données, [Sous-traitants ultérieurs](/fr/legal/subprocessors) est la liste ; si tu opères en auto-hébergé, la donnée ne quitte pas ton infrastructure, et cette politique ne s'applique qu'à ton usage des surfaces propres à Tale (les sites de docs et marketing).
