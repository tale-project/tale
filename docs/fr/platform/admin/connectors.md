---
title: Identifiants des connecteurs
description: Connecte les comptes de services, choisis les accès par défaut et renouvelle les autorisations.
---

Ajoute des identifiants de connecteur pour que Tale utilise une messagerie, un espace de fichiers ou un outil de suivi. Les propriétaires, admins et développeurs les gèrent dans **Paramètres > Connectors**. Choisis le service et le compte nécessaires ; le [catalogue des connecteurs](/fr/platform/connectors/overview) présente les actions disponibles.

## Connecter un compte

1. Sélectionne **Ajouter des identifiants**, puis le connecteur. Les connecteurs déjà configurés apparaissent en premier et peuvent recevoir d’autres identifiants.
2. Renseigne un **Nom** reconnaissable pour la personne qui prépare l’automatisation, comme `Boîte support` ou `Boutique UE`.
3. Complète la méthode d’authentification proposée. Pour OAuth, sélectionne **Connecter** et autorise l’accès chez le fournisseur.
4. Termine le formulaire, puis vérifie la ligne créée : connecteur, compte ou instance, et statut.

Le connecteur détermine les champs. Utilise les identifiants du compte externe, pas une clé API Tale.

| Méthode | Informations nécessaires |
| --- | --- |
| Clé API | La clé fournie par le service, par exemple Tavily ou Shopify. |
| Token | Un jeton du service, comme un token d’accès personnel GitHub ou un token de bot Discord. |
| Nom d’utilisateur et mot de passe | La paire attendue par le service : connexion et mot de passe d’application, ou identifiant et token propres au fournisseur. |
| OAuth | Une autorisation dans le navigateur du fournisseur, ensuite conservée par Tale. |

Certains connecteurs demandent aussi l’adresse de l’instance. Pour Confluence, utilise l’adresse de base du site Atlassian. Pour Shopify, utilise l’adresse `myshopify.com` de la boutique, pas son domaine public destiné aux clients.

## Choisir les identifiants par défaut

Le tableau contient une ligne par jeu d’identifiants. Le badge **Par défaut** indique ceux utilisés lorsqu’une action n’en nomme pas. **Définir par défaut**, dans le menu d’une ligne, change ce choix. Chaque connecteur a un seul choix par défaut.

Sans choix par défaut, un connecteur qui possède plusieurs identifiants peut toujours servir les appels qui les nomment explicitement. Les autres appels ont besoin d’un choix par défaut. Nomme les comptes clairement avant de les utiliser dans des automatisations, pour que leur destination reste compréhensible.

La synchronisation des boîtes et le triage peuvent examiner tous les identifiants actifs d’un connecteur de messagerie. Une deuxième boîte n’a pas besoin de devenir le choix par défaut pour être trouvée par ces opérations.

## Renouveler un secret ou suspendre l’accès

Utilise l’action de remplacement adaptée à la méthode, par exemple **Remplacer la clé API** ou **Remplacer le jeton**. Le nouveau secret remplace l’ancien tout en conservant le nom, le choix par défaut et les références. Vérifie ensuite une action appropriée du service.

**Désactiver** suspend les identifiants sans retirer leur configuration ; **Activer** les remet en service. **Modifier les identifiants** permet de changer les autres informations prises en charge, comme le nom ou l’adresse de l’instance.

<Warning>

Supprimer des identifiants retire l’accès aux automatisations et agents qui en dépendent. Migre les appelants et choisis un nouveau défaut si nécessaire. Rouvrir la même ligne ne permet pas d’annuler la suppression.

</Warning>

## Préparer une application OAuth

Les propriétaires et les admins utilisent **Apps OAuth**, en bas de page, pour configurer les applications fournisseur utilisées pendant le consentement. Une application propre à l’organisation remplace celle du déploiement. Si aucune n’existe, le connecteur ne peut pas commencer l’autorisation et la page indique qu’il n’est pas configuré.

Sélectionne **Configurer**, renseigne l’identifiant client et le secret du fournisseur, puis enregistre chez celui-ci les URI de redirection exactes affichées dans le dialogue. Une application Microsoft peut aussi demander l’identifiant du répertoire ou du locataire. Lors d’une modification ultérieure, laisse le champ du secret enregistré vide pour le conserver.

L’application Google Drive sert aussi à l’import dans la base de connaissances. L’entrée OneDrive/SharePoint concerne cet import, sans connecteur distinct. L’opérateur du déploiement configure l’application Slack. Lis le [guide du connecteur](/fr/platform/connectors/overview) concerné avant d’attribuer les permissions fournisseur.

Pour OneDrive/SharePoint, **Utiliser l'app SSO Entra ID** peut copier une inscription SSO existante dans la configuration d’import. Cette copie est ponctuelle : après le renouvellement du secret SSO, refais-la et vérifie l’URI de redirection et les permissions déléguées indiquées dans la confirmation.

## Rétablir une connexion

**Reconnexion requise** signifie que l’autorisation OAuth enregistrée ne peut plus être renouvelée. Sélectionne **Reconnecter** et autorise à nouveau le compte. Le nom et les références restent les mêmes. Des identifiants volontairement désactivés demandent plutôt **Activer**.

Si la connexion ne démarre pas, vérifie l’application OAuth. Si le fournisseur refuse le retour vers Tale, compare son URI de redirection enregistrée à celle que Tale affiche. Si une action échoue après la connexion, vérifie les droits du compte et les permissions requises pour cette action.

Pour les services sans connecteur intégré, consulte [MCP et les intégrations personnalisées](/fr/platform/connectors/mcp-servers). Cette page d’identifiants ne permet pas d’enregistrer n’importe quel serveur MCP sortant.
