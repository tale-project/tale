---
title: Onboarding Cloud
description: De l'inscription à une organisation prête pour la production en moins d'une heure — créer l'organisation, inviter le premier admin, ajouter un fournisseur de modèles, publier un agent, ouvrir le chat.
---

Ce tutoriel parcourt de l'inscription à une organisation Cloud prête pour la production avec un agent qui marche, en moins d'une heure. Le résultat est une organisation où ton équipe peut se connecter, choisir un agent qui fonctionne, et lui demander quelque chose d'utile — rien d'extraordinaire pour l'instant, juste le socle sur lequel tout le reste se construit.

Il te faut une adresse e-mail fonctionnelle et la capacité de la vérifier. Le parcours ne suppose aucune connaissance préalable de Tale ; si quelque chose ci-dessous référence un concept que tu n'as pas rencontré, la page liée l'introduit. Environ la moitié du temps tient dans l'étape 3 (ajouter le fournisseur de modèles) — le reste est surtout des clics.

## Avant de commencer

Cale trois choses :

- Une adresse e-mail pour le premier Owner de l'organisation. Ce compte porte le rôle le plus élevé ; choisis quelqu'un qui ne va pas quitter l'équipe la semaine prochaine.
- Des identifiants API pour au moins un fournisseur de modèles (OpenAI, Anthropic, Azure, ou un compatible local). Le portail du fournisseur montre où ils vivent.
- La région où tu veux ancrer tes données. Cloud propose la Suisse et l'UE ; choisis une fois, changer plus tard est une vraie migration.

## Étape 1 — Créer ton organisation

Visite `tale.dev` et clique **Sign up**. Le formulaire demande nom, e-mail et mot de passe ; vérifie le lien e-mail quand il arrive. L'écran suivant demande le **Nom de l'organisation** — le nom affiché que ton équipe verra dans le coin de chaque page. Choisis quelque chose qui survit à un rebranding.

Le premier utilisateur devient automatiquement **Owner** de l'organisation. Tu verras ton rôle plus tard sous **Paramètres > Personnes** si tu oublies.

## Étape 2 — Inviter le premier admin

Ouvre **Paramètres > Personnes** et clique **Inviter un membre**. Entre l'e-mail de l'admin et assigne le rôle **Admin**. L'invité reçoit un e-mail avec un lien magique ; il s'inscrit et atterrit dans l'organisation avec le rôle assigné. La règle de sécurité « au moins 2 Admins » empêche une organisation de s'enfermer accidentellement en retirant son seul Admin — invite un second admin avant de faire quoi que ce soit qui le requiert.

Pour la matrice des rôles (qui peut faire quoi), voir [Membres et rôles](/fr/platform/admin/members-and-roles).

## Étape 3 — Ajouter un fournisseur de modèles

Ouvre **Paramètres > Providers** et clique **Add provider**. Choisis le fournisseur pour lequel tu as des identifiants et colle la clé API. Enregistre. Tale valide la clé en arrière-plan ; une coche sur la ligne du fournisseur signifie que la clé marche. Si la validation échoue, la ligne montre l'erreur telle quelle — la cause la plus fréquente est un espace blanc autour de la clé.

Cette étape est celle où la plupart des sessions d'onboarding calent. Le portail du fournisseur est généralement un autre login, et l'équipe doit creuser pour trouver la clé. Si la validation est bloquée plus d'une minute, recharge la page — la clé est enregistrée dès que **Save** confirme, la ligne a juste parfois besoin d'un reload pour se mettre à jour.

## Étape 4 — Publier ton premier agent

Ouvre **Agents** et clique **Create agent**. Choisis le modèle que tu viens d'ajouter. Écris un paragraphe d'instructions — la voix dans laquelle l'agent doit répondre, le domaine qu'il connaît, les cas qu'il refuse. Enregistre. Active **Visible in chat**. L'agent est maintenant joignable depuis n'importe quel chat de l'organisation.

Pour une marche plus profonde sur ce qui fait un bon agent, voir [Créer un agent](/fr/platform/agents/create).

## Étape 5 — Ouvrir le chat

Ouvre **Chat** dans la sidebar et clique **Nouveau chat**. Choisis l'agent dans le sélecteur, tape une question que le domaine de l'agent couvre, envoie. La réponse arrive en streaming ; si elle atterrit comme tu l'as écrite dans les instructions, l'organisation a fini son onboarding.

Trois suites utiles à faire maintenant pendant que tout est frais :

- Ouvre **Paramètres > Branding** et téléverse le logo de l'organisation.
- Règle la langue par défaut de l'organisation sous **Paramètres > Organisation**.
- Parcours [Trust et conformité](/fr/cloud/trust-and-compliance) pour savoir ce que tu montres à un auditeur avant qu'on te le demande.

## Dépannage

- **L'e-mail d'invitation n'arrive jamais.** Vérifie le dossier spam de l'invité. Tale envoie depuis `noreply@tale.dev` ; certains filtres d'entreprise le mettent en quarantaine.
- **La validation du fournisseur échoue avec « invalid key ».** Recopie la clé depuis le portail du fournisseur — la copie embarque souvent un espace en tête ou en queue.
- **L'agent n'apparaît pas dans le sélecteur du chat.** Confirme que **Visible in chat** est activé pour l'agent.

## Où ça s'utilise

Tu as maintenant une organisation avec un agent qui marche et un admin en plus de toi. La marche suivante naturelle est [Construire ton premier agent de bout en bout](/fr/tutorials/editor/first-agent-end-to-end) — même forme, mais construit un agent qui fait un vrai travail de domaine avec des liaisons de connaissances. Si tu es venu ici pour évaluer Cloud face à auto-hébergé, [Migrer vers auto-hébergé](/fr/cloud/migrate-to-self-hosted) est la marche inverse.
