/**
 * What a refused connector credential or OAuth app call says to the admin,
 * in the admin's language.
 *
 * The connector credential door words each refusal in English for API
 * clients, and puts what that sentence names beside its code (#5222): the
 * connector, a setting or a secret field by its key, a sign-in method, a
 * limit, and the `reason` that tells apart the refusals one code covers.
 * This surface words each from the catalog instead: the connector as its
 * card names it, a setting by its declared label in the reader's language,
 * a secret field and a sign-in method by the dialog's own labels. What it
 * cannot word (a code it does not know, or a refusal without what its
 * sentence needs) reads through `credentialFailureDetail`, the rule both
 * credential surfaces share.
 *
 * Codes are duck-typed off `AppError.data`, never `instanceof`: Vite chunk
 * splitting can produce several `AppError` class copies.
 */

import { localizeDeclared } from '@/app/features/automations/components/settings-field-control';
import { credentialFailureDetail } from '@/app/features/settings/credentials/map-credential-error';
import { i18n } from '@/lib/i18n/i18n';
import {
  backendErrorCode,
  backendErrorField,
  backendErrorNumber,
  backendErrorStrings,
} from '@/lib/utils/backend-error';

import { optionText, type ConnectorVendorLike } from './config-fields';
import { authMethodLabel } from './labels';

type DeclaredField = ConnectorVendorLike['summary']['configFields'][number];

const settingsText = (key: string, options?: Record<string, unknown>) =>
  i18n.t(key, { ns: 'settings', ...options });

/** A sign-in method under the label the dialog shows for it. */
function methodLabel(method: string): string {
  return authMethodLabel(settingsText, method);
}

/** Alternatives as the reader's language lists them ("A, B or C"). */
function oneOf(items: readonly string[]): string {
  return new Intl.ListFormat(i18n.language, { type: 'disjunction' }).format(
    items,
  );
}

/** The connector under the name its card shows, else its slug. */
function connectorName(
  vendor: ConnectorVendorLike | undefined,
  slug: string | undefined,
): string | undefined {
  if (
    vendor !== undefined &&
    (slug === undefined || vendor.summary.slug === slug)
  )
    return vendor.summary.displayName;
  return slug;
}

/** A secret field under the label its input carries, or undefined for one
 * no form shows (a token an OAuth grant stored). */
function secretLabel(
  field: string | undefined,
  authMethod: string | undefined,
): string | undefined {
  switch (field) {
    case 'token':
      return authMethod === 'api-key'
        ? i18n.t('connectors.dialog.apiKey', { ns: 'settings' })
        : i18n.t('connectors.dialog.token', { ns: 'settings' });
    case 'username':
      return i18n.t('connectors.dialog.username', { ns: 'settings' });
    case 'password':
      return i18n.t('connectors.dialog.password', { ns: 'settings' });
    case 'smtpUsername':
      return i18n.t('connectors.dialog.smtpUsername', { ns: 'settings' });
    case 'smtpPassword':
      return i18n.t('connectors.dialog.smtpPassword', { ns: 'settings' });
    case 'tenantId':
      return i18n.t('connectors.dialog.tenantId', { ns: 'settings' });
    case 'clientId':
      return i18n.t('connectors.dialog.clientId', { ns: 'settings' });
    case 'clientSecret':
      return i18n.t('connectors.dialog.clientSecret', { ns: 'settings' });
    default:
      return undefined;
  }
}

function endpointRefusal(
  err: unknown,
  connector: string | undefined,
): string | undefined {
  switch (backendErrorField(err, 'reason')) {
    case 'fixed':
      return connector === undefined
        ? undefined
        : i18n.t('connectors.errors.endpointFixed', {
            ns: 'settings',
            connector,
          });
    case 'notUrl':
      return i18n.t('connectors.errors.endpointNotUrl', { ns: 'settings' });
    case 'notHttps':
      return i18n.t('connectors.errors.endpointNotHttps', { ns: 'settings' });
    case 'credentials':
      return i18n.t('connectors.errors.endpointCredentials', {
        ns: 'settings',
      });
    case 'notOrigin': {
      const origin = backendErrorField(err, 'origin');
      return origin === undefined
        ? undefined
        : i18n.t('connectors.errors.endpointNotOrigin', {
            ns: 'settings',
            origin,
          });
    }
    default:
      return undefined;
  }
}

function settingRefusal(
  err: unknown,
  connector: string | undefined,
  vendor: ConnectorVendorLike | undefined,
): string | undefined {
  const reason = backendErrorField(err, 'reason');
  if (reason === 'none') {
    return connector === undefined
      ? undefined
      : i18n.t('connectors.errors.configNone', { ns: 'settings', connector });
  }
  const key = backendErrorField(err, 'field');
  if (key === undefined) return undefined;
  const declared: DeclaredField | undefined = vendor?.summary.configFields.find(
    (field) => field.key === key,
  );
  const field =
    declared === undefined
      ? key
      : localizeDeclared(declared, i18n.language).label;
  switch (reason) {
    // A key the connector does not declare has no label but its own.
    case 'unknown':
      return connector === undefined
        ? undefined
        : i18n.t('connectors.errors.configUnknown', {
            ns: 'settings',
            connector,
            field: key,
          });
    case 'number': {
      const min = backendErrorNumber(err, 'min');
      const max = backendErrorNumber(err, 'max');
      // Strings, not numbers: a port reads 65535, never 65,535.
      return min === undefined || max === undefined
        ? i18n.t('connectors.errors.configNumber', { ns: 'settings', field })
        : i18n.t('connectors.errors.configNumberRange', {
            ns: 'settings',
            field,
            min: String(min),
            max: String(max),
          });
    }
    case 'option': {
      const options = backendErrorStrings(err, 'options');
      if (options === undefined) return undefined;
      const labels = options.map((option) =>
        declared === undefined
          ? option
          : localizeDeclared(optionText(declared, option), i18n.language).label,
      );
      return i18n.t('connectors.errors.configOption', {
        ns: 'settings',
        field,
        options: oneOf(labels),
      });
    }
    case 'email':
      return i18n.t('connectors.errors.configEmail', { ns: 'settings', field });
    case 'fixed':
      return i18n.t('connectors.errors.configFixed', { ns: 'settings', field });
    case 'required':
      return i18n.t('connectors.errors.configRequired', {
        ns: 'settings',
        field,
      });
    case 'requiredFor': {
      const method = backendErrorField(err, 'authMethod');
      return method === undefined
        ? undefined
        : i18n.t('connectors.errors.configRequiredFor', {
            ns: 'settings',
            field,
            method: methodLabel(method),
          });
    }
    default:
      return undefined;
  }
}

function secretRefusal(
  err: unknown,
  connector: string | undefined,
): string | undefined {
  const key = backendErrorField(err, 'field');
  const field = secretLabel(key, backendErrorField(err, 'authMethod'));
  switch (backendErrorField(err, 'reason')) {
    case 'length': {
      const max = backendErrorNumber(err, 'max');
      if (max === undefined) return undefined;
      return field === undefined
        ? i18n.t('connectors.errors.secretLengthAny', {
            ns: 'settings',
            max: String(max),
          })
        : i18n.t('connectors.errors.secretLength', {
            ns: 'settings',
            field,
            max: String(max),
          });
    }
    case 'shape':
      return field === undefined
        ? i18n.t('connectors.errors.secretShapeAny', { ns: 'settings' })
        : i18n.t('connectors.errors.secretShape', { ns: 'settings', field });
    // The one secret field a connector's sign-in can require on its own.
    case 'required':
      return key !== 'tenantId' ||
        field === undefined ||
        connector === undefined
        ? undefined
        : i18n.t('connectors.errors.tenantRequired', {
            ns: 'settings',
            field,
            connector,
          });
    default:
      return undefined;
  }
}

/** The refusal in the catalog's words, or undefined when this surface
 * cannot word it. */
function connectorRefusal(
  err: unknown,
  vendor: ConnectorVendorLike | undefined,
): string | undefined {
  const slug = backendErrorField(err, 'connector');
  const connector = connectorName(vendor, slug);
  switch (backendErrorCode(err)) {
    // The slug the call named: a connector this deployment no longer has
    // has no card to take a name from.
    case 'CONNECTOR_UNKNOWN':
      return slug === undefined
        ? undefined
        : i18n.t('connectors.errors.connectorUnknown', {
            ns: 'settings',
            connector: slug,
          });
    case 'AUTH_METHOD_NOT_SUPPORTED': {
      const method = backendErrorField(err, 'authMethod');
      const accepted = backendErrorStrings(err, 'accepted');
      if (
        connector === undefined ||
        method === undefined ||
        accepted === undefined
      )
        return undefined;
      return i18n.t('connectors.errors.authMethodNotSupported', {
        ns: 'settings',
        connector,
        method: methodLabel(method),
        accepted: oneOf(accepted.map(methodLabel)),
      });
    }
    case 'CREDENTIAL_ENDPOINT_REQUIRED':
      return connector === undefined
        ? undefined
        : i18n.t('connectors.errors.endpointRequired', {
            ns: 'settings',
            connector,
          });
    case 'CREDENTIAL_ENDPOINT_INVALID':
      return endpointRefusal(err, connector);
    case 'CREDENTIAL_CONFIG_INVALID':
    case 'CREDENTIAL_CONFIG_REQUIRED':
      return settingRefusal(err, connector, vendor);
    case 'CREDENTIAL_SECRET_INVALID':
      return secretRefusal(err, connector);
    // The OAuth apps card's door.
    case 'sso_reuse_unsupported':
      return i18n.t('connectors.oauthApps.errors.ssoReuseUnsupported', {
        ns: 'settings',
      });
    case 'sso_not_reusable':
      return i18n.t('connectors.oauthApps.errors.ssoNotReusable', {
        ns: 'settings',
      });
    case 'oauth_app_not_configurable':
      return i18n.t('connectors.oauthApps.errors.notConfigurable', {
        ns: 'settings',
      });
    case 'oauth_app_not_found':
      return i18n.t('connectors.oauthApps.errors.notFound', {
        ns: 'settings',
      });
    case 'client_id_required':
      return i18n.t('connectors.oauthApps.errors.clientIdRequired', {
        ns: 'settings',
      });
    case 'client_secret_required':
      return i18n.t('connectors.oauthApps.errors.clientSecretRequired', {
        ns: 'settings',
      });
    default:
      return undefined;
  }
}

/**
 * The localized reason a connector credential or OAuth app call failed, or
 * `undefined` for a fault, which the caller's own sentence covers. `vendor`
 * is the connector the dialog works on: it names the connector and its
 * settings as the dialog does.
 */
export function connectorFailureDetail(
  err: unknown,
  vendor?: ConnectorVendorLike | null,
): string | undefined {
  // An app row the write did not return is the server's fault, not a
  // refusal.
  if (backendErrorCode(err) === 'write_failed') return undefined;
  return (
    connectorRefusal(err, vendor ?? undefined) ?? credentialFailureDetail(err)
  );
}

/** The sentence a dialog or a toast of the connectors surface shows for a
 * failed call: the localized reason, else the app's generic one. */
export function mapConnectorError(
  err: unknown,
  vendor?: ConnectorVendorLike | null,
): string {
  return (
    connectorFailureDetail(err, vendor) ??
    i18n.t('errors.generic', { ns: 'common' })
  );
}
