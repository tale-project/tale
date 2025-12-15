/**
 * Tests for Variable Reference Validation
 */

import { describe, it, expect } from 'vitest';
import {
  parseVariableReferences,
  parseVariableReferencesFromString,
  extractStepReferences,
} from './parse_variable_references';
import { validateWorkflowVariableReferences } from './validate_variable_references';
import { getActionOutputSchema } from './action_output_schemas';

describe('parseVariableReferencesFromString', () => {
  it('should parse step references correctly', () => {
    const refs = parseVariableReferencesFromString(
      '{{steps.hydrate_recommendations.output.data}}',
    );

    expect(refs).toHaveLength(1);
    expect(refs[0].type).toBe('step');
    expect(refs[0].stepSlug).toBe('hydrate_recommendations');
    expect(refs[0].path).toEqual(['output', 'data']);
  });

  it('should parse multiple references in a string', () => {
    const refs = parseVariableReferencesFromString(
      'Customer {{steps.get_customer.output.data.name}} has email {{steps.get_customer.output.data.email}}',
    );

    expect(refs).toHaveLength(2);
    expect(refs[0].stepSlug).toBe('get_customer');
    expect(refs[0].path).toEqual(['output', 'data', 'name']);
    expect(refs[1].stepSlug).toBe('get_customer');
    expect(refs[1].path).toEqual(['output', 'data', 'email']);
  });

  it('should parse loop references', () => {
    const refs = parseVariableReferencesFromString('{{loop.item.name}}');

    expect(refs).toHaveLength(1);
    expect(refs[0].type).toBe('loop');
    expect(refs[0].path).toEqual(['item', 'name']);
  });

  it('should parse system variables', () => {
    const refs = parseVariableReferencesFromString('{{organizationId}}');

    expect(refs).toHaveLength(1);
    expect(refs[0].type).toBe('system');
    expect(refs[0].path).toEqual(['organizationId']);
  });

  it('should parse secret references', () => {
    const refs = parseVariableReferencesFromString('{{secrets.apiKey}}');

    expect(refs).toHaveLength(1);
    expect(refs[0].type).toBe('secret');
    expect(refs[0].path).toEqual(['apiKey']);
  });
});

describe('parseVariableReferences', () => {
  it('should recursively extract references from nested objects', () => {
    const config = {
      metadata: {
        customerId: '{{currentCustomerId}}',
        recommendedProducts: '{{steps.hydrate_recommendations.output.data}}',
        nested: {
          value: '{{steps.generate_recommendations.output.data.summary}}',
        },
      },
    };

    const refs = parseVariableReferences(config);

    expect(refs).toHaveLength(3);
    expect(refs.filter((r) => r.type === 'step')).toHaveLength(2);
  });
});

describe('extractStepReferences', () => {
  it('should only return step references', () => {
    const config = {
      customerId: '{{currentCustomerId}}',
      products: '{{steps.hydrate_recommendations.output.data}}',
      orgId: '{{organizationId}}',
    };

    const refs = extractStepReferences(config);

    expect(refs).toHaveLength(1);
    expect(refs[0].stepSlug).toBe('hydrate_recommendations');
  });
});

describe('validateWorkflowVariableReferences', () => {
  const baseSteps = [
    {
      stepSlug: 'trigger',
      stepType: 'trigger',
      order: 1,
      config: { type: 'manual' },
      nextSteps: { success: 'get_customer' },
    },
    {
      stepSlug: 'get_customer',
      stepType: 'action',
      order: 2,
      config: { type: 'customer', parameters: { operation: 'query' } },
      nextSteps: { success: 'hydrate_recommendations' },
    },
    {
      stepSlug: 'hydrate_recommendations',
      stepType: 'action',
      order: 3,
      config: {
        type: 'product',
        parameters: {
          operation: 'hydrate_fields',
          items: '{{steps.get_customer.output.data}}',
        },
      },
      nextSteps: { success: 'create_approval' },
    },
  ];

  it('should validate correct step references', () => {
    const result = validateWorkflowVariableReferences(baseSteps);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should detect non-existent step references', () => {
    const steps = [
      ...baseSteps,
      {
        stepSlug: 'create_approval',
        stepType: 'action',
        order: 4,
        config: {
          type: 'approval',
          parameters: {
            metadata: {
              products: '{{steps.non_existent_step.output.data}}',
            },
          },
        },
        nextSteps: {},
      },
    ];

    const result = validateWorkflowVariableReferences(steps);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('non_existent_step'))).toBe(true);
  });

  it('should detect forward references (referencing later steps)', () => {
    const steps = [
      {
        stepSlug: 'step_a',
        stepType: 'action',
        order: 1,
        config: {
          type: 'customer',
          parameters: {
            // This references step_b which comes later!
            customerId: '{{steps.step_b.output.data._id}}',
          },
        },
        nextSteps: { success: 'step_b' },
      },
      {
        stepSlug: 'step_b',
        stepType: 'action',
        order: 2,
        config: { type: 'customer', parameters: { operation: 'query' } },
        nextSteps: {},
      },
    ];

    const result = validateWorkflowVariableReferences(steps);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('executes at the same time or later'))).toBe(true);
  });

  it('should warn about accessing properties on array results', () => {
    const steps = [
      {
        stepSlug: 'hydrate',
        stepType: 'action',
        order: 1,
        config: {
          type: 'product',
          parameters: { operation: 'hydrate_fields', items: [] },
        },
        nextSteps: { success: 'use_results' },
      },
      {
        stepSlug: 'use_results',
        stepType: 'action',
        order: 2,
        config: {
          type: 'approval',
          parameters: {
            // hydrate_fields returns an array, but we're accessing .recommendations
            metadata: '{{steps.hydrate.output.data.recommendations}}',
          },
        },
        nextSteps: {},
      },
    ];

    const result = validateWorkflowVariableReferences(steps);

    // Should have a warning about array access
    expect(result.warnings.some((w) => w.includes('array result'))).toBe(true);
  });
});

describe('getActionOutputSchema', () => {
  it('should return schema for known action operations', () => {
    const schema = getActionOutputSchema('product', 'hydrate_fields');

    expect(schema).not.toBeNull();
    expect(schema?.isArray).toBe(true);
    expect(schema?.description).toContain('hydrated');
  });

  it('should return schema for approval create_approval', () => {
    const schema = getActionOutputSchema('approval', 'create_approval');

    expect(schema).not.toBeNull();
    expect(schema?.nullable).toBe(true);
    expect(schema?.fields?._id).toBeDefined();
  });

  it('should return null for unknown action type', () => {
    const schema = getActionOutputSchema('unknown_action', 'unknown_operation');

    expect(schema).toBeNull();
  });

  // Tests for newly added action schemas
  it('should return schema for rag upload_document', () => {
    const schema = getActionOutputSchema('rag', 'upload_document');

    expect(schema).not.toBeNull();
    expect(schema?.fields?.success).toBeDefined();
    expect(schema?.fields?.recordId).toBeDefined();
    expect(schema?.fields?.ragDocumentId).toBeDefined();
  });

  it('should return schema for imap search', () => {
    const schema = getActionOutputSchema('imap', 'search');

    expect(schema).not.toBeNull();
    expect(schema?.isArray).toBe(true);
    expect(schema?.items?.fields?.uid).toBeDefined();
    expect(schema?.items?.fields?.subject).toBeDefined();
  });

  it('should return schema for email_provider get_imap_credentials', () => {
    const schema = getActionOutputSchema('email_provider', 'get_imap_credentials');

    expect(schema).not.toBeNull();
    expect(schema?.fields?.providerId).toBeDefined();
    expect(schema?.fields?.credentials).toBeDefined();
    expect(schema?.fields?.authMethod).toBeDefined();
  });

  it('should return schema for crawler discover_urls', () => {
    const schema = getActionOutputSchema('crawler', 'discover_urls');

    expect(schema).not.toBeNull();
    expect(schema?.fields?.success).toBeDefined();
    expect(schema?.fields?.domain).toBeDefined();
    expect(schema?.fields?.urls).toBeDefined();
  });

  it('should return schema for crawler fetch_urls', () => {
    const schema = getActionOutputSchema('crawler', 'fetch_urls');

    expect(schema).not.toBeNull();
    expect(schema?.fields?.pages).toBeDefined();
    expect(schema?.fields?.urls_fetched).toBeDefined();
  });

  it('should return schema for onedrive list_folder_contents', () => {
    const schema = getActionOutputSchema('onedrive', 'list_folder_contents');

    expect(schema).not.toBeNull();
    expect(schema?.isArray).toBe(true);
    expect(schema?.items?.fields?.id).toBeDefined();
    expect(schema?.items?.fields?.name).toBeDefined();
  });

  it('should return schema for website create', () => {
    const schema = getActionOutputSchema('website', 'create');

    expect(schema).not.toBeNull();
    expect(schema?.nullable).toBe(true);
    expect(schema?.fields?.domain).toBeDefined();
  });

  it('should return schema for websitePages bulk_upsert', () => {
    const schema = getActionOutputSchema('websitePages', 'bulk_upsert');

    expect(schema).not.toBeNull();
    expect(schema?.fields?.created).toBeDefined();
    expect(schema?.fields?.updated).toBeDefined();
    expect(schema?.fields?.total).toBeDefined();
  });

  it('should return schema for tone_of_voice get_tone_of_voice', () => {
    const schema = getActionOutputSchema('tone_of_voice', 'get_tone_of_voice');

    expect(schema).not.toBeNull();
    expect(schema?.nullable).toBe(true);
    expect(schema?.fields?._id).toBeDefined();
  });

  it('should return schema for workflow upload_all_workflows', () => {
    const schema = getActionOutputSchema('workflow', 'upload_all_workflows');

    expect(schema).not.toBeNull();
    expect(schema?.fields?.success).toBeDefined();
    expect(schema?.fields?.executionTimeMs).toBeDefined();
  });

  // Tests verifying type-safe schemas match Convex Doc types
  it('should have type-safe product fields matching Doc<products>', () => {
    const schema = getActionOutputSchema('product', 'create');

    // These fields exist on Doc<'products'> in schema.ts
    expect(schema?.fields?._id).toBeDefined();
    expect(schema?.fields?._creationTime).toBeDefined();
    expect(schema?.fields?.organizationId).toBeDefined();
    expect(schema?.fields?.name).toBeDefined();
    expect(schema?.fields?.description).toBeDefined();
    expect(schema?.fields?.price).toBeDefined();
    expect(schema?.fields?.status).toBeDefined();
    expect(schema?.fields?.translations).toBeDefined(); // Added after type checking
  });

  it('should have type-safe customer fields matching Doc<customers>', () => {
    const schema = getActionOutputSchema('customer', 'create');

    // These fields exist on Doc<'customers'> in schema.ts
    expect(schema?.fields?._id).toBeDefined();
    expect(schema?.fields?.organizationId).toBeDefined();
    expect(schema?.fields?.name).toBeDefined();
    expect(schema?.fields?.email).toBeDefined();
    expect(schema?.fields?.source).toBeDefined();
    expect(schema?.fields?.address).toBeDefined(); // Nested object in schema
  });

  it('should have type-safe conversation fields matching Doc<conversations>', () => {
    const schema = getActionOutputSchema('conversation', 'create');

    // These fields exist on Doc<'conversations'> in schema.ts
    expect(schema?.fields?.customerId).toBeDefined();
    expect(schema?.fields?.subject).toBeDefined();
    expect(schema?.fields?.status).toBeDefined();
    expect(schema?.fields?.channel).toBeDefined();
    expect(schema?.fields?.direction).toBeDefined();
    expect(schema?.fields?.providerId).toBeDefined();
  });
});

describe('real-world scenario: product recommendation workflow', () => {
  it('should validate hydrate_recommendations -> create_approval reference pattern', () => {
    const steps = [
      {
        stepSlug: 'trigger',
        stepType: 'trigger',
        order: 1,
        config: { type: 'manual' },
        nextSteps: { success: 'generate_recommendations' },
      },
      {
        stepSlug: 'generate_recommendations',
        stepType: 'llm',
        order: 2,
        config: {
          systemPrompt: 'Generate product recommendations',
          userPrompt: 'Recommend products',
          outputFormat: 'json',
        },
        nextSteps: { success: 'hydrate_recommendations' },
      },
      {
        stepSlug: 'hydrate_recommendations',
        stepType: 'action',
        order: 3,
        config: {
          type: 'product',
          parameters: {
            operation: 'hydrate_fields',
            items: '{{steps.generate_recommendations.output.data.recommendations}}',
            idField: 'productId',
            mappings: { imageUrl: 'imageUrl', productName: 'name' },
          },
        },
        nextSteps: { success: 'create_approval' },
      },
      {
        stepSlug: 'create_approval',
        stepType: 'action',
        order: 4,
        config: {
          type: 'approval',
          parameters: {
            operation: 'create_approval',
            resourceType: 'product_recommendation',
            resourceId: '{{currentCustomerId}}',
            priority: 'medium',
            metadata: {
              // This is the pattern from the original question
              recommendedProducts: '{{steps.hydrate_recommendations.output.data}}',
              summary: '{{steps.generate_recommendations.output.data.summary}}',
            },
          },
        },
        nextSteps: { success: 'end' },
      },
    ];

    const result = validateWorkflowVariableReferences(steps);

    // Should be valid - all references are to existing steps in correct order
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);

    // May have warnings about output structure
    // The hydrate_recommendations.output.data is an array, which is fine
    // The generate_recommendations.output.data.summary accesses a field on LLM output
  });

  it('should catch typo in step reference', () => {
    const steps = [
      {
        stepSlug: 'hydrate_recommendations',
        stepType: 'action',
        order: 1,
        config: { type: 'product', parameters: { operation: 'hydrate_fields' } },
        nextSteps: { success: 'create_approval' },
      },
      {
        stepSlug: 'create_approval',
        stepType: 'action',
        order: 2,
        config: {
          type: 'approval',
          parameters: {
            metadata: {
              // Typo: hydrate_recomendations instead of hydrate_recommendations
              products: '{{steps.hydrate_recomendations.output.data}}',
            },
          },
        },
        nextSteps: {},
      },
    ];

    const result = validateWorkflowVariableReferences(steps);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('hydrate_recomendations'))).toBe(true);
    expect(result.errors.some((e) => e.includes('non-existent step'))).toBe(true);
  });
});

