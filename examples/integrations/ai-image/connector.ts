// ─── Sandbox API Types ──────────────────────────────────────────────────────
// These types describe the APIs available inside the integration sandbox.
// They are stripped during transpilation and exist only for editor support.

interface HttpResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: unknown;
  text(): string;
  json(): unknown;
}

interface HttpMethodOptions {
  headers?: Record<string, string>;
  responseType?: 'base64';
}

interface FormFieldInput {
  name: string;
  value: string;
  fileName?: string;
  contentType?: string;
  isBase64?: boolean;
}

interface BodyMethodOptions extends HttpMethodOptions {
  body?: string;
  binaryBody?: string;
  formFields?: FormFieldInput[];
}

interface HttpApi {
  get(url: string, options?: HttpMethodOptions): HttpResponse;
  post(url: string, options?: BodyMethodOptions): HttpResponse;
  put(url: string, options?: BodyMethodOptions): HttpResponse;
  patch(url: string, options?: BodyMethodOptions): HttpResponse;
  delete(url: string, options?: BodyMethodOptions): HttpResponse;
}

interface SecretsApi {
  get(key: string): string | undefined;
}

interface FileReference {
  fileId: string;
  url: string;
  fileName: string;
  contentType: string;
  size: number;
}

interface FilesApi {
  download(
    url: string,
    options: { headers?: Record<string, string>; fileName: string },
  ): FileReference;
  store(
    data: string,
    options: {
      encoding: 'base64' | 'utf-8';
      contentType: string;
      fileName: string;
    },
  ): FileReference;
}

interface ConnectorContext {
  operation: string;
  params: Record<string, unknown>;
  http: HttpApi;
  secrets: SecretsApi;
  base64Encode(input: string): string;
  base64Decode(input: string): string;
  files?: FilesApi;
}

interface TestConnectionContext {
  http: HttpApi;
  secrets: SecretsApi;
  base64Encode(input: string): string;
  base64Decode(input: string): string;
  files?: FilesApi;
}

// ─────────────────────────────────────────────────────────────────────────────

// Image Generation Connector — OpenAI-compatible Images API
// Works with Together AI, OpenAI, vLLM, and other compatible endpoints.
// Configure the API base URL (domain) and API key to switch providers.

const connector = {
  operations: ['create', 'edit'],

  testConnection: function (ctx: TestConnectionContext) {
    const apiBase = getApiBase(ctx.secrets);
    const headers = buildHeaders(ctx.secrets);
    const configuredModel = ctx.secrets.get('model') || '';

    // Validate model is specified
    if (!configuredModel) {
      throw new Error(
        'Model is required. Set it in the "model" field. ' +
          'Supported models: ' +
          Object.keys(MODEL_CAPS).join(', '),
      );
    }

    // Validate model is known
    if (!MODEL_CAPS[configuredModel]) {
      throw new Error(
        'Unknown model "' +
          configuredModel +
          '". ' +
          'Supported models: ' +
          Object.keys(MODEL_CAPS).join(', '),
      );
    }

    // Test API connectivity
    const response = ctx.http.get(apiBase + '/v1/models', {
      headers: headers,
    });

    if (response.status === 401 || response.status === 403) {
      throw new Error(
        'Authentication failed. Please verify your API key is correct.',
      );
    }
    if (response.status >= 400) {
      throw new Error(
        'Connection failed (' + response.status + '): ' + response.text(),
      );
    }

    var caps = MODEL_CAPS[configuredModel];
    return {
      status: 'ok',
      provider: apiBase,
      model: configuredModel,
      supportedSizes: caps.sizes,
      supportsEdit: caps.supportsEdit,
    };
  },

  execute: function (ctx: ConnectorContext) {
    const operation = ctx.operation;
    const params = ctx.params;
    const apiBase = getApiBase(ctx.secrets);
    const headers = buildHeaders(ctx.secrets);
    const configuredModel = ctx.secrets.get('model') || 'gpt-image-1';
    console.log('Configured model from secrets: ' + configuredModel);

    if (operation === 'create') {
      return generateImage(
        ctx.http,
        ctx.files,
        headers,
        params,
        apiBase,
        configuredModel,
      );
    }
    if (operation === 'edit') {
      return editImage(
        ctx.http,
        ctx.files,
        headers,
        params,
        apiBase,
        configuredModel,
      );
    }

    throw new Error('Unknown operation: ' + operation);
  },
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function getApiBase(secrets: SecretsApi): string {
  const domain = secrets.get('domain');
  if (!domain) {
    throw new Error(
      'API base URL (domain) is required. Set it in the integration connection config ' +
        '(e.g. https://api.together.xyz for Together AI).',
    );
  }
  // Strip trailing slash for consistent URL building
  return domain.replace(/\/+$/, '');
}

function buildHeaders(secrets: SecretsApi): Record<string, string> {
  const accessToken = secrets.get('accessToken');
  if (!accessToken) {
    throw new Error('API key (accessToken) is required.');
  }
  return {
    Authorization: 'Bearer ' + accessToken,
    'Content-Type': 'application/json',
  };
}

function handleError(response: HttpResponse, operation: string) {
  if (response.status === 401 || response.status === 403) {
    throw new Error(
      'Authentication failed during ' +
        operation +
        '. Please verify your API key.',
    );
  }
  if (response.status === 429) {
    throw new Error(
      'Rate limited during ' + operation + '. Please try again later.',
    );
  }
  if (response.status >= 400) {
    let errorBody = '';
    try {
      const errData = response.json();
      errorBody = errData.error?.message || errData.message || response.text();
    } catch (e) {
      errorBody = response.text();
    }
    throw new Error(
      'API error during ' +
        operation +
        ' (' +
        response.status +
        '): ' +
        errorBody,
    );
  }
}

// ─── Model Capabilities ─────────────────────────────────────────────────────

var MODEL_CAPS: Record<
  string,
  { sizes: string[]; defaultSize: string; maxN: number; supportsEdit: boolean }
> = {
  'gpt-image-1': {
    sizes: ['1024x1024', '1024x1536', '1536x1024', 'auto'],
    defaultSize: '1024x1024',
    maxN: 1,
    supportsEdit: true,
  },
  'dall-e-3': {
    sizes: ['1024x1024', '1024x1792', '1792x1024'],
    defaultSize: '1024x1024',
    maxN: 1,
    supportsEdit: false,
  },
  'dall-e-2': {
    sizes: ['256x256', '512x512', '1024x1024'],
    defaultSize: '1024x1024',
    maxN: 10,
    supportsEdit: true,
  },
};

/**
 * Validate the size parameter for a given model.
 * Throws with supported sizes if invalid, so the AI can self-correct.
 */
function validateSize(
  model: string,
  requestedSize: unknown,
): string | undefined {
  if (!requestedSize) return undefined;
  var size = String(requestedSize);
  var caps = MODEL_CAPS[model];
  if (!caps) return size;
  if (caps.sizes.indexOf(size) !== -1) return size;
  throw new Error(
    'Invalid size "' +
      size +
      '" for model "' +
      model +
      '". ' +
      'Supported sizes: ' +
      caps.sizes.join(', '),
  );
}

// ─── Operations ─────────────────────────────────────────────────────────────

function generateImage(
  http: HttpApi,
  files: FilesApi | undefined,
  headers: Record<string, string>,
  params: Record<string, unknown>,
  apiBase: string,
  configuredModel: string,
) {
  if (!params.prompt) {
    throw new Error('prompt is required for create.');
  }

  var model = configuredModel;
  var size = validateSize(model, params.size);

  const payload: Record<string, unknown> = {
    prompt: params.prompt,
    model: model,
  };
  // dall-e models need response_format to return base64; gpt-image-1 returns base64 by default
  if (model.indexOf('dall-e') !== -1) {
    payload.response_format = 'b64_json';
  }
  if (size) payload.size = size;
  if (params.n) payload.n = params.n;

  console.log(
    'Generating image with model: ' + model + ', size: ' + (size || 'default'),
  );

  const response = http.post(apiBase + '/v1/images/generations', {
    headers: headers,
    body: JSON.stringify(payload),
  });
  handleError(response, 'create');

  const data = response.json();
  const imageItems = data.data || [];

  if (imageItems.length === 0) {
    throw new Error('No images were returned by the API.');
  }

  const imageRefs: FileReference[] = [];
  for (let i = 0; i < imageItems.length; i++) {
    const item = imageItems[i];
    const timestamp = Date.now();
    const fileName = 'generated_' + timestamp + '_' + i + '.png';

    if (item.b64_json && files) {
      const ref = files.store(item.b64_json, {
        encoding: 'base64',
        contentType: 'image/png',
        fileName: fileName,
      });
      imageRefs.push(ref);
    } else if (item.url && files) {
      const ref = files.download(item.url, {
        fileName: fileName,
      });
      imageRefs.push(ref);
    }
  }

  return {
    success: true,
    operation: 'create',
    data: {
      images: imageRefs,
      prompt: params.prompt,
      model: params.model || 'default',
      size: params.size || '1024x1024',
      count: imageRefs.length,
    },
    count: imageRefs.length,
    timestamp: Date.now(),
  };
}

function editImage(
  http: HttpApi,
  files: FilesApi | undefined,
  headers: Record<string, string>,
  params: Record<string, unknown>,
  apiBase: string,
  configuredModel: string,
) {
  var caps = MODEL_CAPS[configuredModel];
  if (caps && !caps.supportsEdit) {
    throw new Error(
      'Model "' +
        configuredModel +
        '" does not support image editing. ' +
        'Models that support edit: ' +
        Object.keys(MODEL_CAPS)
          .filter(function (k) {
            return MODEL_CAPS[k].supportsEdit;
          })
          .join(', '),
    );
  }
  if (!params.prompt) {
    throw new Error('prompt is required for edit.');
  }
  if (!params.image) {
    throw new Error('image (URL or base64-encoded) is required for edit.');
  }

  // Download image as base64 if it's a URL
  var imageBase64 = params.image as string;
  if (imageBase64.startsWith('http://') || imageBase64.startsWith('https://')) {
    var dlResponse = http.get(imageBase64, { responseType: 'base64' });
    if (dlResponse.status >= 400) {
      throw new Error(
        'Failed to download source image (' + dlResponse.status + ')',
      );
    }
    imageBase64 = dlResponse.body as string;
  }

  var model = configuredModel;
  validateSize(model, params.size);

  console.log(
    'Editing image with model: ' +
      model +
      ', size: ' +
      (params.size || 'default'),
  );

  // Use multipart/form-data — required by OpenAI images/edits endpoint
  var formFields: FormFieldInput[] = [
    { name: 'model', value: model },
    { name: 'prompt', value: params.prompt as string },
    {
      name: 'image',
      value: imageBase64,
      fileName: 'image.png',
      contentType: 'image/png',
      isBase64: true,
    },
  ];
  if (params.n) formFields.push({ name: 'n', value: String(params.n) });
  if (params.size)
    formFields.push({ name: 'size', value: params.size as string });

  // Don't send Content-Type header — it will be set with the boundary
  var formHeaders: Record<string, string> = {
    Authorization: headers['Authorization'],
  };

  const response = http.post(apiBase + '/v1/images/edits', {
    headers: formHeaders,
    formFields: formFields,
  });
  handleError(response, 'edit');

  const data = response.json();
  const imageItems = data.data || [];

  if (imageItems.length === 0) {
    throw new Error('No images were returned by the API.');
  }

  const imageRefs: FileReference[] = [];
  for (let i = 0; i < imageItems.length; i++) {
    const item = imageItems[i];
    const timestamp = Date.now();
    const fileName = 'edited_' + timestamp + '_' + i + '.png';

    if (item.b64_json && files) {
      const ref = files.store(item.b64_json, {
        encoding: 'base64',
        contentType: 'image/png',
        fileName: fileName,
      });
      imageRefs.push(ref);
    } else if (item.url && files) {
      const ref = files.download(item.url, {
        fileName: fileName,
      });
      imageRefs.push(ref);
    }
  }

  return {
    success: true,
    operation: 'edit',
    data: {
      images: imageRefs,
      prompt: params.prompt,
      model: params.model || 'default',
      count: imageRefs.length,
    },
    count: imageRefs.length,
    timestamp: Date.now(),
  };
}
