---
title: Changelog
description: Le visualiseur de releases in-produit qui montre ce qui a changé dans la plateforme Tale elle-même. Les Administrateurs lisent ceci après une mise à jour pour voir ce qui a atterri et partager les points saillants avec l'org.
---

Le changelog est le visualiseur in-produit qui montre les notes de version pour la plateforme Tale elle-même — pas pour le contenu que tes membres produisent. Après une mise à jour auto-hébergée ou un déploiement en cloud géré, le visualiseur liste ce qui a changé entre la version précédente et celle qui tourne maintenant. Les Administrateurs le lisent après une mise à jour pour briefer l'équipe et signaler tout ce qui affecte le travail des membres.

Le visualiseur lit les notes de version depuis le dépôt Tale sur GitHub et met chaque page en cache pendant une heure — les visites répétées ne rechargent rien, mais un cache froid a encore besoin que GitHub soit joignable.

## Où vit le changelog

Le changelog a deux surfaces. La page **Nouveautés** liste chaque release récente avec ses notes complètes. Le **toast de mise à jour** se déclenche une fois par saut de version et renvoie directement à la page — le toast montre `Mis à jour vers v<version>` avec l'action **Voir** et disparaît de lui-même après quelques secondes ; un point sur ton avatar persiste jusqu'à ce que tu ouvres vraiment les notes, pour qu'un membre absent ne manque pas l'info.

Ouvre la page depuis ton menu utilisateur — son pied nomme la version en cours et lie **Nouveautés** — ou depuis le toast de mise à jour quand il apparaît. La page va chercher environ trente releases récentes ; les plus anciennes renvoient vers l'historique des releases GitHub.

## Ce que chaque entrée montre

Chaque entrée de release porte quatre champs : le tag de version, la date de publication, le nom de la release (souvent un titre court) et le corps de la release en Markdown. Tale rend le corps comme GitHub — titres, listes, liens et blocs de code survivent tous. Les releases que GitHub n'a pas encore publiées affichent une courte carte explicative avec un lien vers l'historique public des releases.

## Portée

Le changelog est le changelog de la plateforme — ce qui a changé dans Tale lui-même. Il ne montre pas les changements à tes agents, à tes workflows ou à ta base de connaissances ; ceux-là ont leur propre historique par ressource. Si tu cherches l'historique de version d'un agent ou d'un workflow, ouvre la ressource et passe à l'onglet **Historique**.

Le visualiseur est en lecture seule et visible pour chaque membre connecté. Il n'y a pas de flag Admin-seul — quiconque a un compte peut ouvrir la page. Les données que le visualiseur récupère sont des informations publiques de release du dépôt GitHub Tale, donc il n'y a rien de portée-org à cacher.

## Une mise à jour mise en pratique

Après une mise à jour auto-hébergée de `v0.42` à `v0.45`, connecte-toi et cherche le toast de mise à jour en haut à droite. Clique sur **Voir** pour ouvrir la page changelog. La page montre trois entrées de release (`v0.43`, `v0.44`, `v0.45`), les plus récentes en premier, chacune avec les notes écrites par les ingénieurs depuis la release GitHub. Parcours les points saillants, partage le lien avec l'équipe si quelque chose mérite un public plus large ; le toast ne se déclenche qu'une fois par version, et le point sur ton avatar s'efface dès que tu as ouvert les notes.

Quand la mise à jour dépasse la fenêtre récupérée, la page montre les entrées les plus récentes avec une bannière qui renvoie à GitHub pour les notes plus anciennes. Le cache reste chaud pour le prochain lecteur sur ton instance.

## Où ça s'inscrit

Le changelog est la lecture opérateur de ce que Tale lui-même vient de faire ; il se tient à côté du journal d'audit (qui enregistre ce que tes membres ont fait) et de la page fournisseurs (qui suit quelles versions de modèles sont câblées). Combine-le avec [mise à jour auto-hébergée](/fr/self-hosted/operate/upgrades) quand tu opères l'instance — le guide de mise à jour parcourt le saut de version, et le changelog en lit le résultat de l'autre côté.
