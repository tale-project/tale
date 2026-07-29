---
title: Migrer vers auto-hébergé
description: Quand l'auto-hébergement bat Cloud, ce qui est transféré et ce qui ne l'est pas, et comment transporter ton organisation sans casser les agents en cours.
---

La migration de Cloud vers l'auto-hébergement est une vraie procédure, pas un basculement de réglage. Les données s'exportent, la nouvelle instance importe, le DNS bascule vers le nouvel hôte, et ton équipe se connecte dans la même organisation qu'avant — mêmes agents, mêmes chats, même historique d'audit. Ce tutoriel parcourt la procédure et pointe vers les endroits où elle déraille.

Va-y quand l'auto-hébergement convient vraiment mieux : la résidence des données exige du matériel sous ton contrôle, les coûts à l'échelle rendent on-premise moins cher que au-token, ou l'organisation a décidé de faire tourner la pile elle-même. Pour la plupart des équipes, Cloud reste le bon choix — relis [Onboarding Cloud](/fr/cloud/onboarding) si tu hésites encore.

## Avant de commencer

Mets ces choses en place avant d'exporter quoi que ce soit :

- Un hôte cible qui répond aux prérequis auto-hébergé — voir [Démarrage rapide](/fr/self-hosted/install/quickstart) pour le cahier des charges.
- Le contrôle DNS sur le domaine que ton organisation utilise actuellement ; tu le balanceras lors de la bascule.
- Une fenêtre de maintenance d'au moins une heure. L'import lui-même est plus rapide, mais la propagation DNS et la validation ajoutent du temps.
- Une confirmation de sauvegarde récente dans le journal d'audit de ton organisation Cloud. Rien n'est supprimé dans la source pendant une migration, mais le bundle d'export est ta preuve que l'état source était cohérent.

## Ce qui est transféré et ce qui ne l'est pas

Transféré : chats, threads, messages, pièces jointes, documents, embeddings de connaissances, agents, versions d'agents, workflows, exécutions, journaux d'audit, membres, rôles, équipes, branding, clés API, métadonnées de connectors.

Pas transféré : les connectors externes doivent être réauthentifiées contre la nouvelle instance (les identifiants vivent chez le fournisseur, pas dans le bundle d'export) ; les workflows actifs en cours se mettent en pause et reprennent sur la nouvelle instance après la bascule ; les audios vocaux conservés au-delà de la fenêtre de rétention de l'organisation restent dans le stockage objet Cloud jusqu'à leur purge.

## Étape 1 — Exporter

Ouvre **Paramètres > Organisation** sur Cloud et clique **Export**. Le dialogue lance l'export en arrière-plan et envoie par e-mail un lien de téléchargement une fois terminé. L'export est un seul bundle chiffré ; l'e-mail contient la clé de déchiffrement. Télécharge le bundle et garde la clé séparément.

## Étape 2 — Mettre en place l'instance cible

Sur l'hôte cible, suis [Démarrage rapide](/fr/self-hosted/install/quickstart) jusqu'à l'étape premier-admin. N'invite pas encore d'utilisateurs — l'import écrase la liste des membres. Confirme que la nouvelle instance démarre et que tu peux te connecter comme Owner.

## Étape 3 — Importer

Sur l'instance cible, connecte-toi comme Owner et visite `/_internal/import` (lié depuis la page Paramètres après une installation neuve). Téléverse le bundle, colle la clé de déchiffrement, et clique **Import**. L'import est une opération longue ; la page montre la progression par classe de données. Quand la page se résout à **Import complete**, la nouvelle instance porte l'état complet de l'organisation source.

## Étape 4 — Basculer le DNS

Mets à jour l'enregistrement DNS du domaine de l'organisation pour pointer vers la nouvelle instance. Une fois la propagation effectuée et le TLS de la nouvelle instance en bonne santé, les utilisateurs qui se connectent arrivent sur l'instance auto-hébergée avec leurs identifiants existants. L'organisation Cloud devient en lecture seule à ce moment — pour éviter la dérive, archive-la sous **Paramètres > Organisation** sur Cloud après quelques jours de confiance.

## Dépannage

- **L'export reste bloqué à « preparing ».** Les très grosses organisations (>100 Go) prennent plus de temps que la fenêtre e-mail suppose. Ouvre un ticket support ; l'export va jusqu'au bout en arrière-plan.
- **L'import échoue sur un schéma incompatible.** Ton instance cible fait tourner une version Tale plus ancienne que ce que l'export Cloud attend. Mets à jour la cible avant de retenter — le bundle est compatible vers l'avant, pas vers l'arrière.
- **Les membres ne peuvent pas se connecter après la bascule.** Les cookies de session sont scopés à l'ancien hôte. Les membres se ré-authentifient une fois ; les réglages SSO et 2FA traversent.
- **Les workflows affichent « en pause » après l'import.** Attendu — l'import préserve l'état mais ne reprend pas automatiquement les exécutions en cours. Ouvre chaque workflow et clique **Resume** après avoir confirmé que l'instance cible est joignable depuis les déclencheurs externes.

## Où ça s'utilise

La migration est en pratique une opération à sens unique — une fois auto-hébergé, tu y restes, sauf changement structurel. La migration inverse (auto-hébergé vers Cloud) suit la même forme avec les mêmes outils et est prise en charge, mais rare. Si tu es encore sur Cloud et tu lis ça pour le contexte, la page à enchaîner est [Aperçu auto-hébergé](/fr/self-hosted/overview) ; elle nomme ce que tu prends sur les épaules.
