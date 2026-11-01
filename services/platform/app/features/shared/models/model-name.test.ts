import { describe, expect, it } from 'vitest';

import {
  groupByProvider,
  modelName,
  modelOptionsByProvider,
  pickedModelName,
  qualifiedModelName,
  sharedModelNames,
} from './model-name';

// Two gateways list the same `vendor/model` id; one provider lists another
// model alone.
const luna = {
  id: 'openai/gpt-5.6-luna',
  label: 'GPT-5.6 Luna',
};
const models = [
  { ...luna, providerSlug: 'openrouter', providerLabel: 'OpenRouter' },
  {
    id: 'claude-haiku-5-5',
    label: 'Claude Haiku 5.5',
    providerSlug: 'anthropic',
    providerLabel: 'Anthropic',
  },
  { ...luna, providerSlug: 'eu-gateway', providerLabel: 'EU Gateway' },
] as const;

// The vendor and a gateway list one model under two ids, and the listing
// names both alike: it drops the `vendor/` prefix.
const lookalikes = [
  {
    id: 'gpt-5.6-luna',
    label: 'GPT 5.6 Luna',
    providerSlug: 'openai',
    providerLabel: 'OpenAI',
  },
  {
    id: 'openai/gpt-5.6-luna',
    label: 'GPT 5.6 Luna',
    providerSlug: 'openrouter',
    providerLabel: 'OpenRouter',
  },
  {
    id: 'claude-haiku-5-5',
    label: 'Claude Haiku 5.5',
    providerSlug: 'anthropic',
    providerLabel: 'Anthropic',
  },
] as const;

describe('modelName', () => {
  it('is the bare model name when one provider offers the id', () => {
    const only = [models[0], models[1]];
    expect(modelName(models[0], sharedModelNames(only))).toBe('GPT-5.6 Luna');
    expect(modelName(models[1], sharedModelNames(only))).toBe(
      'Claude Haiku 5.5',
    );
  });

  it('leads with the provider when two providers offer the same id', () => {
    const shared = sharedModelNames(models);
    expect([...shared.ids]).toEqual(['openai/gpt-5.6-luna']);
    expect(modelName(models[0], shared)).toBe('OpenRouter · GPT-5.6 Luna');
    expect(modelName(models[2], shared)).toBe('EU Gateway · GPT-5.6 Luna');
    expect(modelName(models[1], shared)).toBe('Claude Haiku 5.5');
  });

  it('leads with the provider when two providers offer models of one name', () => {
    const shared = sharedModelNames(lookalikes);
    expect([...shared.ids]).toEqual([]);
    expect([...shared.names]).toEqual(['GPT 5.6 Luna']);
    expect(modelName(lookalikes[0], shared)).toBe('OpenAI · GPT 5.6 Luna');
    expect(modelName(lookalikes[1], shared)).toBe('OpenRouter · GPT 5.6 Luna');
    expect(modelName(lookalikes[2], shared)).toBe('Claude Haiku 5.5');
  });

  it('stands the id and the slug in for missing display names', () => {
    const bare = [
      { id: 'vendor/model', providerSlug: 'gateway-a' },
      { id: 'vendor/model', providerSlug: 'gateway-b', providerLabel: '' },
    ];
    const shared = sharedModelNames(bare);
    expect(modelName(bare[0], shared)).toBe('gateway-a · vendor/model');
    expect(modelName(bare[1], shared)).toBe('gateway-b · vendor/model');
    expect(modelName(bare[0], sharedModelNames([bare[0]]))).toBe(
      'vendor/model',
    );
  });

  it('counts one provider listing an id or a name twice as one provider', () => {
    expect(sharedModelNames([models[0], models[0]]).ids.size).toBe(0);
    // Its own name would not tell its two lookalikes apart.
    const oneGateway = [
      lookalikes[1],
      { ...lookalikes[0], providerSlug: 'openrouter' },
    ];
    const shared = sharedModelNames(oneGateway);
    expect(shared.names.size).toBe(0);
    expect(modelName(oneGateway[0], shared)).toBe('GPT 5.6 Luna');
  });
});

describe('qualifiedModelName', () => {
  it('always leads with the provider', () => {
    expect(qualifiedModelName(models[1])).toBe('Anthropic · Claude Haiku 5.5');
    expect(
      qualifiedModelName({ id: 'gpt-image-2', providerSlug: 'openai' }),
    ).toBe('openai · gpt-image-2');
  });
});

describe('pickedModelName', () => {
  it('names a pick as its closed picker does', () => {
    for (const list of [models, lookalikes]) {
      for (const model of list) {
        expect(
          pickedModelName(
            { id: model.id, providerSlug: model.providerSlug },
            list,
          ),
        ).toBe(modelName(model, sharedModelNames(list)));
      }
    }
  });

  it('leads with the provider when another provider offers the id of a pick no row offers', () => {
    const offered = [models[0], models[1]];
    // EU Gateway stopped offering Luna; OpenRouter still does. The pick
    // takes the model's name from OpenRouter's row; no row names EU Gateway.
    expect(
      pickedModelName(
        { id: 'openai/gpt-5.6-luna', providerSlug: 'eu-gateway' },
        offered,
      ),
    ).toBe('eu-gateway · GPT-5.6 Luna');
    // A row of another of EU Gateway's models names the provider.
    expect(
      pickedModelName(
        { id: 'openai/gpt-5.6-luna', providerSlug: 'eu-gateway' },
        [
          ...offered,
          {
            id: 'mistral-large',
            providerSlug: 'eu-gateway',
            providerLabel: 'EU Gateway',
          },
        ],
      ),
    ).toBe('EU Gateway · GPT-5.6 Luna');
    expect(
      pickedModelName(
        {
          id: 'openai/gpt-5.6-luna',
          label: 'GPT-5.6 Luna',
          providerSlug: 'eu-gateway',
          providerLabel: 'EU Gateway',
        },
        offered,
      ),
    ).toBe('EU Gateway · GPT-5.6 Luna');
    // An id nobody else offers keeps its own name.
    expect(
      pickedModelName(
        { id: 'mistral-large', label: 'Mistral Large', providerSlug: 'eu' },
        offered,
      ),
    ).toBe('Mistral Large');
  });

  it("leads with the provider when another provider offers a model of the pick's name", () => {
    // OpenAI stopped offering its Luna; OpenRouter's reads the same.
    expect(
      pickedModelName(
        {
          id: 'gpt-5.6-luna',
          label: 'GPT 5.6 Luna',
          providerSlug: 'openai',
          providerLabel: 'OpenAI',
        },
        [lookalikes[1], lookalikes[2]],
      ),
    ).toBe('OpenAI · GPT 5.6 Luna');
  });
});

describe('groupByProvider', () => {
  it('keeps the providers in first-appearance order, models in list order', () => {
    const groups = groupByProvider([
      ...models,
      { id: 'gpt-5', label: 'GPT-5', providerSlug: 'openrouter' },
    ]);
    expect(
      groups.map((group) => [
        group.providerSlug,
        group.providerLabel,
        group.models.map((model) => model.id),
      ]),
    ).toEqual([
      ['openrouter', 'OpenRouter', ['openai/gpt-5.6-luna', 'gpt-5']],
      ['anthropic', 'Anthropic', ['claude-haiku-5-5']],
      ['eu-gateway', 'EU Gateway', ['openai/gpt-5.6-luna']],
    ]);
  });
});

describe('modelOptionsByProvider', () => {
  it('heads each provider, names each row, and keeps list indices', () => {
    const options = modelOptionsByProvider(models, (model, index) => ({
      value: String(index),
      ...(model.providerSlug === 'anthropic'
        ? { description: 'Subscription' }
        : {}),
    }));
    expect(options).toEqual([
      {
        value: 'header:openrouter',
        label: 'OpenRouter',
        isSectionHeader: true,
      },
      {
        value: '0',
        label: 'GPT-5.6 Luna',
        name: 'OpenRouter · GPT-5.6 Luna',
        selectedLabel: 'OpenRouter · GPT-5.6 Luna',
        keywords: ['openrouter', 'openai/gpt-5.6-luna'],
      },
      { value: 'header:anthropic', label: 'Anthropic', isSectionHeader: true },
      {
        value: '1',
        description: 'Subscription',
        label: 'Claude Haiku 5.5',
        // Assistive technology hears no header: the row says whose it is.
        name: 'Anthropic · Claude Haiku 5.5',
        selectedLabel: 'Claude Haiku 5.5',
        keywords: ['anthropic', 'claude-haiku-5-5'],
      },
      {
        value: 'header:eu-gateway',
        label: 'EU Gateway',
        isSectionHeader: true,
      },
      {
        value: '2',
        label: 'GPT-5.6 Luna',
        name: 'EU Gateway · GPT-5.6 Luna',
        selectedLabel: 'EU Gateway · GPT-5.6 Luna',
        keywords: ['eu-gateway', 'openai/gpt-5.6-luna'],
      },
    ]);
  });
});
