---
title: Modèles d’automatisation
description: Parcours les automatisations fournies par Tale, vois dans l’aperçu ce que chacune fait et ce dont elle a besoin, puis fais-en la tienne en quelques réponses, en brouillon ou démarrée tout de suite.
---

Une nouvelle organisation commence sans aucune automatisation. Tout ce que Tale fournit — synchronisations e-mail, tri de la boîte de réception, synchronisations d’issues, revue de code, récapitulatifs et notifications — est un modèle dans un catalogue unique. Tu ouvres l’aperçu d’un modèle, tu réponds à quelques questions, par exemple le projet qu’il sert, la boîte mail qu’il lit ou le moment où il s’exécute, et Tale le crée comme ta propre automatisation, que tu modifies comme n’importe quelle autre. Seuls les rôles Propriétaire, Admin et Développeur créent des automatisations.

## Parcourir le catalogue

1. Ouvre **Automatisations** et choisis **Créer une automatisation** › **À partir d’un modèle**. Tant que ton organisation n’a aucune automatisation, **Parcourir les modèles** dans la liste vide ouvre le même catalogue.
2. Restreins le catalogue avec les catégories — **Tous**, **Réception**, **Issues**, **Revue de code**, **Tâches**, **Notifications** et **Webhooks** — ou recherche par nom.

Chaque carte montre le produit avec lequel le modèle travaille, ce qu’il fait en une ligne et quand il s’exécute. **À connecter d’abord** signale un modèle qui a besoin d’un connector que ton organisation n’a pas encore connecté. **Utilisé** indique que tu as déjà créé une automatisation à partir de lui, et combien.

![La boîte de dialogue Templates avec ses onglets de catégories, de All à Webhooks, la recherche et une grille de cartes de modèles, chacune avec le logo de son produit, son nom, quand il s’exécute et une ligne ; certaines cartes indiquent Connect first ou In use.](/images/platform/automation-template-catalog.webp)

## Voir un modèle

Choisis une carte pour ouvrir son aperçu.

| Partie | Ce qu’elle indique |
| --- | --- |
| **Comment ça marche** | Ses étapes dans l’ordre, en termes simples. |
| **Ce qu’il modifie** | Ce qu’il crée, modifie ou envoie, et ce qu’il ne fait jamais. |
| **Quand il s’exécute** | La planification, l’événement de la plateforme ou le webhook qui le démarre. |
| **Ce dont il a besoin** | Les connectors qu’il utilise et s’ils sont connectés. **Connecter** ouvre **Paramètres** › **Connectors**. Un modèle qui ne travaille que sur ce qu’un autre apporte, comme un résumé de la réception qu’une synchronisation e-mail remplit, renvoie plutôt à **Fonctionne avec**. |
| **Fonctionne avec** | Les modèles prévus pour tourner à côté de lui, comme la synchronisation e-mail qui remplit la réception qu’un tri lit. |
| **Déroulé** | Ses étapes telles que l’éditeur les montrera, en lecture seule. |

![L’aperçu de Triage the Gmail inbox : ce qu’il fait, ses étiquettes Inbox et In use, How it works en quatre étapes numérotées, What it changes, When it runs toutes les 6 heures dans ton fuseau horaire, What it needs avec Gmail non connecté et un lien Connect, Works with Sync Gmail emails, et son déroulé dessiné en lecture seule de Start à l’étape Inbox, au-dessus de Use this template.](/images/platform/automation-template-preview.webp)

## Utiliser un modèle

1. Dans l’aperçu, choisis **Utiliser ce modèle**.
2. Réponds à ses questions. **Nom** reprend d’abord le nom du modèle ; change-le pour distinguer tes automatisations. Une question sur un identifiant propose ceux qui sont en service pour son connector ; quand elle est facultative, son premier choix dit ce que signifie la laisser vide, par exemple la connexion par défaut. Une planification commence dans ton propre fuseau horaire, et tu peux en choisir un autre.
3. Laisse **Démarrer maintenant** coché pour mettre la version 1 en service et activer son déclencheur dans la même étape. Décoché, l’automatisation est créée comme brouillon, déclencheur désactivé, que tu mets en service depuis l’[éditeur](/fr/platform/automations/editor). **Démarrer maintenant** n’est pas disponible tant qu’un connector dont le modèle a besoin n’est pas connecté. Quand une question demande l’un des identifiants de ce connector, il n’y a encore rien à choisir : connecte-le d’abord, puis crée l’automatisation.
4. Choisis **Créer l’automatisation**. La nouvelle automatisation s’ouvre.

![Les questions de Tell the reviewer : son nom, le projet Website relaunch, la relectrice Priya Raman, le message et Start it now coché, au-dessus de Create automation.](/images/platform/automation-template-setup.webp)

La création est une seule étape : si quoi que ce soit est refusé, rien n’est créé et rien ne reste à moitié démarré. Quand Tale ne peut pas utiliser une réponse — un projet que tu ne peux pas ouvrir, une personne qui n’est pas membre de l’organisation, un identifiant qui n’est pas en service, un nombre en dehors de ce que la question accepte —, la question dit pourquoi. Un nom qu’une autre automatisation porte déjà est refusé aussi ; choisis-en un autre.

Depuis la liste **Automatisations** d’un projet, un modèle qui sert un projet démarre avec ce projet déjà choisi, et la nouvelle automatisation s’ouvre dans le projet.

Un modèle démarré par un webhook affiche son adresse une seule fois, juste après la création de l’automatisation. Copie-la avant de choisir **Ouvrir l’automatisation** : seul un hachage de son token est conservé, une adresse perdue ne peut donc être remplacée qu’avec **Renouveler le token**, comme l’explique [Recevoir un webhook](/fr/platform/automations/triggers#recevoir-un-webhook).

Un modèle nomme un modèle de langage pour ses étapes qui en appellent un. Quand aucun de tes fournisseurs ne le sert, chacune de ces étapes reçoit un modèle comparable qu’ils servent, et le message de la version 1 dit lequel. Quand ton organisation n’a aucun fournisseur, les étapes gardent le modèle de langage nommé, et la validation t’en avertit à l’enregistrement : choisis un modèle servi avec **Changer de modèle**, qui le remplace dans toutes les étapes à la fois.

Une organisation créée avant les modèles peut encore avoir les automatisations e-mail, GitHub et GlitchTip qu’une version antérieure a installées. Elles restent telles quelles, et le catalogue compte comme **Utilisé** chacune dont le modèle existe encore. Les imports d’issues GitHub et GlitchTip d’une version antérieure n’ont plus de modèle : [Synchroniser les issues GitHub](#github-sync-issues) et [Synchroniser les issues GlitchTip](#glitchtip-sync-issues) les remplacent, et un import que tu as déjà ne compte pour aucun des deux.

## Réception

Les synchronisations e-mail remplissent la **Réception** partagée que lisent les modèles de cette catégorie. La mise en service d’une synchronisation e-mail ajoute la vue **Réception** à [Accueil](/fr/platform#home) et propose sa boîte dans le formulaire de rédaction. Tant qu’aucune n’est en service, **Accueil** n’a pas de vue **Réception**, et un lien vers la boîte de réception affiche plutôt une invite de configuration : pour les rôles Propriétaire, Admin et Développeur, elle ouvre ce catalogue sur son onglet **Réception** ; les autres apprennent qu’une personne ayant l’un de ces rôles doit mettre en service une automatisation e-mail.

### Synchroniser les e-mails Gmail {#gmail-sync-emails}

Amène les e-mails de tes boîtes Gmail connectées dans la **Réception**, toutes les cinq minutes pour commencer. Il lit le dossier Boîte de réception de chaque boîte et, sauf si tu le désactives, aussi les messages envoyés, si bien qu’un fil contient ce qu’a écrit le client et ce que tu as répondu depuis Gmail même. Il a besoin du connector Gmail.

| Question | Ce qu’elle décide |
| --- | --- |
| **Quand** | La fréquence des passages, dans ton fuseau horaire. Toutes les cinq minutes pour commencer. |
| **Boîte mail** | La boîte Gmail connectée qu’il lit. **Toutes les boîtes Gmail connectées**, le premier choix, lit chacune là où elle s’est arrêtée ; le nom d’une connexion ne lit que cette boîte. |
| **Jours à remonter** | Jusqu’où remonte le premier passage d’une boîte, de 0 à 90 jours ; 7 pour commencer. Avec 0, seuls les e-mails qui arrivent ensuite sont lus. Les e-mails plus anciens ne le sont jamais. |
| **Lire aussi les envois** | Si les messages envoyés sont lus aussi. Activé pour commencer. |
| **E-mails par passage** | Le nombre maximal d’e-mails qu’un passage lit dans chaque boîte, de 10 à 100 ; 50 pour commencer. |

Chaque passage reprend là où le précédent s’est arrêté et lit d’abord l’e-mail le plus ancien, envois et réception dans l’ordre où les e-mails ont eu lieu : ton propre message arrive avant la réponse qu’il a reçue. Ce qui dépasse un passage, lors du premier passage d’une boîte ou après une pause, est lu par les passages suivants, et aucun e-mail n’est sauté ni enregistré deux fois. La synchronisation se repère à l’heure à laquelle Gmail a reçu chaque e-mail, jamais à la date indiquée par l’expéditeur : une horloge déréglée chez l’expéditeur ne lui fait sauter aucun e-mail. Un e-mail que tu envoies depuis la **Réception** n’est enregistré qu’une fois, même quand un passage le relit dans les envois.

Quand Gmail demande de ralentir, le passage s’arrête, garde ce qu’il a lu, et le suivant reprend ; l’exécution réussit quand même. Un e-mail supprimé ou déplacé après qu’un passage l’a listé est ignoré. Quand une boîte ne peut pas être lue, par exemple parce que sa connexion a expiré, les autres boîtes sont lues quand même et l’exécution nomme celle qui a échoué. L’exécution n’échoue que si toutes les boîtes échouent, pour que les avis d’échec de l’automatisation partent.

La sortie de l’exécution liste sous `mailboxes` ce que le passage a fait dans chaque boîte :

| Champ | Ce qu’il indique |
| --- | --- |
| `listed` | Les e-mails arrivés après l’endroit d’où le passage est parti. |
| `fetched` | Les e-mails qu’il a lus. |
| `ingested` | Les e-mails enregistrés pour la première fois. |
| `duplicates` | Les e-mails relus qui étaient déjà enregistrés. |
| `skipped` | Les e-mails impossibles à enregistrer : sans Message-ID, ou sans personne à qui les rattacher. |
| `vanished` | Les e-mails supprimés ou déplacés avant que le passage puisse les lire. |
| `capped` | `true` quand il reste plus d’e-mails qu’un passage n’en lit. Le passage suivant continue. |
| `rateLimited`, `retryAfter` | Gmail a demandé de ralentir, et quand il autorise le prochain essai, s’il l’a dit. |
| `error` | Pourquoi le passage s’est arrêté plus tôt. |
| `resumeFrom` | Où commence le passage suivant, par dossier. |

La synchronisation distingue les e-mails de la boîte elle-même de ceux d’un client grâce à l’adresse de la boîte, que le premier passage apprend du compte connecté et conserve sur la connexion comme adresse d’expéditeur. Les pièces jointes sont stockées avec leur message : tu les ouvres et les télécharges depuis la conversation. Gmail ne transmet chaque pièce jointe que jusqu’à 3,5 Mo : une pièce plus grande reste listée avec son nom et sa taille, mais tu l’ouvres dans Gmail.

La synchronisation ne fait que lire. Elle n’envoie, ne supprime, ne déplace et ne marque jamais un e-mail dans Gmail, et ce qui arrive à un e-mail dans Gmail après sa lecture, comme le marquer comme lu ou le supprimer, n’atteint pas la **Réception**. Un e-mail déplacé dans la boîte de réception Gmail une fois que la synchronisation a dépassé l’heure de sa première arrivée n’est pas lu.

Après la première exécution réelle, ouvre son [journal](/fr/platform/automations/execution-logs) et vérifie que les messages attendus apparaissent dans la vue **Réception** d’**Accueil**.

### Synchroniser les e-mails Outlook {#outlook-sync-emails}

Fonctionne comme [Synchroniser les e-mails Gmail](#gmail-sync-emails) pour les boîtes Outlook connectées, avec les mêmes questions, toutes les cinq minutes pour commencer. Il a besoin du connector Outlook. Il se repère à l’heure à laquelle Exchange a reçu chaque e-mail, ou l’a envoyé pour le dossier Éléments envoyés. Quand Outlook demande de ralentir, l’exécution indique l’attente qu’Outlook donne. Les pièces jointes sont stockées avec leur message.

### Synchroniser les e-mails via SMTP/IMAP {#imap-smtp-sync-emails}

Fonctionne comme [Synchroniser les e-mails Gmail](#gmail-sync-emails) pour les boîtes connectées en IMAP et SMTP, avec les mêmes questions, toutes les cinq minutes pour commencer. Il a besoin du connector IMAP/SMTP. Il se repère à l’heure à laquelle le serveur de messagerie a reçu chaque e-mail, et prend l’adresse de la boîte dans l’identifiant de connexion. Les messages envoyés sont lus dans le dossier que le serveur marque comme tel, sinon dans celui que nomme la connexion. Quand le serveur coupe la connexion pendant un passage, le passage garde ce qu’il a lu et le suivant reprend ; si c’était la seule boîte, l’exécution échoue.

### Trier la boîte de réception Gmail {#gmail-triage-inbox}

Travaille sur la **Réception** que remplit [Synchroniser les e-mails Gmail](#gmail-sync-emails), toutes les six heures dans ton fuseau horaire pour commencer. Chaque exécution lit les conversations Gmail ouvertes dont le message le plus récent vient du client et qu’aucun passage précédent n’a jugées depuis l’arrivée de ce message — jusqu’à **Conversations par exécution** (20 pour commencer, 40 au plus) ; les autres attendent l’exécution suivante. Le modèle décide pour chaque fil si une personne doit répondre, et avec quelle urgence.

Ce qu’une exécution modifie :

- Là où une réponse est due, un second appel au modèle en rédige une et la dépose sur le fil comme **Réponse suggérée** : une carte au-dessus de l’éditeur, à l’écart de ce qu’une personne a tapé. **Mettre dans l’éditeur** confie le texte à l’éditeur pour le retoucher et l’envoyer ; **Ignorer** l’abandonne, et le fil ne reçoit plus de suggestion tant que le client n’écrit pas de nouveau. Un fil qui porte déjà une suggestion la conserve : un fil n’en a jamais deux.
- La **priorité** du fil prend le verdict du modèle, mais seulement si personne n’en a fixé une. Une priorité choisie par une personne reste telle quelle.
- Enfin, le verdict est noté sur chaque fil, avec sa raison, pour que l’exécution suivante ne revienne sur le fil que lorsque le client écrit de nouveau. Un fil où aucune réponse suggérée n’a pu être déposée — il a été fermé entre-temps, ou son brouillon a échoué — n’est pas marqué, et l’exécution suivante le reprend ; les autres fils sont traités quand même. Si aucune réponse suggérée n’a pu être déposée, l’exécution échoue et ne marque rien.

L’automatisation n’envoie rien. La sortie de l’exécution liste ce qui a été lu, le résumé du modèle, les fils qui attendent une réponse avec leurs liens vers la réception, les suggestions déposées et les fils laissés pour l’exécution suivante (`unstamped`). Une exécution sans rien en attente n’appelle aucun modèle.

### Trier la boîte de réception Outlook {#outlook-triage-inbox}

Fonctionne comme [Trier la boîte de réception Gmail](#gmail-triage-inbox) sur les conversations Outlook qu’apporte [Synchroniser les e-mails Outlook](#outlook-sync-emails).

### Trier la boîte de réception IMAP {#imap-smtp-triage-inbox}

Fonctionne comme [Trier la boîte de réception Gmail](#gmail-triage-inbox) sur les conversations qu’apporte [Synchroniser les e-mails via SMTP/IMAP](#imap-smtp-sync-emails).

### Résumer la boîte de réception {#inbox-summary}

Selon son horaire — en semaine à 08:00 dans ton fuseau horaire pour commencer, tant que tu ne le changes pas —, résume en une ligne chacune les conversations de la boîte choisie qui attendent encore une réponse, la plus urgente d’abord, et envoie le résumé au membre choisi avec un lien vers la réception. Une boîte vide n’envoie rien. Il lit la réception que remplit une synchronisation e-mail et ne modifie aucune conversation.

## Issues

Les modèles d’issues lisent la source et écrivent des tâches Tale. Ils ne commentent, ne ferment ni ne modifient jamais l’issue, la pull request ou l’alerte d’origine, et ne démarrent aucun agent.

### Synchroniser les issues GitHub {#github-sync-issues}

Tient les tâches d’un projet alignées sur les issues ouvertes d’un dépôt GitHub, un lot à chaque exécution, toutes les 15 minutes pour commencer. Il a besoin du connector GitHub avec un accès en lecture aux issues du dépôt.

Chaque exécution lit le lot suivant d’issues ouvertes à partir de l’endroit où la précédente s’est arrêtée, les plus anciennes d’abord, jusqu’à **Nouvelles issues par exécution** (100 pour commencer, de 1 à 500), et crée une tâche dans **Backlog** pour chaque issue que le projet n’a pas encore. Un grand dépôt arrive ainsi en plusieurs exécutions ; après la dernière issue, l’exécution suivante recommence à la première, et une issue que le projet a déjà est actualisée, jamais créée deux fois. **Seulement les issues avec ces étiquettes** restreint ce qui est lu : avec plusieurs étiquettes, une issue doit toutes les avoir. Les pull requests sont laissées de côté ; [Synchroniser les pull requests GitHub](#github-sync-pull-requests) les lit.

Chaque exécution relit aussi jusqu’à 50 issues importées plus tôt, les moins récemment vérifiées d’abord, y compris celles qui sont fermées ou ne correspondent plus aux étiquettes, et met à jour la fiche source de la tâche : le titre, la description et si l’issue est ouverte ou fermée. Le titre, la description, le statut, l’assignation et la priorité de la tâche elle-même restent tels quels dans Tale, et une tâche reste où elle est quand son issue est fermée sur GitHub. Une issue que GitHub ne montre plus garde ses dernières informations connues et est marquée comme indisponible. À l’import, Tale coupe sur la tâche un titre de plus de 200 unités de code UTF-16 ou une description de plus de 20 000 (la plupart des emoji comptent pour 2) à cette longueur, en terminant par « … » ; la fiche source et l’issue gardent le texte complet.

La sortie d’une exécution est un reçu pour le dépôt : ce qu’elle a lu, créé, actualisé et ignoré, et si elle a atteint la fin des issues ouvertes. Une issue que GitHub refuse de montrer est ignorée et retentée plus tard. Quand GitHub limite la synchronisation par une limite de requêtes, l’exécution garde ce qu’elle a fait, et les exécutions suivantes laissent GitHub tranquille jusqu’à l’heure qu’il a indiquée. Une exécution n’échoue que si le dépôt n’a pas pu être lu du tout : la planification compte ainsi une synchronisation cassée, pas un GitHub surchargé. Choisis **Identifiants GitHub** quand ton organisation en a plusieurs ; vide, ce sont les identifiants par défaut. Si les étiquettes changent, l’exécution suivante recommence à la première issue qui correspond. Pour synchroniser plusieurs dépôts dans une automatisation, vois [Synchroniser des issues selon une planification](/fr/platform/automations/triggers#synchroniser-des-issues-selon-une-planification).

### Synchroniser les issues GlitchTip {#glitchtip-sync-issues}

Tient les tâches d’un projet alignées sur les issues non résolues d’un projet GlitchTip, un lot à chaque exécution, comme [Synchroniser les issues GitHub](#github-sync-issues) le fait pour un dépôt. Il a besoin du connector GlitchTip avec l’URL de l’instance et un token disposant de `project:read` et `event:read` ; un token qui ne fait que provisionner des projets ne peut pas lire les issues. Une instance auto-hébergée doit être autorisée par la politique d’hôtes des connectors du déploiement.

Chaque exécution lit le lot suivant, les premières vues d’abord, et **Recherche** le restreint dans la syntaxe de recherche de GlitchTip ; vide, elle lit toutes les issues non résolues. Chaque exécution relit aussi jusqu’à 50 issues importées plus tôt et met à jour la fiche source de la tâche : le titre, les détails et si l’issue est non résolue, résolue ou ignorée. Une tâche reste où elle est quand son issue est résolue. **Identifiants GlitchTip** désigne l’instance et le token avec lesquels lire ; vide, ce sont les identifiants par défaut. Si la recherche change, l’exécution suivante recommence à la première issue qui correspond.

### Synchroniser les pull requests GitHub {#github-sync-pull-requests}

Tient les tâches d’un projet alignées sur les pull requests ouvertes d’un dépôt GitHub, un lot à chaque exécution, comme [Synchroniser les issues GitHub](#github-sync-issues) le fait pour ses issues. **Seulement les pull requests ouvertes par** la limite aux pull requests d’un compte : `renovate[bot]` pour les mises à jour de dépendances de Renovate, `dependabot[bot]` pour celles de Dependabot ; vide, elle lit celles de tout le monde. **Seulement les pull requests avec ces étiquettes** restreint encore, et une pull request doit avoir chaque étiquette nommée. **Nouvelles pull requests par exécution** fixe la taille du lot (100 pour commencer, de 1 à 500). Ses tâches et sa position dans le dépôt lui sont propres : elle peut tourner à côté de **Synchroniser les issues GitHub** pour le même dépôt et le même projet sans que l’une touche aux tâches de l’autre. La fiche source d’une tâche indique si la pull request est ouverte ou fermée ; une pull request fusionnée compte comme fermée.

### Synchroniser les alertes de sécurité GitHub {#github-sync-security-alerts}

Tient les tâches d’un projet alignées sur les alertes de sécurité ouvertes d’un dépôt GitHub : une tâche par alerte, toutes les heures pour commencer. Choisis le type d’alerte sous **Alertes** : code scanning, Dependabot ou secret scanning. **À partir de la gravité** ne lit que les alertes de cette gravité ou plus, sur une seule échelle pour les trois types : critique, élevée, moyenne ou toutes les alertes. Une alerte de code scanning qui n’est pas une alerte de sécurité compte son `error` comme élevée, son `warning` comme moyenne et sa `note` comme faible, et un secret compte toujours comme critique. **Seulement ces outils de code scanning** lit les alertes des outils que tu nommes tels que GitHub les montre, par exemple `CodeQL` ou `Trivy` ; vide, il lit celles de tous les outils.

GitHub restreint lui-même chaque liste, si bien qu’un dépôt avec des milliers d’alertes ouvertes d’un même scanner n’est lu que jusqu’où vont les filtres : avec une gravité élevée et les outils dont tu t’occupes, le tableau ne reçoit que les alertes qui valent une tâche. Chaque exécution lit jusqu’à 100 nouvelles alertes et relit jusqu’à 50 alertes importées plus tôt, et la fiche source montre une alerte ouverte, résolue (corrigée, ou un secret révoqué) ou ignorée (rejetée). Une tâche ne montre jamais la valeur d’un secret : la synchronisation demande à GitHub de l’omettre et ne nomme que le type de secret et l’endroit où il a été trouvé. Les identifiants GitHub doivent pouvoir lire les alertes de code scanning, Dependabot ou secret scanning du dépôt, selon ce que tu synchronises. Pour lire plusieurs types dans une automatisation, liste-les dans `alerts` dans l’étape.

### Synchroniser les issues Forgejo {#forgejo-sync-issues}

Tient les tâches d’un projet alignées sur les issues ouvertes, ou les pull requests ouvertes, d’un dépôt d’une instance Forgejo, comme Codeberg ou la tienne, un lot à chaque exécution, comme [Synchroniser les issues GitHub](#github-sync-issues) le fait sur GitHub. Il a besoin du connector Forgejo avec l’URL de l’instance et un token d’accès qui peut lire le dépôt et ses issues ; une instance auto-hébergée doit être autorisée par la politique d’hôtes des connectors du déploiement. **Synchroniser** choisit s’il lit les issues ou les pull requests, **Seulement les éléments ouverts par** les limite à ceux d’une personne, par exemple `renovate`, et **Seulement les éléments avec ces étiquettes** aux éléments qui portent l’une des étiquettes nommées ; Forgejo lit plusieurs étiquettes comme des alternatives, là où GitHub les exige toutes. **Identifiants Forgejo** nomme l’instance et le token avec lesquels lire ; vide, ce sont les identifiants par défaut. Chaque exécution lit jusqu’à 100 nouveaux éléments et relit jusqu’à 50 éléments importés plus tôt.

Chaque tâche renvoie à l’élément sur l’instance que nomment ses identifiants. Le même dépôt sur deux instances donne deux ensembles de tâches, et une tâche n’est relue qu’avec des identifiants pour sa propre instance.

### Trier les issues GitHub {#github-triage-issues}

Chaque matin à 07:00 dans ton fuseau horaire pour commencer, lit les issues ouvertes du dépôt indiqué qui ont changé depuis sa dernière exécution réussie, évalue si chacune est prête à être traitée et son urgence, et envoie au membre choisi un message avec celles qui sont prêtes, les plus urgentes d’abord, chacune avec sa raison et un lien vers les issues du dépôt. Il n’écrit rien sur GitHub et ne crée aucune tâche. Il a besoin du connector GitHub avec un accès en lecture aux issues du dépôt.

Sa première exécution regarde les issues modifiées le plus récemment. Ensuite, chaque exécution reprend là où la dernière exécution pour ce dépôt s’est arrêtée, la plus ancienne modification d’abord, jusqu’à **Issues par exécution** (20 pour commencer, 40 au plus) ; les autres attendent l’exécution suivante. Une issue n’est réévaluée qu’après avoir changé — un nouveau commentaire, une nouvelle étiquette, un texte modifié. Une exécution qui échoue ne retient aucune position, ses issues reviennent donc à l’exécution suivante, et une exécution pour un autre dépôt laisse la position de celui-ci telle quelle. Une issue que le modèle n’a pas pu évaluer est nommée dans le message et réévaluée une fois qu’elle change. Les pull requests sont laissées de côté.

La sortie de l’exécution liste ce qui a été évalué, les issues prêtes avec leur priorité et leur raison, celles qui n’ont pas pu être évaluées, et la position d’où part l’exécution suivante (`position`). Une exécution sans issue prête n’envoie rien. Pour avoir aussi les issues en tâches dans un projet, utilise [Synchroniser les issues GitHub](#github-sync-issues).

## Revue de code

### Examiner les pull requests GitHub {#github-review-pull-requests}

Toutes les 30 minutes pour commencer, parcourt les pull requests ouvertes du dépôt indiqué et examine celles que le compte GitHub connecté n’a pas encore examinées à leur dernier commit. Un modèle de langage lit chaque diff, et ses conclusions sont publiées en commentaire de revue rattaché au commit lu : **Looks ready** ou **Changes suggested**, puis ce qu’il a trouvé. Un nouveau push rend la pull request à nouveau due ; d’ici là, elle n’est pas réexaminée. Il n’approuve jamais, ne demande jamais de modifications et ne fusionne jamais ; cela reste à une personne. Il a besoin du connector GitHub, avec un token qui peut lire les pull requests du dépôt (par l’API GraphQL de GitHub) et les commenter.

| Question | Ce qu’elle décide |
| --- | --- |
| **Compte GitHub** | Le compte connecté qui lit et commente ; ce sont ses propres examens qu’il compte. |
| **Pull requests par exécution** | Combien une exécution en examine, 5 pour commencer, 10 au plus ; les autres attendent la suivante, celle restée inchangée le plus longtemps d’abord. |
| **Taille de diff lue, en caractères** | Où un long diff est coupé, 30 000 pour commencer ; l’examen dit alors ce qu’il n’a pas lu. |

Les brouillons et les pull requests du compte lui-même sont laissés de côté. Une pull request dont GitHub refuse d’afficher le diff, trop grand, reçoit une courte note au lieu d’un examen. Une pull request dont le diff n’a pas pu être lu, ou dont l’examen a échoué, est laissée pour l’exécution suivante, et les autres sont examinées quand même ; si chaque examen d’une exécution échoue, l’exécution échoue. La sortie de l’exécution liste les pull requests examinées, celles laissées pour la suivante, combien attendent encore, et combien ont été sautées comme brouillons, comme les siennes ou comme déjà examinées. Consulte son [journal](/fr/platform/automations/execution-logs) après la première exécution réelle.

## Tâches

### Trier les nouvelles tâches {#triage-new-tasks}

Chaque fois qu’une tâche est créée dans le projet choisi, un modèle de langage lit son titre et sa description et commente une priorité suggérée, sa raison et une première étape concrète, dans la langue de la tâche. Rien d’autre ne change sur la tâche.

### Répondre aux questions avec tes documents {#answer-questions}

Quand une tâche est créée dans le projet choisi et que son titre se termine par un point d’interrogation, il cherche dans les documents de l’organisation et commente une réponse tirée uniquement de ce qu’il a trouvé, en citant ses sources, ou dit clairement que les documents n’y répondent pas. Les autres nouvelles tâches ne sont pas touchées.

## Notifications

Les messages de ces modèles et de [Résumer la boîte de réception](#inbox-summary) arrivent dans les notifications du membre, et par e-mail si ses réglages en envoient un ; [Notifier des membres depuis une automatisation](/fr/platform/automations/notify-members) explique qui est ignoré.

### Récapitulatif quotidien des tâches {#task-digest}

Selon son horaire — chaque jour à 09:00 dans ton fuseau horaire pour commencer, tant que tu ne le changes pas —, liste les tâches créées dans le projet choisi depuis le dernier récapitulatif envoyé et les envoie au membre choisi en un seul message, une ligne chacune, avec un lien vers les tâches du projet. Le premier récapitulatif remonte d’un jour. Chaque récapitulatif commence là où le dernier réussi s’est arrêté : un horaire déplacé à une autre heure, un récapitulatif qui a échoué ou des jours où le serveur était arrêté ne font jamais manquer une tâche ni ne la listent deux fois. Les tâches arrivent les plus anciennes d’abord, 50 au plus : après une période chargée, le récapitulatif se termine par …, et le suivant reprend derrière sa dernière tâche. Un récapitulatif sans nouvelle tâche n’envoie rien.

### Prévenir le relecteur {#notify-reviewer}

Quand une tâche du projet choisi passe à **En revue**, il prévient le membre choisi avec le titre de la tâche et un lien vers elle. Les autres changements de statut n’envoient rien.

## Webhooks

### Créer des tâches par webhook {#webhook-create-task}

Un autre système — un formulaire, une alerte de supervision, une boutique — envoie du JSON à l’adresse webhook qu’affiche l’onglet **Général** de l’automatisation, et une tâche est créée dans le projet choisi : `title` lui donne son nom et `description` son texte. Un envoi sans titre est refusé et ne crée rien.

Chaque tâche est reconnue par son envoi : par la valeur du champ que nomme **Clé de l’envoi** — `id` pour commencer, ou un champ imbriqué comme `alert.id` —, ou, pour un envoi sans ce champ, par tout son contenu. Un envoi dont la clé est déjà venue met à jour le titre de la tâche qu’il a créée au lieu d’en ajouter une deuxième, même des jours plus tard, quand l’adresse webhook ne se souvient plus de l’envoi lui-même ; une description que la tâche a déjà reste. **Nom de l’expéditeur** (`webhook` pour commencer) sépare deux expéditeurs dont les clés pourraient se recouper : donne-leur chacun le sien.
