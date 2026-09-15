---
title: Sécurité et conformité
description: Trouver les certifications, comprendre les responsabilités et réunir les preuves pour une revue de sécurité.
---

Tale dispose des certifications ISO/IEC 27001 et SOC 2 Type II. Pour une revue de sécurité, demande à ton contact Tale les certificats applicables, le périmètre des rapports et les pièces justificatives. Utilise les documents correspondant au service souscrit par ton organisation.

Les contrôles du produit accompagnent les procédures de ton organisation. Le respect de tes obligations dépend aussi de la configuration, des fournisseurs connectés et des pratiques d’exploitation.

## Préparer une revue

Rassemble le contrat de service, l’accord de traitement des données, les preuves de certification et une description du déploiement. La [politique de confidentialité](/fr/legal/privacy) et les informations sur les [sous-traitants](/fr/legal/subprocessors) complètent cet ensemble. Note la version et le périmètre de chaque document.

Précise l’organisation et le déploiement concernés. Une déclaration de certification ne remplace pas la vérification qu’un service ou une configuration entre dans le périmètre du rapport.

## Répartir les responsabilités

| Domaine | Tale sur le Cloud | Ton organisation |
| --- | --- | --- |
| Hébergement et maintenance | Exploite le service convenu | Choisit le service et coordonne les changements |
| Identité et accès | Fournit les comptes, rôles et contrôles SSO | Ajoute les membres et réexamine leurs droits |
| Fournisseurs et connecteurs | Fournit les contrôles d’intégration | Choisit les services, identifiants et usages autorisés |
| Politiques d’utilisation et de contenu | Fournit les règles et les enregistrements | Configure les règles et traite les événements |
| Demandes de données et conservation | Fournit les procédures prises en charge | Fixe les exigences et autorise les actions |

En auto-hébergement, ton opérateur assume aussi les responsabilités d’infrastructure. L’assistance Enterprise dépend de ton contrat.

## Examiner les contrôles du produit

- [Membres et rôles](/fr/platform/admin/members-and-roles) définissent les accès. Vérifie les comptes inactifs et les droits élevés.
- Le [SSO Enterprise](/fr/platform/admin/enterprise-sso) connecte ton fournisseur d’identité. Teste la connexion et la récupération avant de le rendre obligatoire.
- Les [journaux d’audit](/fr/platform/admin/governance/audit-logs) aident à analyser les actions enregistrées. Consulte [l’intégrité des journaux](/fr/self-hosted/operate/security/audit-log-integrity) pour comprendre les preuves de modification et leurs limites.
- Les [garde-fous](/fr/platform/admin/governance/guardrails), la [conservation légale](/fr/platform/admin/governance/legal-hold) et les [demandes des personnes concernées](/fr/platform/admin/governance/data-subject-requests) couvrent des procédures précises. Vérifie leur portée avant de t’y fier.

## Signaler un incident

Utilise ton canal d’assistance Enterprise pour un incident de service. Signale une vulnérabilité présumée avec [le signalement privé GitHub](https://github.com/tale-project/tale/security) ou à `security@tale.dev`. Indique la version et les étapes de reproduction sans publier d’identifiants ni de données personnelles dans une issue.

Pour examiner les flux de données, poursuis avec [la résidence des données Cloud](/fr/cloud/data-residency).
