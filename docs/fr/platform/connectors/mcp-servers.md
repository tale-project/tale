---
title: Serveurs MCP
description: Enregistre des serveurs d’outils externes sous Paramètres > API > MCP — le transport, l’authentification, la liste des outils découverts et les drapeaux d’approbation par outil qui gardent la frontière de confiance serrée.
---

Un serveur MCP est un processus externe qui expose des outils aux agents de Tale via le Model Context Protocol. Là où une [connector](/fr/platform/connectors/overview) est un connecteur propre à un fournisseur que Tale livre, un serveur MCP est un pont générique que n’importe qui peut héberger — une API interne, un fournisseur sans connecteur, un script qui calcule ce que les outils intégrés de Tale ne savent pas calculer. Tu héberges le serveur ; Tale ne fait que lui parler.

<Frame caption="Le formulaire Ajouter un serveur MCP — une connexion et une méthode d’authentification sont tout l’enregistrement.">

![La boîte de dialogue Ajouter un serveur MCP sous Paramètres API MCP, remplie pour un serveur de tickets de support — nom d’affichage Support Tickets, une description d’une ligne, Streamable HTTP comme type de transport, l’URL du serveur et Aucune comme méthode d’authentification — par-dessus la page MCP, où un serveur Internal Wiki est déjà enregistré.](/images/platform/settings-mcp-add-dialog.webp)

</Frame>

## Enregistrer un serveur

Ouvre **Paramètres > API > MCP** et clique sur **Ajouter un serveur MCP**. Le formulaire prend :

- **Nom** et **Nom d'affichage** — l’identifiant, et le libellé que les agents et les cartes d’approbation affichent.
- **Type de transport** — **Streamable HTTP**, **SSE** ou **stdio**. Les transports HTTP prennent une **URL** — le formulaire signale une URL malformée en ligne avant que tu puisses enregistrer ; stdio prend la commande que Tale lance.
- **Authentification** — **Aucune**, **Clé API** ou **OAuth 2.0** (URL du jeton, ID client et secret, portées).
- **Agents autorisés** — quels agents peuvent se lier à ce serveur. Le défaut est aucun agent ; va vers **Tous les agents** seulement quand le serveur est assez générique pour que chaque agent en bénéficie.

**Enregistrer le serveur**, puis utilise **Tester la connexion** sur la ligne pour vérifier la poignée de main — le statut de la ligne affiche **Connecté**, **Déconnecté** ou **Erreur** avec le message amont.

## Les outils découverts

Une fois connecté, Tale récupère le manifeste du serveur et le liste comme **Outils découverts** — le nom de chaque outil, sa description et si le serveur le marque **Nécessite une approbation**. Les outils marqués demandent dans le chat chaque fois qu’un agent les appelle, avec les arguments exacts affichés sur la carte ; les outils non marqués s’exécutent comme n’importe quel outil intégré.

<Warning>

Chaque outil MCP élargit ce que tes agents peuvent atteindre, et les drapeaux d’approbation viennent de l’auteur du serveur — connecter un serveur, c’est accepter son contrat d’outils. Lis la liste découverte avant de pointer des agents vers un serveur que tu n’as pas écrit.

</Warning>

## L’utiliser depuis les agents

Les outils d’un serveur enregistré et actif rejoignent la panoplie que les agents peuvent appeler ; la requête voyage à travers Tale jusqu’à ton serveur et la réponse revient dans la conversation. Le serveur peut aussi exposer des ressources et des prompts là où son auteur les implémente — les outils sont la surface commune.

## Désactiver et supprimer

Chaque ligne de serveur peut être désactivée — ses outils sortent des panoplies d’agents jusqu’à ce que tu le réactives, l’enregistrement étant conservé. Supprimer le serveur retire l’enregistrement entièrement après une confirmation ; le rajouter plus tard est un enregistrement neuf avec une récupération neuve du manifeste.

## Serveur MCP ou connector

Les deux laissent un agent atteindre au-delà de Tale ; la différence est qui possède le connecteur. Les connectors sont propres à un fournisseur, livrées et entretenues dans le catalogue ; les serveurs MCP sont génériques et à toi de les faire tourner. Va vers l’connector quand il en existe une pour le système cible ; va vers MCP quand le pont doit être ton propre code.

## Où cela s’inscrit

MCP est la surface d’extension ouverte de la panoplie d’agent. Les lectures suivantes naturelles sont [Outils d’agent](/fr/platform/agents/tools) pour la façon dont les outils font surface sur un agent, [Configurer les approbations](/fr/platform/approvals/configure) pour les drapeaux qui retiennent les appels risqués, et le tutoriel [Serveur MCP en partant de zéro](/fr/tutorials/developer/mcp-server-from-scratch) pour en construire un de bout en bout.
