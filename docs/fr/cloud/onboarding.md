---
title: Onboarding Cloud
description: De la demande de démo à une organisation prête pour la production — ta propre instance montée par l’équipe Tale, créer l’organisation, inviter le premier admin, ajouter un fournisseur de modèles, doter un projet d’un premier agent, ouvrir le chat.
---

<!--
  Internal, for agents editing this page: Tale Cloud has no self-serve sign-up — tale.dev
  ships no sign-up route. A Cloud customer fills in the demo request form
  (https://tale.dev/request-demo — /de/ and /fr/ localized), and the Tale team sets up a
  dedicated demo instance for them. The journey below only starts once that instance exists;
  from there it deliberately mirrors normal first-run onboarding (sign-up on the customer's
  own instance, org wizard, providers). Keep the request-your-instance step first and do not
  change the entry point back to a tale.dev sign-up.
-->

Ce parcours va de la demande de démo à une organisation Cloud prête pour la production avec un agent qui fonctionne. Le résultat est une organisation où ton équipe peut se connecter, demander quelque chose d’utile à l’assistant du chat et confier sa première tâche à un agent de projet — rien d’extraordinaire encore, juste le socle sur lequel tout le reste se construit.

Il te faut une adresse e-mail qui fonctionne et la possibilité de la vérifier. Le parcours ne suppose aucune connaissance préalable de Tale ; si quelque chose ci-dessous mentionne un concept que tu n’as pas rencontré, la page liée l’introduit. Une fois ton instance prête, la partie pratique prend moins d’une heure — environ la moitié part dans l’étape du fournisseur, le reste est surtout des clics.

## Avant de commencer

Cale trois choses :

- Une adresse e-mail pour le premier compte **Propriétaire** de l’organisation. Ce compte portera le rôle le plus élevé ; choisis quelqu’un qui ne quittera pas l’équipe la semaine prochaine.
- Des identifiants API pour au moins un fournisseur de modèles (OpenAI, Anthropic, Azure ou un compatible local). Le portail du fournisseur montre où ils vivent.
- La région où ancrer tes données. Cloud propose la Suisse et l’UE ; le choix fait partie de la mise en place de l’instance — changer plus tard est une vraie migration.

## De la demande de démo à un agent qui fonctionne

<Steps>

<Step title="Demande ton instance">

Tale Cloud ne s’active pas en libre-service — chaque organisation Cloud tourne sur sa propre instance, montée pour toi par l’équipe Tale. Remplis le formulaire de demande de démo sur [tale.dev/fr/request-demo](https://tale.dev/fr/request-demo) ; le nom et l’e-mail suffisent, la société et une ligne sur ce que tes agents doivent faire aident l’équipe à ajuster la mise en place. L’équipe monte ensuite ta propre instance de démo — un environnement dédié, pas un essai partagé — et revient vers toi dès qu’elle est prête.

</Step>

<Step title="Crée ton organisation">

Ouvre ton instance et inscris-toi. Le formulaire demande ton nom, ton e-mail et un mot de passe ; vérifie le lien reçu par e-mail. L’écran suivant demande le **Nom de l'organisation** — le nom affiché que ton équipe verra dans le coin de chaque page. Choisis-en un qui survit à un rebranding.

<Frame caption="L’étape espace de travail — le nom que ton équipe voit partout.">

![L’assistant de création d’organisation à son étape espace de travail, avec Northlight Labs saisi dans le champ Nom de l’organisation et le bouton Suivant actif.](/images/get-started/org-create-wizard.webp)

</Frame>

Le premier utilisateur devient automatiquement **Propriétaire** de l’organisation. Tu retrouveras ton rôle plus tard sous **Paramètres > Membres** si tu l’oublies.

</Step>

<Step title="Invite le premier admin">

Ouvre **Paramètres > Membres** et clique sur **Ajouter un membre**. Saisis le nom et l’e-mail de l’admin, assigne le rôle **Admin** et fixe un mot de passe — Tale crée le compte directement et affiche les identifiants une seule fois ; enregistre-les et transmets-les au nouvel admin par un autre canal (il n’y a pas d’e-mail d’invitation). La personne atterrit dans l’organisation avec le rôle que tu as assigné. La règle de sécurité « au moins 2 Admins » empêche une organisation de s’enfermer dehors en retirant son seul Admin — ajoute un second admin avant toute action qui l’exige.

Pour la matrice des rôles (qui peut faire quoi), voir [Membres et rôles](/fr/platform/admin/members-and-roles).

</Step>

<Step title="Ajoute un fournisseur de modèles">

Ouvre **Paramètres > Fournisseurs IA**, repère le connecteur pour lequel tu détiens une clé et clique sur **Ajouter un identifiant**. Donne-lui un nom qui dira plus tard de quelle clé il s’agit, choisis **Clé API** comme méthode d’authentification et colle la clé. Elle est stockée chiffrée et devient l’identifiant par défaut du connecteur quand c’est le premier ; un second identifiant sur le même connecteur est permis, et c’est toi qui désignes le défaut. Quand une clé est rejetée, c’est presque toujours un espace autour d’elle.

<Frame caption="Le fournisseur connecté — à partir d’ici, chaque agent peut répondre.">

![La page des paramètres des fournisseurs d’IA listant un seul fournisseur connecté, OpenRouter, avec son URL de base et ses 52 modèles.](/images/get-started/settings-providers.webp)

</Frame>

<Note>

C’est l’étape où la plupart des sessions d’onboarding calent — le portail du fournisseur est souvent un autre login, et l’équipe doit creuser pour retrouver la clé. Si la validation reste bloquée plus d’une minute, recharge la page ; la clé est enregistrée dès que **Enregistrer** confirme, la ligne a parfois juste besoin d’un rechargement pour se mettre à jour.

</Note>

</Step>

<Step title="Crée ton premier agent de projet">

Ouvre l’onglet **Agents** d’un projet et clique sur **Nouvel agent**. Choisis le **Harness** — la CLI de code sur laquelle l’agent tourne — et, sous **Modèle**, le modèle que tu viens d’ajouter. Écris un bloc d’instructions d’un paragraphe — la voix dans laquelle l’agent doit répondre, le domaine qu’il connaît, les cas qu’il refuse — et clique sur **Créer l'agent**. Assigne-lui une tâche du tableau et clique sur **Démarrer l'agent** ; le résultat revient en **En revue**, où une personne l’accepte. Il n’y a ni étape de publication ni sélecteur d’agent dans le chat — dans cette version, les agents traitent les tâches du tableau.

Pour le dialogue champ par champ, voir [Agents de projet](/fr/platform/projects/project-agents) ; pour ce qui fait un bon agent, [Concepts d’agent](/fr/platform/agents/concepts).

</Step>

<Step title="Ouvre le chat">

Clique sur **Nouveau chat** dans la barre latérale. Le sélecteur de modèle du composer s’ouvre sur **Auto** — Tale choisit un modèle chez le fournisseur que tu as connecté —, alors tape une question que le domaine de ton équipe couvre, et envoie.

<Check>

La réponse arrive en streaming et enregistre quel modèle a répondu — l’organisation a fini son onboarding.

</Check>

Trois suites qui valent la peine maintenant, pendant que tout est frais :

- Ouvre **Paramètres > Branding** et téléverse le logo de l’organisation.
- Règle la langue par défaut de l’organisation sous **Paramètres > Organisation**.
- Parcours [Trust et conformité](/fr/cloud/trust-and-compliance) pour savoir quoi montrer à un auditeur avant qu’on te le demande.

</Step>

</Steps>

## Dépannage

- **La liste des modèles est vide quand tu crées l’agent.** L’étape du fournisseur n’a pas abouti — un modèle doit exister sous **Paramètres > Fournisseurs IA** avant que le dialogue de l’agent puisse en choisir un.
- **La validation du fournisseur échoue avec « invalid key ».** Recopie la clé depuis le portail du fournisseur — la copie embarque souvent un espace en tête ou en queue.
- **Démarrer l'agent échoue avec un motif côté fournisseur.** Le fournisseur choisi ne peut plus servir ce modèle — corrige-le sous **Paramètres > Fournisseurs IA** et redémarre l’agent.

## Où ça s’utilise

Tu as maintenant une organisation avec un agent qui fonctionne et un admin en plus de toi. Le parcours suivant naturel est [Construire ton premier agent de bout en bout](/fr/tutorials/editor/first-agent-end-to-end) — même forme, mais il met un agent de projet au travail sur une vraie tâche et relit ce qui revient. Si tu es venu évaluer Cloud face à l’auto-hébergé, [Migrer vers auto-hébergé](/fr/cloud/migrate-to-self-hosted) est le parcours inverse.
