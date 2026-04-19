---
title: Crawling de sites web
description: Configure le crawler de Tale pour indexer des sites externes pour la recherche IA.
---

Le crawler de Tale visite les pages d'un domaine que tu lui indiques, extrait le contenu texte et l'indexe dans la base de connaissances à côté de tes documents téléversés. L'agent IA peut alors répondre aux questions en s'appuyant sur ce contenu — "Quel est notre tarif actuel sur le site ?", "Quelles fonctionnalités ont changé dans les release notes v3 ?".

Cette page cible Editor/Developer. Pour le parcours utilisateur (ajouter simplement un site), voir [Base de connaissances](/fr/platform/workspace/knowledge-base).

## Ce que fait le crawler

1. Récupère l'URL fournie et parse le HTML.
2. Découvre les pages liées sur le même domaine.
3. Récupère chaque page découverte et répète jusqu'à la limite d'URLs découvertes du domaine.
4. Convertit chaque page en texte propre (supprime navigation, footers, pubs).
5. Indexe le texte dans le store de connaissances partagé avec l'URL de la page comme source.

Les documents non HTML (PDF, DOCX) liés depuis les pages crawlées sont aussi récupérés, convertis et indexés.

## Intervalles de scan

Le crawler revisite le site selon un calendrier que tu choisis par site :

| Intervalle                   | Idéal pour                             |
| ---------------------------- | -------------------------------------- |
| Toutes les heures            | sites dont le contenu change souvent.  |
| Toutes les 6 heures (défaut) | sites de documentation et wikis.       |
| Toutes les 12 heures         | sites semi-actifs.                     |
| Tous les jours               | sites marketing et blogs.              |
| Tous les 5 jours             | contenu relativement statique.         |
| Tous les 7 jours             | sites de référence peu mis à jour.     |
| Tous les 30 jours            | contenu de référence rarement modifié. |

Chaque rescan diffère de la dernière récupération. Les pages inchangées ne sont pas réindexées — seules les pages nouvelles, modifiées ou supprimées déclenchent du travail.

## Respect du site cible

- Le crawler respecte `robots.txt`. Les chemins Disallowed sont ignorés.
- Les requêtes sont limitées (un fetch toutes les 2 secondes par domaine par défaut) pour ne pas surcharger la cible.
- User-Agent : `TaleCrawler/1.0 (+https://tale.dev/crawler)` pour que les propriétaires de site identifient le trafic.

Pour crawler des sites derrière une auth ou exigeant un user-agent personnalisé, configure plutôt une intégration REST API — voir [Intégrations — aperçu](/fr/platform/integrations/overview).

## Déboguer un crawl

Si un crawl ne remonte pas les pages attendues :

- Ouvre la page de détail sous **Connaissances > Sites web**. La liste **Discovered pages** montre ce que le crawler a trouvé.
- L'onglet **Errors** liste les pages dont le fetch ou le parse a échoué, avec statut HTTP et message.
- Vérifie que les pages attendues sont liées depuis la page d'accueil ou le sitemap. Le crawler ne trouve que ce qu'il peut atteindre via des liens.

## Supprimer un site

Supprimer un site suivi depuis **Connaissances > Sites web** retire tout le contenu indexé de ce site. C'est immédiat — l'IA ne les trouvera plus.
