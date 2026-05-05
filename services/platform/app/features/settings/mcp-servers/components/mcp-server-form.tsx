'use client';

import { Button } from '@tale/ui/button';
import { useCallback, useState } from 'react';

import { FormSection } from '@/app/components/ui/forms/form-section';
import { Input } from '@/app/components/ui/forms/input';
import { Select } from '@/app/components/ui/forms/select';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { Stack } from '@/app/components/ui/layout/layout';
import { useT } from '@/lib/i18n/client';

import type { McpServerListItem } from './types';

interface McpServerFormProps {
  server?: McpServerListItem;
  isSubmitting?: boolean;
  onSubmit: (data: McpServerFormData) => void;
  onCancel?: () => void;
  /** HTML id for the form element — allows external submit buttons via form attribute */
  formId?: string;
  /** Hide the built-in action buttons (Cancel / Save) when rendering them externally */
  hideActions?: boolean;
}

export interface McpServerFormData {
  name: string;
  displayName: string;
  description?: string;
  transportType: 'stdio' | 'sse' | 'streamable_http';
  url?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  authType: 'none' | 'api_key' | 'oauth2';
  apiKey?: string;
  oauth2Config?: {
    tokenUrl: string;
    authorizationUrl?: string;
    clientId: string;
    clientSecret: string;
    scopes?: string[];
    grantType: 'client_credentials' | 'authorization_code';
  };
}

interface FormErrors {
  name?: string;
  displayName?: string;
  url?: string;
  command?: string;
  apiKey?: string;
  tokenUrl?: string;
  authorizationUrl?: string;
  clientId?: string;
  clientSecret?: string;
}

const TRANSPORT_OPTIONS = [
  { value: 'streamable_http', label: 'Streamable HTTP' },
  { value: 'sse', label: 'SSE' },
  { value: 'stdio', label: 'stdio' },
];

const AUTH_OPTIONS = [
  { value: 'none', label: 'None' },
  { value: 'api_key', label: 'API Key' },
  { value: 'oauth2', label: 'OAuth 2.0' },
];

const GRANT_TYPE_OPTIONS = [
  { value: 'client_credentials', label: 'Client credentials' },
  { value: 'authorization_code', label: 'Authorization code' },
];

const TRANSPORT_VALUES = new Set(['stdio', 'sse', 'streamable_http']);
const AUTH_VALUES = new Set(['none', 'api_key', 'oauth2']);
const GRANT_VALUES = new Set(['client_credentials', 'authorization_code']);

function isTransportType(
  val: string,
): val is 'stdio' | 'sse' | 'streamable_http' {
  return TRANSPORT_VALUES.has(val);
}

function isAuthType(val: string): val is 'none' | 'api_key' | 'oauth2' {
  return AUTH_VALUES.has(val);
}

function isGrantType(
  val: string,
): val is 'client_credentials' | 'authorization_code' {
  return GRANT_VALUES.has(val);
}

export function McpServerForm({
  server,
  isSubmitting,
  onSubmit,
  onCancel,
  formId,
  hideActions,
}: McpServerFormProps) {
  const { t } = useT('mcpServers');

  const [name, setName] = useState(server?.name ?? '');
  const [displayName, setDisplayName] = useState(server?.displayName ?? '');
  const [description, setDescription] = useState(server?.description ?? '');
  const [transportType, setTransportType] = useState<
    'stdio' | 'sse' | 'streamable_http'
  >(server?.transportType ?? 'streamable_http');
  const [url, setUrl] = useState(server?.url ?? '');
  const [command, setCommand] = useState(server?.command ?? '');
  const [argsStr, setArgsStr] = useState(server?.args?.join(', ') ?? '');
  const [authType, setAuthType] = useState<'none' | 'api_key' | 'oauth2'>(
    server?.authType ?? 'none',
  );
  const [apiKey, setApiKey] = useState('');
  const [tokenUrl, setTokenUrl] = useState('');
  const [authorizationUrl, setAuthorizationUrl] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [scopesStr, setScopesStr] = useState('');
  const [grantType, setGrantType] = useState<
    'client_credentials' | 'authorization_code'
  >('client_credentials');
  const [errors, setErrors] = useState<FormErrors>({});

  const isHttpTransport =
    transportType === 'sse' || transportType === 'streamable_http';

  const validate = useCallback((): boolean => {
    const newErrors: FormErrors = {};

    if (!name.trim()) {
      newErrors.name = t('form.name') + ' is required';
    } else if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(name) && name.length > 1) {
      newErrors.name = 'Must be lowercase alphanumeric with hyphens';
    }

    if (!displayName.trim()) {
      newErrors.displayName = t('form.displayName') + ' is required';
    }

    if (isHttpTransport && !url.trim()) {
      newErrors.url = t('form.url') + ' is required';
    }

    if (transportType === 'stdio' && !command.trim()) {
      newErrors.command = t('form.command') + ' is required';
    }

    if (authType === 'api_key' && !apiKey.trim() && !server) {
      newErrors.apiKey = t('form.apiKey') + ' is required';
    }

    if (authType === 'oauth2') {
      if (!tokenUrl.trim()) {
        newErrors.tokenUrl = t('oauth2.tokenUrl') + ' is required';
      }
      if (!clientId.trim()) {
        newErrors.clientId = t('oauth2.clientId') + ' is required';
      }
      if (!clientSecret.trim() && !server) {
        newErrors.clientSecret = t('oauth2.clientSecret') + ' is required';
      }
      if (grantType === 'authorization_code' && !authorizationUrl.trim()) {
        newErrors.authorizationUrl =
          t('oauth2.authorizationUrl') + ' is required';
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [
    name,
    displayName,
    url,
    command,
    apiKey,
    tokenUrl,
    clientId,
    clientSecret,
    authorizationUrl,
    grantType,
    isHttpTransport,
    transportType,
    authType,
    server,
    t,
  ]);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!validate()) return;

      const data: McpServerFormData = {
        name: name.trim(),
        displayName: displayName.trim(),
        description: description.trim() || undefined,
        transportType,
        authType,
      };

      if (isHttpTransport) {
        data.url = url.trim();
      } else {
        data.command = command.trim();
        if (argsStr.trim()) {
          data.args = argsStr
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
        }
      }

      if (authType === 'api_key' && apiKey.trim()) {
        data.apiKey = apiKey;
      }

      if (authType === 'oauth2') {
        data.oauth2Config = {
          tokenUrl: tokenUrl.trim(),
          clientId: clientId.trim(),
          clientSecret: clientSecret.trim(),
          grantType,
          ...(authorizationUrl.trim()
            ? { authorizationUrl: authorizationUrl.trim() }
            : {}),
          ...(scopesStr.trim()
            ? {
                scopes: scopesStr
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean),
              }
            : {}),
        };
      }

      onSubmit(data);
    },
    [
      validate,
      name,
      displayName,
      description,
      transportType,
      authType,
      isHttpTransport,
      url,
      command,
      argsStr,
      apiKey,
      tokenUrl,
      clientId,
      clientSecret,
      grantType,
      authorizationUrl,
      scopesStr,
      onSubmit,
    ],
  );

  return (
    <form id={formId} onSubmit={handleSubmit} noValidate>
      <Stack gap={6}>
        <FormSection label={t('form.connectionSection')}>
          <Input
            label={t('form.name')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            errorMessage={errors.name}
            isInvalid={!!errors.name}
            required
            placeholder="my-mcp-server"
            disabled={!!server}
          />
          <Input
            label={t('form.displayName')}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            errorMessage={errors.displayName}
            isInvalid={!!errors.displayName}
            required
          />
          <Textarea
            label={t('form.description')}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
          />
          <Select
            label={t('form.transportType')}
            options={TRANSPORT_OPTIONS}
            value={transportType}
            onValueChange={(val) => {
              if (isTransportType(val)) setTransportType(val);
            }}
          />

          {isHttpTransport && (
            <Input
              label={t('form.url')}
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              errorMessage={errors.url}
              isInvalid={!!errors.url}
              required
              placeholder="https://example.com/mcp"
            />
          )}

          {transportType === 'stdio' && (
            <>
              <Input
                label={t('form.command')}
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                errorMessage={errors.command}
                isInvalid={!!errors.command}
                required
                placeholder="npx"
              />
              <Input
                label={t('form.args')}
                value={argsStr}
                onChange={(e) => setArgsStr(e.target.value)}
                placeholder="-y, @modelcontextprotocol/server-github"
              />
            </>
          )}
        </FormSection>

        <FormSection label={t('form.authSection')}>
          <Select
            label={t('form.authType')}
            options={AUTH_OPTIONS}
            value={authType}
            onValueChange={(val) => {
              if (isAuthType(val)) setAuthType(val);
            }}
          />

          {authType === 'api_key' && (
            <Input
              label={t('form.apiKey')}
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              errorMessage={errors.apiKey}
              isInvalid={!!errors.apiKey}
              required={!server}
              placeholder={server ? '********' : ''}
            />
          )}

          {authType === 'oauth2' && (
            <Stack gap={3}>
              <Select
                label={t('oauth2.grantType')}
                options={GRANT_TYPE_OPTIONS}
                value={grantType}
                onValueChange={(val) => {
                  if (isGrantType(val)) setGrantType(val);
                }}
              />
              <Input
                label={t('oauth2.tokenUrl')}
                type="url"
                value={tokenUrl}
                onChange={(e) => setTokenUrl(e.target.value)}
                errorMessage={errors.tokenUrl}
                isInvalid={!!errors.tokenUrl}
                required
              />
              {grantType === 'authorization_code' && (
                <Input
                  label={t('oauth2.authorizationUrl')}
                  type="url"
                  value={authorizationUrl}
                  onChange={(e) => setAuthorizationUrl(e.target.value)}
                  errorMessage={errors.authorizationUrl}
                  isInvalid={!!errors.authorizationUrl}
                  required
                />
              )}
              <Input
                label={t('oauth2.clientId')}
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                errorMessage={errors.clientId}
                isInvalid={!!errors.clientId}
                required
              />
              <Input
                label={t('oauth2.clientSecret')}
                type="password"
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
                errorMessage={errors.clientSecret}
                isInvalid={!!errors.clientSecret}
                required={!server}
                placeholder={server ? '********' : ''}
              />
              <Input
                label={t('oauth2.scopes')}
                value={scopesStr}
                onChange={(e) => setScopesStr(e.target.value)}
                placeholder="read, write"
              />
            </Stack>
          )}
        </FormSection>

        {!hideActions && (
          <div className="flex justify-end gap-3">
            {onCancel && (
              <Button
                type="button"
                variant="secondary"
                onClick={onCancel}
                disabled={isSubmitting}
              >
                {t('form.cancel')}
              </Button>
            )}
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? t('form.saving') : t('form.save')}
            </Button>
          </div>
        )}
      </Stack>
    </form>
  );
}
