---
title: Configurer un espace pour ton équipe
description: Connecter un fournisseur, ajouter les membres et vérifier les accès dont l’équipe a besoin.
---

Un espace utilisable nécessite une organisation, un fournisseur de modèles qui fonctionne et des comptes avec les bons accès. Mets ces bases en place, puis configure les contrôles adaptés au travail prévu.

## Avant de commencer

Utilise un compte Propriétaire ou Admin sur la bonne instance. La configuration initiale crée le premier compte et l’organisation. Si ton organisation apparaît déjà dans le Dashboard, ouvre ses paramètres au lieu d’en créer une autre.

Prépare les identifiants du fournisseur dans ton gestionnaire de mots de passe. Le fournisseur doit prendre en charge le modèle et les tâches souhaités. La page [Fournisseurs IA](/fr/platform/admin/providers) explique les identifiants, les catalogues et les environnements d’exécution des agents.

## Connecter un fournisseur et tester le chat

<Steps>

<Step title="Ajouter les identifiants">

Ouvre **Paramètres > Fournisseurs IA**, sélectionne **Ajouter des identifiants**, puis choisis le fournisseur. Renseigne les champs de sa méthode d’authentification et enregistre. Donne aux identifiants un nom qui permette à un autre admin de comprendre leur usage.

<Frame caption="Les identifiants connectés rendent les modèles du fournisseur disponibles dans l’espace.">

![Les paramètres des fournisseurs IA présentent les identifiants de fournisseurs connectés.](/images/get-started/settings-providers.webp)

</Frame>

</Step>

<Step title="Vérifier le modèle dans un nouveau chat">

Ouvre **Chat**, démarre une conversation et choisis un modèle disponible. Envoie une demande autonome, par exemple « Rédige une liste de trois points pour préparer une réunion ». Attends la réponse complète. L’enregistrement des identifiants ne prouve pas à lui seul que le compte a accès au modèle choisi.

Si la liste reste vide ou si le fournisseur refuse la requête, suis les étapes de dépannage de la page [Fournisseurs IA](/fr/platform/admin/providers).

</Step>

</Steps>

## Ajouter les personnes avec les bons accès

Ouvre **Paramètres > Membres** et sélectionne **Ajouter un membre**. Pour un nouveau compte, le formulaire définit un mot de passe initial ; un compte existant conserve ses identifiants. Ce parcours n’envoie pas d’invitation par e-mail. [Membres et rôles](/fr/platform/admin/members-and-roles) détaille les champs et la remise sécurisée des premiers identifiants.

<Frame caption="Vérifie le rôle de chaque membre avant de lui transmettre l’accès.">

![La page Membres présente les personnes de l’organisation et le rôle attribué à chacune.](/images/get-started/settings-organization-members.webp)

</Frame>

Choisis le rôle selon le travail : les Membres utilisent l’espace, les Éditeurs maintiennent les contenus partagés, les Développeurs travaillent sur les intégrations et les automatisations, et les Admins gèrent l’organisation. Consulte le tableau détaillé des autorisations lorsque les tâches se recoupent. Les équipes et le partage des projets déterminent aussi les projets accessibles.

## Vérifier le premier parcours de l’équipe

Demande à un collègue de se connecter avec son propre compte, d’envoyer un message et d’ouvrir le projet nécessaire. Vérifie aussi les sources partagées avec ce compte. Tester uniquement comme Propriétaire peut masquer un manque de droits ou un accès trop large.

<Tip>

Commence avec un projet représentatif et quelques documents sources. Vérifie que les personnes trouvent le travail et que les comptes prévus accèdent aux fichiers avant d’importer une grande bibliothèque.

</Tip>

## Définir les règles d’exploitation

Examine selon tes besoins [les politiques et les limites](/fr/platform/admin/governance/policies-and-limits), [les journaux d’audit](/fr/platform/admin/governance/audit-logs) et [le SSO](/fr/platform/admin/enterprise-sso). Désigne les responsables des identifiants, des revues d’accès et des tâches en échec. En auto-hébergement, prévois aussi un processus testé de [sauvegarde et de restauration](/fr/self-hosted/operate/backups-and-restore).
