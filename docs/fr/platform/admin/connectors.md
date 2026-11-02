---
title: Identifiants des connectors
description: Connecte les comptes de services, choisis les accès par défaut et renouvelle les autorisations.
---

Ajoute des identifiants de connector pour que Tale utilise une messagerie, un espace de fichiers ou un outil de suivi. Les propriétaires, admins et développeurs les gèrent dans **Paramètres > Connectors**. Choisis le service et le compte nécessaires ; le [catalogue des connectors](/fr/platform/connectors/overview) présente les actions disponibles.

## Connecter un compte

1. Sélectionne **Ajouter des identifiants**, puis le connector. Les connectors déjà configurés apparaissent en premier et peuvent recevoir d’autres identifiants.
2. Vérifie le champ **Nom**. Il est prérempli avec le nom du connector, suivi d’un numéro si d’autres identifiants de ce connector portent déjà ce nom : `GitHub`, puis `GitHub 2`. Un nom comme `Boîte support` ou `Boutique UE` est plus facile à reconnaître pour la personne qui prépare l’automatisation. Une connexion OAuth n’a pas de champ de nom : Tale la nomme de la même façon une fois l’accès autorisé (un deuxième espace Slack prend le nom de l’espace), et **Modifier les identifiants** permet de la renommer.
3. Complète la méthode d’authentification proposée. Pour OAuth, sélectionne **Connecter** et autorise l’accès chez le fournisseur. Chaque **Connecter** ajoute de nouveaux identifiants pour le compte autorisé, sans jamais remplacer ceux qui existent. Connecte-toi donc chez le fournisseur avec le compte que tu veux ajouter.
4. Termine le formulaire, puis vérifie la ligne créée : connector, compte ou instance, et statut.

Slack associe un seul jeu d’identifiants à chaque espace Slack. Si tu autorises à nouveau un espace déjà connecté, Tale renouvelle ses identifiants au lieu d’en ajouter d’autres.

Lance chaque connexion avec **Connecter** dans Tale. Tale refuse un lien de connexion ouvert depuis un autre site web. Un lien que quelqu’un t’envoie ne peut donc pas connecter un compte ou une boîte aux lettres en ton nom.

Le connector détermine les champs. Utilise les identifiants du compte externe, pas une clé API Tale.

| Méthode | Informations nécessaires |
| --- | --- |
| Clé API | La clé fournie par le service, par exemple Tavily ou Shopify. Jev decisions demande une clé API OpenRouter. |
| Token | Un jeton du service, comme un token d’accès personnel GitHub, un token d’accès Forgejo avec `read:repository` et `read:issue` (`write:issue` pour modifier des issues), un token de bot Discord ou un token d’API GlitchTip avec `project:read` et `event:read`. Un token GitHub qui synchronise des alertes de sécurité doit aussi pouvoir lire les alertes de code scanning, Dependabot et secret scanning du dépôt. |
| Nom d’utilisateur et mot de passe | La paire attendue par le service : connexion et mot de passe d’application, ou identifiant et token propres au fournisseur. |
| OAuth | Une autorisation dans le navigateur du fournisseur, ensuite conservée par Tale. |
| Connexion de l'app | L’enregistrement d’application propre à ton organisation chez le fournisseur : son ID d’annuaire (tenant), son ID d’application (client) et son secret client. L’application se connecte elle-même, sans personne ; Tale obtient et renouvelle son jeton d’accès. Outlook s’en sert pour accéder à une [boîte aux lettres partagée](#connecter-une-boite-aux-lettres-outlook-partagee). |
| GitHub App | Un nom pour les identifiants et un pour l’application, et, si tu le souhaites, l’organisation GitHub à laquelle elle appartient. Tale enregistre la GitHub App propre à ton organisation et conserve sa clé privée ; ce que Tale crée sur GitHub apparaît ensuite sous le bot de l’application. Voir [Connecter GitHub avec une GitHub App](#connecter-github-avec-une-github-app). |

Certains connectors demandent aussi l’adresse de l’instance. Pour Confluence, utilise l’adresse de base du site Atlassian. Pour Forgejo, utilise l’origine de l’instance sans chemin, par exemple `https://codeberg.org`, et pour GlitchTip l’origine de l’instance, par exemple `https://app.glitchtip.com` ; une instance Forgejo ou GlitchTip auto-hébergée doit aussi être autorisée par la politique des hôtes du connector. Pour Shopify, utilise l’adresse `myshopify.com` de la boutique, pas son domaine public destiné aux clients.

## Choisir les identifiants par défaut

Le tableau contient une ligne par jeu d’identifiants et se met à jour sans rechargement tant qu’il est ouvert : ce qu’un autre admin ajoute, modifie ou supprime y apparaît aussitôt. Le badge **Par défaut** indique ceux utilisés lorsqu’une action n’en nomme pas. **Définir par défaut**, dans le menu d’une ligne, change ce choix. Chaque connector a un seul choix par défaut.

Sans choix par défaut, un connector qui possède plusieurs identifiants peut toujours servir les appels qui les nomment explicitement. Les autres appels ont besoin d’un choix par défaut. Nomme les comptes clairement avant de les utiliser dans des automatisations, pour que leur destination reste compréhensible.

La synchronisation des boîtes et le triage peuvent examiner tous les identifiants actifs d’un connector de messagerie ; une synchronisation réglée sur une seule boîte ne lit que celle-ci. Une deuxième boîte n’a pas besoin de devenir le choix par défaut pour être trouvée par ces opérations. Quand tu rédiges un nouvel e-mail, le champ **Boîte** liste chaque boîte sous son nom, et l’e-mail part de celle que tu choisis. Les réponses dans cette conversation partent de la même boîte, y compris quand tu relances un envoi qui a échoué.

Les e-mails de notification destinés aux membres qui laissent [**M'envoyer les alertes actionnables par e-mail**](/fr/platform/member/preferences#notification-email) activé partent aussi par une boîte connectée. Tale prend d’abord des identifiants actifs de Boîte mail IMAP / SMTP, puis de Gmail, puis de Microsoft Outlook, et, pour un même connector, ceux par défaut. Par IMAP / SMTP, ces e-mails partent de `notification@` sur le domaine de la boîte : une boîte qui se connecte en tant que `support@example.com` les envoie comme `notification@example.com`. Sans identifiants actifs pour une boîte, les membres ne reçoivent leurs notifications que dans Tale. Un envoi qui échoue n’est pas retenté ; la notification reste dans Tale.

## Renouveler un secret ou suspendre l’accès

Utilise l’action de remplacement adaptée à la méthode, par exemple **Remplacer la clé API** ou **Remplacer le jeton**. Le nouveau secret remplace l’ancien tout en conservant le nom, le choix par défaut et les références. Vérifie ensuite une action appropriée du service.

**Désactiver** suspend les identifiants sans retirer leur configuration ; **Activer** les remet en service. **Modifier les identifiants** permet de changer les autres informations prises en charge, comme le nom ou l’adresse de l’instance.

<Warning>

Supprimer des identifiants retire l’accès aux automatisations et agents qui en dépendent. Migre d’abord les appelants. Si tu supprimes les identifiants par défaut d’un connector, ses plus anciens identifiants actifs restants deviennent le choix par défaut, et la confirmation les nomme avant la suppression. Des identifiants désactivés ou à reconnecter ne prennent jamais le relais : s’il ne reste aucun identifiant actif, le connector n’a pas de choix par défaut tant que tu n’en choisis pas. Rouvrir la même ligne ne permet pas d’annuler la suppression.

</Warning>

## Préparer une application OAuth

Les propriétaires et les admins utilisent **Apps OAuth**, en bas de page, pour configurer les applications fournisseur utilisées pendant le consentement. Une application propre à l’organisation remplace celle du déploiement. Si aucune n’existe, le connector ne peut pas commencer l’autorisation et la page indique qu’il n’est pas configuré. Si Tale ne peut pas vérifier si une application d’import de connaissances est configurée, sa ligne affiche **Statut indisponible** sans **Configurer**, et **Réessayer** relance la vérification. Tu pourras configurer l’application dès que la vérification aboutira.

Sélectionne **Configurer**, renseigne l’identifiant client et le secret du fournisseur, puis enregistre chez celui-ci les URI de redirection exactes affichées dans le dialogue. Une application Microsoft peut aussi demander l’identifiant du répertoire ou du locataire. Lors d’une modification ultérieure, laisse le champ du secret enregistré vide pour le conserver.

L’application Google Drive sert aussi à l’import dans la base de connaissances. L’entrée OneDrive/SharePoint concerne cet import, sans connector distinct. L’opérateur du déploiement configure l’application Slack. Lis le [guide du connector](/fr/platform/connectors/overview) concerné avant d’attribuer les permissions fournisseur.

Pour OneDrive/SharePoint, **Utiliser l'app SSO Entra ID** peut copier une inscription SSO existante dans la configuration d’import. Cette copie est ponctuelle : après le renouvellement du secret SSO, refais-la et vérifie l’URI de redirection et les permissions déléguées indiquées dans la confirmation.

## Connecter une boîte aux lettres Outlook partagée

Une boîte aux lettres partagée, comme `promotion@example.com`, n’a pas de connexion propre. Tale y accède de deux façons : l’application Microsoft de ton organisation se connecte elle-même et n’a accès qu’à cette boîte, ou une personne qui dispose déjà d’un accès complet à la boîte connecte son propre compte. Dans les deux cas, le champ **Boîte aux lettres** des identifiants indique l’adresse partagée. Toutes les actions Outlook, la synchronisation de la boîte et la boîte de réception travaillent alors dans cette boîte et utilisent son adresse comme expéditeur. **Boîte aux lettres** n’accepte qu’une adresse e-mail. Tale refuse un identifiant, comme l’ID d’objet de la boîte. Tu indiques la boîte en ajoutant les identifiants, et elle ne peut plus changer ensuite : ce que les identifiants ont lu et envoyé appartient à cette boîte. Pour travailler dans une autre boîte, ajoute d’autres identifiants.

Pour une boîte d’équipe, la connexion de l’app convient mieux : elle ne dépend pas du compte d’une seule personne, et Exchange limite l’application aux boîtes que tu choisis.

1. Dans Microsoft Entra ID, enregistre une application monolocataire dédiée et ajoute-lui un secret client. Note l’**ID de l’annuaire (locataire)** et l’**ID d’application (client)** sur sa page de présentation. Ne lui accorde pas d’autorisations Microsoft Graph de messagerie dans Entra ID : elles s’appliqueraient à toutes les boîtes de ton organisation.
2. Dans Exchange Online PowerShell, en tant qu’administrateur Exchange, limite l’application à la boîte avec RBAC for Applications. Prends les ID dans l’entrée **Applications d’entreprise** de l’application, pas dans **Inscriptions d’applications** :

   ```powershell
   New-ServicePrincipal -AppId <application-id> -ObjectId <enterprise-app-object-id> -DisplayName "Tale promotion mailbox"
   New-ManagementScope -Name "Tale promotion mailbox" -RecipientRestrictionFilter "PrimarySmtpAddress -eq 'promotion@example.com'"
   New-ManagementRoleAssignment -App <application-id> -Role "Application Mail.ReadWrite" -CustomResourceScope "Tale promotion mailbox"
   New-ManagementRoleAssignment -App <application-id> -Role "Application Mail.Send" -CustomResourceScope "Tale promotion mailbox"
   Test-ServicePrincipalAuthorization -Identity <application-id> -Resource promotion@example.com
   ```

   `Application Mail.ReadWrite` permet à Tale de lire la boîte et d’y écrire des brouillons de réponse ; `Application Mail.Send` lui permet d’envoyer. Si des automatisations utilisent le calendrier ou les contacts de la boîte, attribue de la même façon `Application Calendars.ReadWrite` ou `Application Contacts.Read`. Exchange peut mettre jusqu’à deux heures à appliquer une nouvelle attribution.
3. Dans Tale, sélectionne **Ajouter des identifiants**, puis **Microsoft Outlook**. Dans le formulaire, saisis l’ID d’annuaire (tenant), l’ID d’application (client), le secret client et, sous **Boîte aux lettres**, l’adresse partagée, puis ajoute les identifiants. Leur ligne affiche **Connexion de l'app** et l’application utilisée, par son ID d’application et son annuaire ; du secret client, elle n’affiche que les premiers et derniers caractères.
4. Envoie un message de test à l’adresse partagée et vérifie qu’il apparaît dans la boîte de réception. Pour confier ses conversations à l’équipe qui s’en occupe, ajoute pour cette boîte une règle de [routage des conversations](/fr/platform/admin/governance/policies-and-limits#routage-des-conversations).

Quand le secret client expire, remplace-le avec **Remplacer les identifiants de l'app** dans le menu de la ligne. Le formulaire s’ouvre avec l’ID d’annuaire et l’ID d’application déjà remplis : tu ne saisis que le nouveau secret client. Les identifiants gardent leur nom, leur boîte et leurs références.

Si c’est une personne qui gère la boîte, sélectionne **Ajouter des identifiants**, puis **Microsoft Outlook**. Dans l’encadré au-dessus du formulaire, saisis l’adresse partagée sous **Boîte aux lettres**, puis sélectionne **Connecter** et connecte-toi en tant que cette personne. Comme une boîte est indiquée, l’écran de consentement demande aussi l’accès aux boîtes que ce compte peut ouvrir, et les nouveaux identifiants travaillent dans la boîte partagée dès la première synchronisation. La personne a besoin d’un accès complet à la boîte et, pour envoyer, de l’autorisation « Envoyer en tant que ». Laisse **Boîte aux lettres** vide pour connecter la boîte de la personne elle-même.

## Connecter GitHub avec une GitHub App

Avec un token d’accès personnel, tout ce que Tale crée sur GitHub apparaît sous le compte de la personne à qui appartient le token. Une GitHub App donne à Tale sa propre identité : ton organisation enregistre son application depuis Tale et l’installe sur les dépôts où Tale doit travailler. Les actions GitHub de Tale pour les issues, les pull requests, les revues, les commentaires, les fusions et les imports s’authentifient alors avec des jetons d’installation que Tale génère au besoin. Chacun est valable une heure et ne porte que les permissions listées plus bas. Ce que Tale crée apparaît sous le bot de l’application, `<app-slug>[bot]`, avec le nom et le logo de l’application, et non sous le compte d’une personne.

L’application est facultative, et les identifiants à token continuent de fonctionner sans changement. Seuls les propriétaires et les admins l’enregistrent, l’installent ou la modifient.

<Note>

Les exécutions d’agent ne reçoivent pas encore le jeton de l’application. `git` et `gh` dans la sandbox d’une exécution utilisent toujours des identifiants à token : les commits qu’un agent pousse depuis sa sandbox apparaissent donc sous le compte de ce token, et non sous le bot de l’application. L’issue [#5295](https://github.com/tale-project/tale/issues/5295) suit le travail qui donnera aux exécutions un jeton d’installation à chaque tour et l’identité du bot de l’application.

</Note>

### Enregistrer l’application

1. Sélectionne **Ajouter des identifiants**, puis **GitHub**. Au-dessus du formulaire de jeton, un encadré à part enregistre l’application et liste les permissions qu’elle demande à GitHub. Un membre qui n’est ni propriétaire ni admin n’y voit qu’une note l’invitant à s’adresser à un admin.
2. Vérifie **Nom des identifiants** et **Nom de l’app sur GitHub**. Le nom des identifiants est prérempli avec le nom du connector, numéroté comme les autres : `GitHub`, puis `GitHub 2`. Le nom de l’application est prérempli avec Tale suivi du nom de ton organisation. Il compte au plus 34 caractères et doit être unique sur GitHub ; le nom du bot en découle.
3. Sous **Organisation GitHub**, saisis le login de l’organisation GitHub dont Tale doit atteindre les dépôts. Tu dois être propriétaire de cette organisation. Laisse le champ vide pour enregistrer plutôt l’application sur ton compte GitHub personnel. L’application est privée, et GitHub n’installe une application privée que sur le compte qui la possède : enregistre-la donc sur le compte auquel appartiennent les dépôts.
4. Sélectionne **Enregistrer sur GitHub**. GitHub affiche l’application qu’il va créer et les permissions qu’elle demande ; si le nom est déjà pris, tu peux le modifier à cet endroit. Sélectionne **Create GitHub App** : GitHub ouvre alors la page d’installation de l’application, décrite dans la section suivante.

Termine les étapes sur GitHub en moins de 15 minutes. Tale ne finalise un enregistrement qu’une fois, et seulement pour l’admin qui l’a commencé ; passé 15 minutes, recommence l’enregistrement.

L’application n’a pas de webhook et ne demande aucune autorisation OAuth lors de son installation. GitHub crée avec elle une clé privée, que Tale stocke chiffrée et n’affiche jamais : la clé n’apparaît ni dans un journal, ni dans une réponse d’API, ni dans une sandbox d’agent. Tale ne conserve ni le secret client ni le secret de webhook que GitHub délivre aussi.

Il n’existe pas d’application Tale partagée : chaque organisation enregistre la sienne, sur chaque déploiement. GitHub renvoie ton navigateur vers l’adresse publique de Tale : ouvre donc Tale à cette adresse quand tu enregistres et installes l’application. GitHub lui-même n’appelle jamais Tale. Le [guide développeur des connectors](/fr/develop/connectors#enregistrer-une-github-app) indique les adresses vers lesquelles GitHub revient.

### L’installer sur des dépôts choisis

Sur la page d’installation de GitHub, choisis le compte, sélectionne **Only select repositories**, choisis les dépôts où Tale doit travailler, puis sélectionne **Install**. GitHub te ramène dans Tale, où la ligne des identifiants renvoie vers l’application sur GitHub et affiche **Installée sur** suivi du compte. Sélectionne **Afficher les dépôts** dans cette ligne pour ouvrir **Dépôts accessibles à cette app**, qui liste les dépôts et signale les dépôts privés par **Privé**. Comme toute GitHub App, l’application peut aussi lire les dépôts publics.

Tant que l’application n’est pas installée, la ligne porte le badge **Non installée** et affiche **Enregistrée sur GitHub, pas encore installée.**, et les actions GitHub de Tale ne peuvent pas utiliser les identifiants. Si tu as quitté GitHub avant l’installation, ou si tu as mis plus de 15 minutes, sélectionne **Installer sur GitHub** dans le menu de la ligne pour continuer. Si GitHub demande plutôt à un propriétaire de l’organisation d’approuver l’installation, sélectionne de nouveau **Installer sur GitHub** une fois qu’il l’a approuvée. Tale trouve alors l’installation sur GitHub et la reprend sans t’y envoyer. Il fait de même quand quelqu’un, par exemple un propriétaire, a installé l’application directement sur GitHub.

Si l’application est désinstallée sur GitHub, Tale s’en aperçoit la prochaine fois qu’il l’utilise. La ligne porte alors le badge **Plus installée** et affiche **Plus installée sur** suivi du compte, et les actions GitHub de Tale ne peuvent plus utiliser les identifiants tant que tu n’as pas sélectionné **Installer sur GitHub** et réinstallé l’application.

Si tu choisis **All repositories**, l’application atteint chaque dépôt du compte, y compris ceux ajoutés plus tard, et **Dépôts accessibles à cette app** le signale par un avertissement. Pour restreindre l’accès, sélectionne **Ouvrir sur GitHub** dans l’avertissement, puis **Only select repositories**.

Si le connector a déjà des identifiants par défaut, sélectionne **Définir par défaut** dans le menu des identifiants de l’application, pour que les actions qui n’en nomment pas utilisent l’application.

### Téléverser le logo

GitHub ne peut pas reprendre de logo lors de l’enregistrement : une nouvelle application affiche donc un motif généré. Pour que le logo de Tale apparaisse à côté de ce que l’application crée, téléverse-le sur GitHub :

1. Télécharge le logo de Tale depuis ton adresse Tale, à `/assets/pwa-512x512.png`, ou prends `services/platform/public/assets/pwa-512x512.png` dans le code source de Tale.
2. Sur GitHub, sélectionne ta photo de profil, puis **Settings**. Pour une application qui appartient à une organisation, sélectionne plutôt **Your organizations**, puis les **Settings** de l’organisation. Sélectionne ensuite **Developer settings**, **GitHub Apps** et **Edit** à côté de l’application.
3. Sous « Display information », sélectionne **Upload a logo** et choisis le fichier. Recadre-le si besoin, puis sélectionne **Set new avatar**.

GitHub accepte un PNG, un JPG ou un GIF de moins de 1 Mo et recommande 200 × 200 pixels. Le logo de Tale est un PNG de 512 × 512 pixels d’environ 3 Ko.

### Les permissions de l’application

L’application ne demande que des permissions de dépôt, chacune pour ce que font les actions GitHub de Tale :

| Permission | Niveau | À quoi elle sert |
| --- | --- | --- |
| Metadata | Lecture seule | Exigée par GitHub ; lister et lire les dépôts |
| Contents | Lecture et écriture | Fusionner des pull requests, lire des commits, chercher dans le code |
| Issues | Lecture et écriture | Créer, modifier, étiqueter et commenter des issues ; les lire et les importer |
| Pull requests | Lecture et écriture | Créer des pull requests, en faire la revue et les commenter ; les lire avec leurs fichiers et leurs diffs |
| Code scanning alerts (`security_events`) | Lecture seule | Importer les alertes de sécurité |
| Dependabot alerts (`vulnerability_alerts`) | Lecture seule | Importer les alertes de sécurité |
| Secret scanning alerts (`secret_scanning_alerts`) | Lecture seule | Importer les alertes de sécurité |

Elle ne demande aucune permission d’administration ni de workflows, et aucune permission d’organisation ou de compte.

<Warning>

Sans la permission workflows, l’application ne peut pas modifier les fichiers sous `.github/workflows/`, et GitHub refuse de fusionner par l’application une pull request qui en modifie un. L’accorder sur GitHub permettrait à tout ce qui détient un jeton de l’application de modifier ta CI : ne l’ajoute que délibérément.

</Warning>

### Modifier les dépôts

Sélectionne **Modifier les dépôts** dans le menu des identifiants, ou en bas de **Dépôts accessibles à cette app**, pour ouvrir les paramètres d’installation de l’application sur GitHub. Sous « Repository access », ajoute ou retire des dépôts, puis sélectionne **Save**. GitHub te ramène dans Tale, et **Dépôts accessibles à cette app** liste les dépôts que l’application atteint désormais.

Tu peux aussi ouvrir les paramètres d’installation directement sur GitHub. Pour une organisation, ouvre ses **Settings**, sélectionne **GitHub Apps** sous « Third-party Access », puis **Configure** à côté de l’application. Pour ton compte personnel, ouvre **Settings**, puis **Applications**, **Installed GitHub Apps** et **Configure**. Après une modification faite là, GitHub te ramène aussi dans Tale. Si ce navigateur est connecté à Tale en tant que propriétaire ou admin de ton organisation, Tale enregistre un passage entre tous les dépôts et des dépôts choisis, mais pas une modification qui ne change que les dépôts choisis.

### Déconnecter ou revenir à un jeton

Pour déconnecter, sélectionne **Supprimer** dans le menu des identifiants ; le journal d’audit enregistre la suppression. Tale laisse l’application sur GitHub : retire-la donc aussi là-bas. **Uninstall**, dans ses paramètres d’installation, la retire du compte, et **Delete GitHub App**, sous **Advanced** dans les paramètres de l’application, la supprime avec toutes ses installations.

Les identifiants d’une GitHub App n’ont ni action de remplacement ni **Reconnecter**. Pour repartir de zéro, par exemple avec une nouvelle clé privée, supprime les identifiants et l’application, puis enregistres-en une nouvelle.

Pour revenir à un jeton, ajoute des identifiants GitHub avec la méthode **Jeton**, puis sélectionne **Définir par défaut** dans leur menu.

### Ce que le journal d’audit enregistre

Le [journal d’audit](/fr/platform/admin/governance/audit-logs) enregistre qui a connecté, modifié et déconnecté l’application, et quand, avec l’ID de l’application. L’entrée de chaque installation, et de chaque modification que Tale enregistre quand GitHub te ramène dans Tale, indique aussi l’ID de l’installation, le compte et la sélection de dépôts, et liste les dépôts choisis quand l’application n’en atteint que certains. Une modification que Tale ne remarque qu’en générant le jeton suivant, comme un compte renommé ou un passage entre tous les dépôts et des dépôts choisis fait sur GitHub, est enregistrée avec **Système** comme acteur. L’entrée d’une déconnexion indique aussi l’ID de l’installation et la sélection de dépôts. Tale n’a pas de webhook : le journal d’audit peut donc manquer une modification qui ne change que les dépôts choisis, et **Dépôts accessibles à cette app** les liste toujours tels que GitHub les a maintenant. Le journal du serveur consigne chaque jeton que Tale génère, y compris ceux de **Dépôts accessibles à cette app**, avec l’application, l’installation, la sélection de dépôts et l’expiration, mais jamais le jeton lui-même.

## Rétablir une connexion

**Reconnexion requise** signifie que l’autorisation OAuth enregistrée ne peut plus être renouvelée. Sélectionne **Reconnecter** dans le menu de cette ligne et autorise à nouveau le même compte. Tale renouvelle exactement ces identifiants : leur nom, le choix par défaut et les références restent les mêmes, et aucun autre identifiant ne change. **Reconnecter** ne réactive pas des identifiants volontairement désactivés ; **Activer** les remet en service.

Si les identifiants sont supprimés avant la fin de l’autorisation, ou si ton rôle ne te permet plus de gérer les identifiants, Tale n’enregistre rien et en indique la raison. Pour Slack, autorise l’espace que ces identifiants connectent déjà. Tale refuse un autre espace ; connecte-le plutôt avec **Ajouter des identifiants**.

Si la connexion ne démarre pas, vérifie l’application OAuth. Si le fournisseur refuse le retour vers Tale, compare son URI de redirection enregistrée à celle que Tale affiche. Si une action échoue après la connexion, vérifie les droits du compte et les permissions requises pour cette action.

Une connexion de l’app n’a pas de **Reconnecter**. Si le fournisseur refuse l’application, l’action ou la synchronisation de la boîte échoue avec un message indiquant que le point de terminaison des jetons a refusé la connexion de l’app, suivi de la raison du fournisseur, par exemple `invalid_client` pour un secret client erroné ou expiré. Vérifie alors l’ID d’annuaire, l’ID d’application et le secret client, puis remplace-les. Si le point de terminaison des jetons est injoignable ou surchargé, le message l’indique à la place, et la tentative suivante réessaie. Si Microsoft Graph refuse l’accès à une boîte partagée, l’erreur nomme la boîte et le rôle Exchange dont l’action a besoin, par exemple `Application Mail.Send` pour l’envoi.

Si la page indique **Impossible de charger les connectors.**, ou si le tableau des identifiants affiche une erreur à la place de ses lignes, Tale n’a pas pu les lire ; rien n’a été supprimé. Sélectionne **Réessayer**. Tant que les connectors ne peuvent pas être lus, **Ajouter des identifiants** affiche le même message au lieu du catalogue.

Pour les services sans connector intégré, consulte [MCP et les intégrations personnalisées](/fr/platform/connectors/mcp-servers). Cette page d’identifiants ne permet pas d’enregistrer n’importe quel serveur MCP sortant.
