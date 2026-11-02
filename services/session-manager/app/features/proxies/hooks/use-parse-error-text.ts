import { useCallback } from 'react';

import type { MessageParams } from '@/lib/api/schemas';
import { useT } from '@/lib/i18n/client';

/**
 * Why a line of a proxy list (or the proxy typed into the add dialog) could
 * not be read, in the person's language: worded from the stable `code` of the
 * reason and its `params`. A reason this app has no wording for (a newer
 * backend) shows the backend's own English sentence instead, so nothing is
 * ever left unsaid.
 *
 * One `t('…')` per code on purpose: the i18n usage check reads literal keys,
 * and cannot see one built from the code.
 */
export function useParseErrorText(): (
  code: string,
  params: MessageParams,
  message: string,
) => string {
  const { t } = useT('proxies');
  return useCallback(
    (code, params, message) => {
      switch (code) {
        case 'empty':
          return t('parseErrors.empty');
        case 'whitespace':
          return t('parseErrors.whitespace');
        case 'unsupported_socks4':
          return t('parseErrors.unsupported_socks4');
        case 'unsupported_socks4a':
          return t('parseErrors.unsupported_socks4a');
        case 'unsupported_scheme':
          return t('parseErrors.unsupported_scheme');
        case 'invalid_port_value':
          // Without the port as written, the general sentence says the same.
          return params.port === undefined
            ? t('parseErrors.invalid_port')
            : t('parseErrors.invalid_port_value', { port: params.port });
        case 'url_has_path':
          return t('parseErrors.url_has_path');
        case 'bracketed_ipv6_unparsed':
          return t('parseErrors.bracketed_ipv6_unparsed');
        case 'missing_port':
          return t('parseErrors.missing_port');
        case 'missing_port_ipv6':
          return t('parseErrors.missing_port_ipv6');
        case 'ipv6_needs_brackets':
          return t('parseErrors.ipv6_needs_brackets');
        case 'unparsed_form':
          return t('parseErrors.unparsed_form');
        case 'unparsed_url_form':
          return t('parseErrors.unparsed_url_form');
        case 'ambiguous':
          return t('parseErrors.ambiguous');
        case 'invalid_port':
          return t('parseErrors.invalid_port');
        case 'host_port_not_found':
          return t('parseErrors.host_port_not_found');
        case 'unterminated_bracket':
          return t('parseErrors.unterminated_bracket');
        case 'invalid_after_ipv6':
          return t('parseErrors.invalid_after_ipv6');
        case 'invalid_ipv6':
          return t('parseErrors.invalid_ipv6');
        case 'missing_host':
          return t('parseErrors.missing_host');
        case 'invalid_ipv4':
          return t('parseErrors.invalid_ipv4');
        case 'invalid_hostname':
          return t('parseErrors.invalid_hostname');
        case 'password_without_username':
          return t('parseErrors.password_without_username');
        case 'username_has_colon':
          return t('parseErrors.username_has_colon');
        case 'credentials_control_chars':
          return t('parseErrors.credentials_control_chars');
        case 'socks_credentials_too_long':
          return t('parseErrors.socks_credentials_too_long');
        case 'line_too_long':
          return params.max === undefined
            ? message
            : t('parseErrors.line_too_long', { max: params.max });
        default:
          return message;
      }
    },
    [t],
  );
}
