---
title: Épisode 7 — Connectors & le monde extérieur
description: Les portes hors de l'espace de travail — des connecteurs dont on lit les opérations et les hôtes autorisés, la recherche approfondie offerte par une connector reliée, un segment MCP enregistré sur le panneau de serveurs de la version précédente, et une sortie réseau qui échoue fermée.
---

Ton espace de travail ne vit pas seul. Cet épisode parcourt les portes vers l'extérieur et la discipline logée dans chacune : un connecteur qu'on lit avant de l'ouvrir, la capacité qui s'allume quand une connector est reliée, la porte MCP telle que la montrait la version précédente, et un réseau bac à sable qui répond non par défaut.

<Video src="/videos/fr/tutorials/ep7-connectors/ep7-connectors.fr.mp4" poster="/videos/fr/tutorials/ep7-connectors/ep7-connectors.fr.webp" captions="/videos/fr/tutorials/ep7-connectors/ep7-connectors.fr.vtt" lang="fr" title="Épisode 7 — Connectors & le monde extérieur" caption="Épisode 7 — Connectors & le monde extérieur (2:18, sous-titres disponibles)">

</Video>

<Note>

Le segment MCP (0:57–1:26) a été enregistré sur le panneau **Serveurs MCP** de la version précédente. Enregistrer un serveur externe et ses drapeaux de validation par outil ne font pas partie de cette version — la seule surface MCP de Tale est l’endpoint entrant sous **Paramètres > API > MCP**, où ton client pilote Tale. Regarde-le pour le motif à chaque porte ; [Serveurs MCP](/fr/platform/connectors/mcp-servers) dit ce qui a remplacé le panneau.

</Note>

## Ce que montre l'épisode

| À    | Scène                                                                                      |
| ---- | ------------------------------------------------------------------------------------------ |
| 0:12 | Le catalogue : on connecte une fois, tout l'espace emprunte                                |
| 0:28 | Lire la porte : opérations et hôtes autorisés, avant toute exécution                       |
| 0:43 | Le gain : la recherche approfondie existe parce que Tavily est reliée                      |
| 0:57 | MCP : vos propres outils, servis aux agents comme des natifs                               |
| 1:11 | Les drapeaux de validation par outil — avoir l'air natif n'est pas être digne de confiance |
| 1:26 | La dernière porte : code en bac à sable, sortie refusée par défaut                         |
| 1:45 | Le motif à chaque porte                                                                    |

## Pour continuer

[L'aperçu des connectors](/fr/platform/connectors/overview) couvre la connexion et le partage ; [les serveurs MCP](/fr/platform/connectors/mcp-servers) ce qui tient lieu de porte MCP dans cette version. Pour la frontière réseau, lis la [politique d'exécution de code](/fr/platform/admin/governance/run-code-policy) — et pour ce qu'une connector reliée débloque, va voir les [concepts d'automatisation](/fr/platform/automations/concepts).
