---
title: Intégrations
description: Les systèmes tiers auxquels Tale se connecte — le catalogue sous Paramètres > Intégrations, ce que fait chaque connecteur, comment la connexion fonctionne et en quoi la surface diffère de MCP.
---

Les intégrations sont les ponts entre Tale et le reste de ta stack : les agents les appellent comme outils, les workflows les appellent à leurs étapes, et le pipeline de connaissances tire des documents à travers elles. L’org connecte chacune une seule fois sous **Paramètres > Intégrations** ; à partir de là, tout dans Tale peut l’utiliser sans se ré-authentifier. Cette vue d’ensemble nomme le catalogue livré et les deux façons de l’étendre.

Tu préfères regarder d’abord ? L’épisode 7 parcourt les portes vers l’extérieur — connecteurs, MCP et frontières — en deux minutes et demie, sous-titres compris.

<Video src="/videos/tutorials/ep7-integrations/ep7-integrations.fr.mp4" poster="/videos/tutorials/ep7-integrations/ep7-integrations.fr.webp" captions="/videos/tutorials/ep7-integrations/ep7-integrations.fr.vtt" lang="fr" title="Épisode 7 — Intégrations & le monde extérieur" caption="Épisode 7 — Intégrations & le monde extérieur (2:18)">

</Video>

<Frame caption="Paramètres > Intégrations sur l’onglet Toutes les intégrations — le catalogue complet, chaque carte à un Connecter de distance.">

![La page Intégrations des Paramètres montrant un champ de recherche, un bouton Ajouter une intégration et une grille de cartes de douze services dont Confluence, GitHub, Gmail, Slack et Twilio.](/images/platform/integrations-catalog.webp)

</Frame>

## Le catalogue

La page a deux onglets — **Connectées** montre ce que l’org utilise déjà, **Toutes les intégrations** le catalogue complet avec un champ de recherche. La description de chaque carte est la ligne honnête de ce que la connexion t’apporte :

| Intégration             | Ce qu’elle fait                                                                                                                                                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Confluence**          | Importer des pages Confluence Cloud dans la base de connaissances de Tale.                                                                                                                                                |
| **Discord**             | Poster des messages et gérer des canaux dans ton serveur Discord.                                                                                                                                                         |
| **GitHub**              | Gérer des dépôts, des tickets et des pull requests sur GitHub.                                                                                                                                                            |
| **Gmail**               | Lire, envoyer et organiser les e-mails dans Gmail.                                                                                                                                                                        |
| **Google Drive**        | Importer des fichiers depuis Google Drive dans la base de connaissances de Tale.                                                                                                                                          |
| **IMAP / SMTP Mailbox** | Connecter un serveur mail IMAP + SMTP privé à la Boîte de réception — sans compte Gmail ni Outlook ; l’envoi peut passer par un relais SMTP séparé (Resend, SendGrid, Amazon SES, …) plutôt que par le login de la boîte. |
| **Microsoft Outlook**   | Gérer le courrier, le calendrier et les contacts Outlook.                                                                                                                                                                 |
| **Shopify**             | Synchroniser les produits, les clients et les commandes depuis ta boutique Shopify.                                                                                                                                       |
| **Slack**               | Envoyer des messages et interagir avec les canaux dans Slack.                                                                                                                                                             |
| **Tavily**              | Recherche web en temps réel et extraction de pages pour la recherche IA.                                                                                                                                                  |
| **Microsoft Teams**     | Envoyer des messages et gérer des canaux dans Microsoft Teams.                                                                                                                                                            |
| **Twilio**              | Envoyer des SMS et passer des appels vocaux avec Twilio.                                                                                                                                                                  |

## En connecter une

Clique sur **Connecter** sur une carte. Les services adossés à OAuth déroulent le flux de consentement du fournisseur ; ceux à token demandent l’identifiant dans une section **Authentification**. La vue de détail liste aussi les opérations de l’intégration — celles badgées **Nécessite une approbation** tiennent dans le chat jusqu’à ce qu’une personne signe, ce qui garde les écritures sortantes sous contrôle ([Configurer les approbations](/fr/platform/approvals/configure)).

Les documents importés via Confluence ou Google Drive passent par le même pipeline d’indexation que les téléversements directs, et les citations pointent vers la source — voir [Documents](/fr/platform/knowledge/documents).

## Étendre au-delà du catalogue

**Ajouter une intégration** téléverse un connecteur personnalisé — un petit paquet fait d’un `config.json`, d’un `connector.js` ou `.ts` et d’une icône (en `.zip` ou en fichiers séparés, 1 Mo au total). L’aperçu montre ses opérations, ses hôtes autorisés et le code du connecteur avant l’installation, et le résultat apparaît dans le catalogue comme n’importe quelle entrée livrée.

Quand aucun connecteur ne convient et que tu peux héberger le pont toi-même, enregistre plutôt un [serveur MCP](/fr/platform/integrations/mcp-servers) — une surface de protocole générique plutôt qu’un connecteur propre à un fournisseur.

<Note>

WebDAV n’est pas dans ce catalogue parce qu’il pointe dans l’autre sens : il sert les documents de Tale à tes appareils comme un lecteur réseau. Voir [WebDAV](/fr/platform/integrations/webdav).

</Note>

## Où cela s’inscrit

Les intégrations sont la façon dont les agents agissent sur le monde hors de Tale. Pour l’auteur d’agents, [Outils d’agent](/fr/platform/agents/tools) montre comment les opérations d’une intégration font surface comme outils ; pour l’approbateur, [Configurer les approbations](/fr/platform/approvals/configure) est là où les opérations d’écriture sont retenues ; pour le bâtisseur sans connecteur sous la main, les [serveurs MCP](/fr/platform/integrations/mcp-servers) sont l’alternative ouverte.
