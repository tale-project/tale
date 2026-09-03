---
title: Installer le complément Outlook
description: Déploie la sidebar Tale dans Outlook et Microsoft 365 pour que les membres rédigent des réponses avec les agents Tale sans quitter leur boîte de réception.
---

Le complément Outlook fait apparaître une sidebar Tale dans Outlook sur le web, sur poste de travail et sur mobile. Depuis la sidebar, un membre choisit un agent, glisse le fil de courriel ouvert comme contexte et récupère un brouillon de réponse sans changer d'application. Ce parcours s'adresse à un Admin qui déploie le complément à l'échelle de l'organisation ; il couvre le déploiement du manifeste, la connexion et la vérification.

Il te faut le rôle Admin dans Tale, un tenant Microsoft 365 où tu peux gérer les Integrated Apps et une instance Tale joignable depuis le cloud Microsoft 365. Les organisations Cloud sont joignables par défaut ; les instances auto-hébergées ont besoin d'une URL HTTPS publique.

## Avant de commencer

Confirme trois choses côté Microsoft : tu es Global Administrator (ou disposes du rôle Exchange Admin avec Integrated Apps), le déploiement centralisé est activé pour ton tenant, et la boîte aux lettres de test n'a pas bloqué les compléments via une mailbox policy. Côté Tale, ouvre **Paramètres > Connectors** et vérifie que **Microsoft 365** est listé — c'est là que le complément publie l'URL du manifeste.

## Étape 1 — Récupérer l'URL du manifeste depuis Tale

Le complément parle à Tale via un manifeste XML hébergé par le centre d'administration Microsoft 365. Tale génère le manifeste par instance pour que la sidebar pointe sur ton URL et non sur un endpoint multi-tenant partagé. Ouvre **Paramètres > Connectors > Microsoft 365** et copie l'**URL du manifeste du complément** que le panneau affiche.

Tu devrais voir une URL se terminant par `/connectors/office/manifest.xml`. Ouvre-la dans un nouvel onglet pour confirmer qu'elle renvoie du XML et pas une page d'erreur HTML — si elle échoue, ton instance n'est pas joignable depuis l'extérieur ou le connector est désactivée.

## Étape 2 — Déployer via le centre d'administration Microsoft 365

Le manifeste dit à Microsoft 365 quelles boîtes aux lettres voient la sidebar et depuis quelle URL la charger. Le déploiement centralisé est le chemin pris en charge ; le side-loading utilisateur par utilisateur fonctionne mais ne survit pas à une migration de boîte.

Ouvre le centre d'administration Microsoft 365, navigue vers **Paramètres > Applications intégrées > Charger des applications personnalisées**, choisis **Complément Office** et **Fournir le lien vers le fichier manifeste**, et colle l'URL de l'étape 1. Choisis l'audience du déploiement — tout le tenant, un groupe de sécurité ou une liste précise d'utilisateurs.

Soumets. Microsoft confirme le déploiement par une bannière verte ; le déploiement atteint typiquement les boîtes en une heure, parfois quelques heures sur un grand tenant.

## Étape 3 — Se connecter depuis la sidebar

Ouvre Outlook avec un utilisateur de l'audience, clique sur un message quelconque et cherche l'icône Tale dans le ruban du message. Un clic ouvre la sidebar ; à la première ouverture elle demande à l'utilisateur de se connecter avec son compte Tale. La connexion passe par OAuth via l'instance Tale — même fournisseur d'identité que l'application web.

Une fois connecté, la sidebar liste les agents disponibles pour cet utilisateur. En choisir un et cliquer **Rédiger une réponse** intègre le fil de courriel ouvert comme contexte et streame une réponse dans la sidebar. L'utilisateur révise, modifie et clique **Insérer** pour la déposer dans la fenêtre de rédaction Outlook.

## Où ça s'utilise

Le complément est le chemin le plus léger vers « Tale là où tes membres travaillent déjà » — pas de changement de portail, pas de copier-coller. La sidebar est une fine enveloppe autour du même chat que tu utilises dans Tale — voir [Chat](/fr/platform/chat/overview) ; dans cette version, les agents travaillent des tâches du tableau plutôt que de répondre dans le chat, il n'y a donc rien à publier dans la sidebar.

Pour la grande histoire de connector — Slack, Gmail et les autres connectors livrés — voir [Aperçu des connectors](/fr/platform/connectors/overview). Si tu exploites une instance auto-hébergée et que l'URL du manifeste n'est pas joignable depuis Microsoft 365, la page [Linux serveur](/fr/self-hosted/install/linux-server) couvre le prérequis HTTPS public.
