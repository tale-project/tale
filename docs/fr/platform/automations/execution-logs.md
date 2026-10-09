---
title: Examiner les exécutions et corriger les échecs
description: Comprends pourquoi une exécution a échoué ou une étape a été ignorée, ce que chaque étape a lu et renvoyé, rejoue l’exécution et relance-la, à partir d’une étape ou à côté d’une autre exécution.
---

Ouvre une automatisation, passe à son onglet **Exécutions** et choisis une ligne pour comprendre ce qui s’est passé. Commence par le statut, la version et le mode, puis examine le nœud concerné. Un essai réussi prouve le déroulement simulé, pas l’acceptation de la même action par un compte externe réel.

<Frame caption="Une exécution de test terminée : son statut, son mode, sa version, son initiateur et ses horaires au-dessus du workflow, avec le résultat de chaque nœud.">

![La page d’une exécution de test de Triage GitHub issues, marquée Succeeded, Test et v1 et lancée par toi, avec ses heures de début et de fin au-dessus du graphe du workflow, où les nœuds issues, open issues, score et report affichent chacun Succeeded ; la liste des effets de l’exécution commence sous le graphe.](/images/platform/automation-run-detail.webp)

</Frame>

## Lire l’état de l’exécution

L’onglet **Exécutions** présente les exécutions que tu peux voir, de la plus récente à la plus ancienne, et charge les plus anciennes au défilement ; **Filtre** les restreint par statut et par mode. Les propriétaires, les admins et les développeurs voient les exécutions de l’organisation elle-même ; une exécution dans un projet, et la question qu’elle attend, n’apparaissent qu’à ceux d’entre eux qui peuvent ouvrir ce projet. Chaque ligne précise version, date, mode et déclencheur, ou donne la cause d’un échec ou d’une attente. Le détail affiche le workflow, les résultats des nœuds et les horaires. Une exécution inachevée n’a pas de date de fin. Les onglets restent visibles pendant la consultation. Choisis **Exécutions** pour revenir à la liste, ou **Éditeur** pour modifier le workflow.

| Statut | Signification | Suite à donner |
| --- | --- | --- |
| **En file d’attente** | Acceptée, en attente d’exécution. | Attendre, puis examiner la capacité si rien ne progresse. |
| **En cours** | Le moteur traite le workflow. | Suivre les nœuds. |
| **Interrompue — reprise en cours** | Le serveur qui l’exécutait s’est arrêté ; un autre la reprend en une minute et demie environ. | Attendre : rien à faire. |
| **En attente** | Une décision, une réponse, un agent ou une condition reste attendu. | Lire ce qui manque. |
| **Suspendue** | Le résultat du travail commencé avant la mise à jour est inconnu. | Consulte les détails de la suspension ; ne suppose pas qu’une relance est sans risque. |
| **Réussie** | Les nœuds atteints ont terminé et la sortie est produite. | Examiner sortie et effets. |
| **En échec** | L’exécution s’est terminée sur un échec non traité. | Ouvrir le nœud concerné et lire l’erreur. |
| **Arrêtée** | L’exécution a été annulée. | Vérifier le travail déjà fait avant de relancer. |

Une approbation, une question ou une étape peut-être déjà exécutée attend une personne ; un agent au travail ou une interrogation répétée peut poursuivre seul. Une décision ou une réponse peut aussi être refusée ou expirer. Utilise la cause affichée, pas le seul statut **En attente**, pour décider d’intervenir. [Approbations dans les workflows](/fr/platform/automations/approvals-in-workflows) explique les commandes de décision.

## Une exécution suspendue après une mise à jour

**Suspendue** signifie que Tale ne peut pas vérifier le résultat du travail commencé avant la mise à jour. L’exécution ne reprend pas et n’est pas relancée automatiquement ; sa tâche reste réservée. Les points de contrôle et les effets enregistrés restent consultables. L’absence d’effets ne prouve pas qu’un service externe n’a rien reçu.

Laisse l’exécution suspendue pendant tes vérifications. **Demander l’arrêt** demande à Tale d’arrêter les sessions qu’il peut identifier et explique l’incertitude avant ta confirmation. **Arrêt demandé** ne confirme pas l’arrêt du travail : la suspension reste en place jusqu’à confirmation de l’arrêt du travail précédent. La demande n’annule aucune action externe antérieure. Si la suspension change pendant que la fenêtre de confirmation est ouverte, ferme-la et consulte les détails actualisés.

## Comprendre pourquoi une exécution a échoué {#failures}

Une exécution en échec s’ouvre sur une carte qui dit où et pourquoi elle a échoué : **L’exécution a échoué à l’étape Greet**, un titre court pour le problème, par exemple **Une valeur lue est absente**, ce que cela signifie, la cause concrète et **Pour corriger :**. Pour une valeur absente, la cause nomme l’expression, le champ lu et l’étape dont la sortie ne contenait rien ; la correction propose une lecture qui ne peut pas échouer, par exemple `nodes.fetch_customer.output.customer?.email`. Le message du moteur reste sous **Détails techniques**.

Sous la carte, l’étape et son champ, par exemple **Greet › input.email**, côtoient **Afficher dans l’éditeur**, qui ouvre l’éditeur sur la version exécutée avec cette étape sélectionnée. **Afficher l’étape** la sélectionne sur le canevas de l’exécution, et **Relancer à partir de cette étape** prépare la relance décrite dans [Relancer à partir d’une étape](#retry-from-step).

Sur le canevas, le nœud en échec est encadré de rouge et sa ligne du bas reprend le titre de l’échec ; les nœuds par lesquels l’exécution est passée pour l’atteindre ressortent, tandis que les autres passent au second plan ; et Fin indique où l’exécution a échoué, par exemple **Échec à Propose**. La liste **Exécutions** nomme la cause d’une exécution en échec avec le même titre.

Une application qui lit l’[API des exécutions](/fr/develop/api-reference) reçoit aussi `failureCode` lorsqu’une cause a été attribuée à l’échec. Par exemple, `approval_rejected` indique qu’une personne a refusé l’opération, tandis que `llm_output_invalid` signale une réponse du modèle qui ne respecte pas la structure attendue. Les anciens échecs peuvent ne pas avoir de code. Celui-ci aide à orienter le diagnostic ; il ne garantit ni qu’une relance est sans risque, ni qu’elle réussira.

## Savoir pourquoi une étape s’est exécutée ou a été ignorée {#conditions}

Sélectionne un nœud sur le canevas de l’exécution pour ouvrir son onglet **Dernière exécution**. Une étape exécutée ou ignorée à cause d’une condition le dit en une phrase, par exemple **L’étape Big order a été ignorée, car sa condition n’était pas remplie**. En dessous, **Seulement si** montre la condition en mots, avec la valeur lue par chaque référence et son résultat, par exemple « amount de l’entrée (250) n’est pas supérieur à 1 000 » et **Non**. Une condition reliée par `&&` ou `||` affiche chaque partie avec **Oui** ou **Non** ; une partie que l’exécution n’a pas eu à vérifier indique **Non vérifié**. Une condition écrite en code affiche son code.

Une condition non remplie, une alternative exécutée, une étape lue qui a été ignorée ou une règle de poursuite après erreur peut expliquer un nœud ignoré ; la phrase nomme la raison et l’étape concernée. Ce n’est pas toujours un problème.

Sur le canevas, la ligne du bas de chaque nœud indique comment il s’est terminé : **Réussi**, **Échoué**, **Ignoré**, **Non exécuté**, **Pas encore atteint**, **Réutilisé** pour une étape qu’une relance a reprise d’une exécution précédente ou, pour une exécution arrêtée, **Arrêté ici** pour le nœud sur lequel elle se trouvait au moment de l’arrêt. Chaque condition montre comment elle a décidé, **Oui** ou **Non**.

## Voir ce qu’une étape a lu, reçu et renvoyé {#step-data}

**Ce qui a été lu** liste chaque valeur que l’étape a prise dans l’entrée ou dans d’autres étapes, en mots et avec la valeur lue, par exemple « items de Inbox : 3 éléments ». **Reçu** montre l’entrée de l’étape après évaluation de ses expressions, et **Renvoyé** ce qu’elle a produit. Ensemble, ils distinguent une mauvaise référence d’une défaillance du service. Une valeur qui contenait un secret est masquée et le signale, et une valeur trop volumineuse indique qu’une partie seulement a été conservée.

Une valeur se lit comme un arbre que tu ouvres avec les flèches. **Valeurs** et **Structure** passent des valeurs aux champs et à leurs types, et les boutons copient une valeur, en téléchargent une volumineuse ou l’ouvrent en plein écran. Quand l’entrée et la sortie d’une étape sont toutes deux des objets ou toutes deux des listes, **Ce qu’elle a changé** liste les champs que l’étape a ajoutés, retirés et modifiés.

Une étape exécutée une fois par élément liste ses éléments, chacun avec son issue et, en cas d’échec, sa raison. **Seulement en échec** restreint la liste, et sélectionner un élément montre ce qu’il a lu, reçu et renvoyé. Tale conserve les 200 premiers éléments et chaque élément en échec. Une étape qui a demandé plus d’une tentative, ou dont une tentative a été interrompue par un redémarrage, liste ses **Tentatives**. Une étape qui a appelé un service indique si l’appel est terminé, en échec ou a peut-être déjà été exécuté, et ce qu’une personne a choisi à son sujet.

Par exemple, un rappel peut recevoir le nom du client mais un identifiant de facture vide. Examine ce qu’il a lu dans l’étape précédente. Si le champ a été renommé, corrige la référence plutôt que les identifiants de messagerie. Vérifie ensuite l’entrée corrigée dans un nouvel essai.

## Rejouer l’exécution {#play}

La barre sous le canevas rejoue l’exécution : chaque étape s’allume pendant qu’elle travaille, les valeurs circulent le long des liaisons vers les étapes qui les lisent, et chaque condition montre sa décision. Elle s’ouvre sur la fin de l’exécution, pour que tu voies d’abord l’ensemble. **Lire** repart du début, **Événement précédent** et **Événement suivant** avancent pas à pas, et le curseur mène à n’importe quel moment ; l’horloge indique depuis combien de temps l’exécution tournait réellement, et la vitesse change le rythme de lecture. Les longues attentes sont raccourcies pour ne pas bloquer la lecture. Tant qu’une exécution est en cours, la barre la suit ; si tu reviens en arrière, **Suivre en direct** ramène à sa fin.

**Étapes**, à côté de **Graphique**, présente la même exécution comme ses étapes dans l’ordre du temps : combien de temps chacune a travaillé, une barre pour le moment où elle a travaillé, chaque condition avec sa décision, ainsi que les attentes et les redémarrages. La vue suit la même horloge. Choisir une étape l’ouvre et place l’horloge à son début, et **Graphique** montre le canevas à ce moment.

## Relancer l’exécution {#run-again}

**Relancer** démarre une nouvelle exécution de la même version, avec la même entrée et le même mode. Un essai démarre aussitôt ; une exécution réelle qui a écrit demande d’abord confirmation et nomme les services auxquels elle enverrait à nouveau. Le menu à côté propose :

- **Modifier l’entrée et exécuter…** ouvre la boîte d’exécution avec l’entrée de cette exécution à modifier ; confirmer une entrée inchangée relance simplement l’exécution.
- **Relancer sur la v6 en essai** lorsqu’une version plus récente existe, et **Relancer en essai** pour une exécution réelle.
- **Exécuter en réel sur la v5** lorsqu’une autre version est en service et que ton rôle peut lancer des exécutions réelles.
- **Comparer avec l’exécution précédente**, **Copier l’ID de l’exécution** et **Copier le lien**.

Lorsqu’une exécution réelle ne peut pas être relancée en réel, parce que sa version n’est plus en service ou que ton rôle ne le permet pas, **Relancer** en donne la raison.

L’en-tête de la nouvelle exécution indique d’où elle vient, par exemple **Relance de l’exécution 1db433 · entrée modifiée**, avec **Ouvrir l’exécution 1db433** et **Comparer avec elle**. Une relance est une nouvelle exécution : elle renvoie ses écritures et consomme ce que consomme une exécution.

## Relancer à partir d’une étape {#retry-from-step}

**Relancer à partir de cette étape** montre ce que fera la relance avant qu’elle démarre. **Réutilisées** liste les étapes dont la nouvelle exécution reprend les résultats, et **Exécutées à nouveau** l’étape choisie et chaque étape suivante qui en dépend. Si ces étapes écrivent vers un service et que la relance est réelle, la boîte prévient que ces écritures repartent. La relance d’un essai reste un essai, car les résultats qu’elle réutiliserait étaient inventés.

Tale refuse une relance qu’il ne peut pas exécuter fidèlement et dit pourquoi : la version à exécuter a modifié une étape réutilisée, l’exécution n’est pas terminée, ou elle n’a conservé aucune entrée. Sur le canevas de la nouvelle exécution, les étapes reprises sont marquées **Réutilisé**.

## Comparer deux exécutions {#compare}

**Comparer avec elle** sur une relance, **Comparer avec l’exécution précédente** dans le menu de **Relancer**, ou deux exécutions sélectionnées dans l’onglet **Exécutions** puis **Comparer** affichent deux exécutions côte à côte. **Ce qui diffère** nomme, le plus parlant d’abord, les versions exécutées, le nombre de champs d’entrée qui diffèrent, l’étape où elles divergent et pourquoi, par exemple une condition qui n’a pas donné le même résultat, comment chacune s’est terminée, ainsi que leur sortie et leurs écritures. Le tableau liste chaque étape, comment chaque exécution l’a laissée et si ses données sont identiques. **Échanger A et B** inverse les deux exécutions. Quand leur entrée ou leur sortie diffère, **Entrée : A → B** et **Sortie : A → B** les montrent côte à côte, chaque champ modifié marqué. **Les deux exécutions sur le graphique** les dessine sur le graphique de la version de B : chaque étape dit comment A et B l’ont laissée, l’étape où elles divergent est entourée, et une étape absente de la version de A est en pointillés.

## Vérifier les changements déjà effectués

La liste des effets enregistre les écritures des connectors avec leur nœud, leur connector et leurs données. Les essais utilisent des réponses simulées ; les actions réelles peuvent modifier des systèmes externes. L’exécution indique explicitement l’absence d’effets enregistrés.

Lis cette liste avant de recommencer. Un échec ultérieur n’annule ni un message déjà envoyé ni une mise à jour déjà effectuée. Si la livraison compte, vérifie aussi le service destinataire. Les effets restent liés à l’exécution jusqu’à son retrait par suppression ou conservation ; ils ne constituent pas une archive permanente distincte. Supprimer l’automatisation conserve ses exécutions : la page d’une exécution s’ouvre toujours, marquée de la date de suppression et dessinée à partir de sa propre trace, jusqu’à ce que la conservation la retire.

## Comprendre les reprises et nouvelles tentatives

Le moteur enregistre les nœuds terminés comme points de reprise et continue après eux. Une nouvelle exécution distincte, par exemple lancée avec **Relancer**, possède ses propres points de reprise et peut répéter des écritures. Relancer n’est donc pas reprendre l’exécution existante ; une [relance à partir d’une étape](#retry-from-step) ne reprend que les résultats des étapes qui la précèdent.

Une exécution peut changer de serveur en cours de route. Un serveur mis à jour ou redémarré transmet ses exécutions à leur prochaine étape : l’étape en cours se termine, puis le serveur suivant continue avec l’étape d’après, ou avec l’élément suivant quand l’étape s’exécute une fois par élément. Une étape qui travaille encore 20 secondes après le début du redémarrage est interrompue et s’exécute à nouveau sur le serveur suivant. Quand un serveur s’arrête sans prévenir, un autre reprend ses exécutions en une minute et demie environ. Les étapes terminées ne s’exécutent pas une seconde fois. L’en-tête de l’exécution indique alors **Reprise après un redémarrage**, ou le nombre de redémarrages, avec l’heure du dernier changement et sa raison : le serveur était mis à jour ou redémarré, ou il ne répondait plus. Tant qu’aucun autre serveur n’a repris l’exécution, son statut indique **Interrompue — reprise en cours**.

Une étape qui envoyait quelque chose à un service externe au moment où son serveur s’est arrêté fait exception : Tale ne peut pas savoir si le service l’a reçu, et ne le renvoie donc pas de lui-même. L’exécution attend, et sa page indique l’étape, le connecteur, ce que l’étape envoyait et, si l’étape s’exécute pour chaque élément, l’élément concerné. Vérifie dans le service, puis choisis comment continuer :

- **Relancer l’étape** envoie une nouvelle fois. Si le service l’avait déjà reçu, l’action a lieu deux fois ; Tale te demande donc de confirmer.
- **Ignorer l’étape** poursuit l’exécution comme si l’étape n’avait rien renvoyé. Choisis-la quand le service a bien reçu l’envoi.
- **Faire échouer l’exécution** l’arrête à cet endroit et l’enregistre en échec avec le code `effect_in_doubt`. Ce que l’exécution a déjà fait n’est pas annulé ; Tale te demande donc de confirmer.

Toute personne qui peut arrêter l’exécution peut faire ce choix. L’exécution attend qu’une personne décide ; aucune notification n’est envoyée, et la liste des exécutions indique l’étape attendue.

Un échec d’agent admissible permet jusqu’à trois nouvelles tentatives automatiques après la première. Les points de reprise précédents restent acquis et l’en-tête affiche le compteur. Une tentative qui travaille au moins quinze minutes renouvelle ce budget de tentatives. Un pool d’abonnements peut choisir un autre compte pour la suivante. Si un courtier d’abonnement a actualisé le compte pendant que l’étape travaillait et que le fournisseur refuse l’ancien jeton, la nouvelle tentative reprend avec un nouveau jeton sans consommer l’une des trois tentatives ; une troisième interruption de ce type d’affilée compte comme n’importe quel autre échec. Si l’étape n’a pas pu démarrer parce que tous les comptes du pool étaient en pause après avoir atteint une limite de requêtes, la nouvelle tentative démarre dès que le premier compte redevient disponible, au plus tard une minute après, et poursuit la conversation que la tentative refusée devait reprendre. Cette attente consomme l’une des trois tentatives, sauf si la tentative refusée relançait elle-même un échec dû à une limite de requêtes. Si la tentative échouée avait annoncé sa conversation, la nouvelle tentative reprend cette conversation sur l’espace de travail conservé : l’agent continue là où la coupure l’a surpris au lieu de raisonner depuis le début ; une tentative morte avant de l’annoncer, ou dont la session sandbox a disparu, repart de zéro. Une étape Gemini CLI repart toujours de zéro, parce que cet environnement ne peut pas reprendre une conversation dans laquelle il a appelé un outil ; [Choisir un environnement d’agent](/fr/platform/agents/harnesses) explique cette exception.

Une étape d’agent échoue aussi quand son modèle ne renvoie rien du tout : ni texte, ni appel d’outil, ni token généré. Un serveur de modèle peut répondre ainsi s’il tombe en panne en pleine réponse. L’exécution indique alors, en anglais, « The model returned an empty answer, so the agent did nothing this turn. » Cet échec bénéficie lui aussi de ces nouvelles tentatives. Si le modèle a seulement utilisé des outils, ou signalé des tokens générés sans texte visible, par exemple pour son raisonnement, il a bien répondu et l’étape n’échoue pas pour cette raison.

L’épuisement de la fenêtre totale d’exécution, l’expiration d’une question ou un refus lié au budget ne bénéficie pas de ces reprises. Chaque tentative consomme ses propres ressources ; les coûts antérieurs ne disparaissent pas. Si recommencer ne peut pas résoudre la cause, arrête l’exécution et corrige la dépendance avant de relancer.

## Arrêter ou corriger le workflow

Choisis **Arrêter l’exécution** pour annuler une exécution inachevée, puis confirme. Le moteur empêche la poursuite aux limites de ses étapes ; il n’annule pas les effets déjà produits. Si l’exécution se termine avant de recevoir l’annulation, elle conserve son résultat final.

Pour corriger le document, utilise **Afficher dans l’éditeur** sur la carte d’échec ou reviens à l’éditeur, modifie l’entrée ou le nœud concerné et enregistre une version avec un message utile. Fais un essai avec des données représentatives et lis les valeurs et la sortie, au-delà du statut de réussite. Mets la version vérifiée en service. Les prochains démarrages planifiés ou par webhook l’utiliseront ; l’ancien échec reste le journal de l’ancienne version.

Si aucune exécution n’a démarré, examine le [déclencheur](/fr/platform/automations/triggers). Sa désactivation, une mise en service manquante ou des données refusées peuvent expliquer l’absence totale d’exécution.
