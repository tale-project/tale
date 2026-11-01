---
title: Agents connectés
description: Connecte un agent de code à Tale depuis l’agent, choisis ce qu’il peut faire, puis consulte et déconnecte les agents connectés à une organisation.
---

Un agent de code comme Claude Code, Codex ou Cursor peut se connecter lui-même au [point d’accès MCP](/fr/develop/mcp-endpoint) de Tale au lieu de détenir une clé API. Tu te connectes, tu choisis une organisation et ce que l’agent peut y faire, puis l’agent travaille en ton nom, jamais au-delà de ton rôle. Cette page explique comment connecter un agent, ce que demande la page de consentement et où tu consultes les connexions et où tu y mets fin. Ton opérateur peut désactiver la connexion des agents ; tant qu’elle est désactivée, les agents utilisent des clés API, et la page **Agents connectés** n’existe que pour les personnes qui ont encore une connexion.

## Connecter un agent

1. Sélectionne **Connecter un agent de code** sur cette page. La boîte de dialogue donne les commandes pour Claude Code et Codex, et l’adresse à ajouter à tout autre agent ; [Utiliser Tale depuis ton éditeur ou un script](/fr/develop/use-tale-from-your-editor#connecter-opencode-ou-claude-code) couvre le reste. **Paramètres > API > MCP** affiche aussi l’adresse, avec un bouton de copie. **Modifier avec ton agent de code** dans l’éditeur, **Corriger avec ton agent de code** sur une exécution en échec et **Créer une automatisation** › **Avec ton agent de code** dans la liste ouvrent le même dialogue, avec un prompt pour cette automatisation, cette exécution ou une nouvelle automatisation.
2. Exécute les commandes de ton agent. Avec Claude Code, la connexion est la dernière commande, `claude mcp login tale` ; Codex se connecte dès `codex mcp add`. L’agent ouvre Tale dans ton navigateur. Si tu es déconnecté, connecte-toi d’abord.
3. Vérifie sur la page de consentement qui fait la demande. **Domaine vérifié** signifie que Tale a lu les informations de l’application sur son propre domaine ; seul le propriétaire de ce domaine peut les publier. **Application non vérifiée** signifie que l’agent s’est enregistré lui-même et a choisi son nom : continue seulement si tu viens de lancer cette connexion depuis ton agent.
4. Choisis l’**Organisation**. L’agent travaille uniquement dans cette organisation ; pour en utiliser une autre, connecte-le à nouveau.
5. Choisis l’**Accès** et, si besoin, ce que tu veux **Autoriser aussi**. La liste « Ce que Claude Code peut faire », avec le nom de ton agent, montre ce que ton choix représente. Ton rôle s’applique toujours : l’agent ne peut jamais faire plus que toi dans cette organisation.
6. Sélectionne **Connecter**. Tale te renvoie vers l’agent, qui se connecte seul et peut se mettre au travail.

<Frame caption="Connecter un agent de code — les commandes de ton agent, s’il s’est déjà connecté et ce que tu peux lui demander en premier.">

![La boîte de dialogue « Connecter un agent de code » montre les onglets Claude Code, Codex et Autre, les deux commandes qui ajoutent Tale et connectent l’agent, une ligne qui attend la connexion de l’agent et un premier prompt à copier.](/images/platform/settings-connect-agent.webp)

</Frame>

<Frame caption="La page de consentement d’une application qui s’est enregistrée elle-même : là où une application vérifiée montre son domaine, celle-ci porte l’avertissement « Application non vérifiée ».">

![La page de consentement d’une application nommée Cursor : un avertissement indiquant que l’application n’est pas vérifiée, l’organisation où elle travaillera, trois niveaux d’accès et deux options supplémentaires à choisir, un résumé de ce qu’elle peut faire, ainsi que les boutons « Connecter » et « Annuler ».](/images/platform/agent-consent.webp)

</Frame>

La demande qui t’amène à la page de consentement expire au bout de cinq minutes. Si elle a expiré, relance la connexion depuis l’agent.

Tant qu’elle est ouverte, la boîte de dialogue guette la connexion. Elle affiche **En attente de la connexion de ton agent…** jusqu’à ce que l’agent se soit connecté, puis **Connecté :** et son nom, avec un premier prompt à donner à l’agent.

### Choisir l’accès

| Choix | Ce que l’agent peut faire |
| --- | --- |
| **Lire et tester** | Lire les automatisations, les exécutions et les connaissances, vérifier des brouillons et les essayer avec des données de test. Rien n’est modifié. |
| **Modifier les automatisations** | Enregistrer aussi de nouvelles versions. La mise en service reste entre tes mains. |
| **Modifier et mettre en service** | Mettre aussi en service, définir des déclencheurs et lancer des exécutions en réel qui agissent sur tes services connectés. |
| **Lire les paramètres** | Lire les paramètres visibles pour ton rôle. Les secrets restent masqués. |
| **Modifier les paramètres** | Modifier les paramètres que ton rôle peut modifier. Chaque modification est inscrite au journal d’audit. |

Les trois premiers sont des niveaux : chacun s’ajoute au précédent. Les deux derniers sont des choix à part. [Niveaux d’accès](/fr/develop/mcp-endpoint#access-levels) liste les outils que chacun ouvre. La page ne propose que ce que l’agent a demandé et que ton rôle permet ; un choix que l’agent n’a pas demandé est indisponible et le dit. Quand un appel a besoin de plus d’accès que la connexion n’en détient, l’agent peut le demander à nouveau et tu autorises davantage sur la même page. Autoriser à nouveau la même application modifie sa connexion au lieu d’en ajouter une seconde.

### Qui peut connecter

| | Propriétaire, Admin ou Développeur | Membre avec une compétence utilisée avec une clé | Tout autre membre |
| --- | --- | --- | --- |
| Connecter un agent à l’organisation | Oui | Oui | Non |
| Autoriser **Modifier les automatisations**, **Modifier et mettre en service** ou **Modifier les paramètres** | Oui | Non | Non |
| Autoriser **Lire et tester** et **Lire les paramètres** | Oui | Oui | Non |

Les compétences concernées sont celles qui permettent de créer une clé API, comme **Appeler les modèles par l'API** ; [Compétences](/fr/platform/admin/governance/competences) les liste. Qui n’a pas le droit de connecter un agent dans une organisation voit pourquoi sur la page de consentement et ne peut pas la choisir.

Tout accès qui va plus loin que **Lire et tester** et **Lire les paramètres** demande une connexion datant de moins de 24 heures. Si la tienne est plus ancienne, la page te demande d’abord ton mot de passe ; si ton compte se connecte via l’authentification de ton entreprise, elle te demande de te reconnecter. Dans les deux cas, ton choix est conservé. Les comptes dont l’adresse e-mail n’est pas confirmée, ou dont l’authentification à double facteur reste à activer, ne peuvent pas encore connecter d’agent.

## Consulter et déconnecter les agents

Ouvre **Paramètres > API > Agents connectés**. La page existe dès que la connexion des agents est activée et que tu as le droit de connecter un agent dans cette organisation, et elle reste pour toute personne qui a encore une connexion active, afin qu’elle puisse y mettre fin. Si Tale ne peut pas le vérifier, la page le signale et propose **Réessayer** au lieu de se fermer. La liste montre chaque agent avec son nom, son origine (le domaine qu’il a prouvé, ou **Non vérifiée**), l’accès que tu lui as donné, le moment où il s’est connecté et celui de son dernier appel, **Jamais** avant le premier. Tale tient lui-même le compte des appels qu’il a traités avec cette connexion, et c’est de là que vient l’heure du dernier appel, jamais de ce que l’agent affirme.

<Frame caption="Paramètres > API > Agents connectés — chaque agent avec son accès, le jour de sa connexion et celui de sa dernière utilisation.">

![La page Agents connectés liste trois agents de code, tous marqués « Non vérifiée », avec l’accès accordé à chacun, le jour de sa connexion et celui de sa dernière utilisation.](/images/platform/settings-connected-agents.webp)

</Frame>

Tu vois les agents que tu as connectés. Les propriétaires et les admins peuvent passer de **Les miens** à **Tous** pour voir qui a connecté chacun, et activer **Afficher les déconnectés** pour lire quand et pourquoi une connexion a pris fin.

Pour déconnecter un agent, ouvre le menu de sa ligne et sélectionne **Déconnecter**. Tale demande d’abord confirmation, avec des mots qui disent à qui appartient l’agent, et l’agent perd l’accès immédiatement : son prochain appel est refusé et il ne peut plus se reconnecter seul. Tu pourras le reconnecter plus tard. La déconnexion ne met fin à la connexion de l’agent que pour cette organisation ; la même application que tu as connectée à une autre organisation reste en place.

## Ce qui met fin à une connexion

| Ce qui se passe | Motif affiché |
| --- | --- |
| Tu la déconnectes | par la personne qui l’a connecté |
| Un propriétaire ou un Admin la déconnecte | par un Admin |
| La personne quitte l’organisation ou en est retirée | fin de l’adhésion |
| La personne change son mot de passe, ou un Admin le définit, retire son passkey ou réinitialise son authentification à double facteur | modification de la sécurité du compte |
| Une ancienne connexion a été réutilisée : un jeton de rafraîchissement présenté deux fois met fin à toutes les connexions de cette application pour cette personne | une ancienne connexion a été réutilisée |
| L’enregistrement de l’application est supprimé | application supprimée |

Un agent resté inutilisé pendant 30 jours ne peut plus renouveler sa connexion et doit être reconnecté. Quand une connexion prend fin d’une façon que tu n’as pas choisie (une ancienne connexion réutilisée, un changement de ton mot de passe ou de ta méthode de connexion, ou une déconnexion par un propriétaire ou un Admin), tu trouves dans tes notifications, dans cette organisation, un avis qui nomme l’agent et le motif. Une déconnexion que tu as faite toi-même n’en laisse aucun. Chaque connexion, chaque changement d’accès et chaque déconnexion laissent aussi une ligne dans le [journal d’audit](/fr/platform/admin/governance/audit-logs), et les appels d’un agent sont marqués comme venant de MCP avec la connexion.

## Si la connexion ne fonctionne pas

| Ce que tu vois | Ce que tu peux faire |
| --- | --- |
| L’agent dit qu’il a besoin d’une authentification | Lance sa commande de connexion, ou ouvre `/mcp` dans Claude Code, et termine les étapes dans le navigateur. |
| La page de consentement dit que connecter un agent de code demande le rôle Propriétaire, Admin ou Développeur, ou une compétence | Demande le rôle ou la compétence à un Admin. |
| La page de consentement dit que ton compte ne peut pas encore connecter d’agents | Confirme ton adresse e-mail ou active l’authentification à double facteur, puis relance depuis l’agent. |
| La page de consentement dit que la demande a expiré | Relance la connexion depuis l’agent. |
| L’agent peut lire mais pas enregistrer ni mettre en service | Il a moins d’accès que l’appel n’en demande. Reconnecte-le et autorise davantage ; **Modifier les automatisations** et **Modifier et mettre en service** ne sont possibles que pour les propriétaires, les admins et les développeurs. |
| Un appel est refusé avec `ORG_MISMATCH` | L’appel nomme une autre organisation que celle à laquelle l’agent a été connecté. Connecte l’agent à chaque organisation où il doit travailler. |
| La page n’est pas dans les paramètres | La connexion des agents est désactivée, ou tu n’as pas le droit de connecter un agent ici et tu n’en as aucune. Demande à un Admin. |

Les opérateurs trouvent ce que le déploiement doit fournir dans [Laisser les agents de code se connecter](/fr/self-hosted/configuration/authentication#coding-agent-sign-in).
