import { describe, it, expect } from 'vitest';

import { ContextBuilder, type ContextBuilderOptions } from './context_builder';
import { ContextPriority } from './context_priority';

describe('ContextBuilder — maxContextTokens governance limit', () => {
  it('uses model context limit when maxContextTokens is not set', () => {
    const builder = new ContextBuilder({
      agentType: 'chat',
      modelContextLimit: 128000,
    });
    builder.addContext('test', 'Hello world', ContextPriority.HIGH_RELEVANCE);

    const result = builder.build();

    expect(result.totalTokens).toBeGreaterThan(0);
    expect(result.wasTrimmed).toBe(false);
  });

  it('caps budget when maxContextTokens is lower than model limit', () => {
    const largeContent = 'token '.repeat(10000);

    const builderWithoutCap = new ContextBuilder({
      agentType: 'chat',
      modelContextLimit: 128000,
    });
    builderWithoutCap.addContext(
      'large',
      largeContent,
      ContextPriority.LOW_RELEVANCE,
      { canTrim: true },
    );
    const resultWithoutCap = builderWithoutCap.build();

    const builderWithCap = new ContextBuilder({
      agentType: 'chat',
      modelContextLimit: 128000,
      maxContextTokens: 8192,
    });
    builderWithCap.addContext(
      'large',
      largeContent,
      ContextPriority.LOW_RELEVANCE,
      { canTrim: true },
    );
    const resultWithCap = builderWithCap.build();

    expect(resultWithCap.totalTokens).toBeLessThanOrEqual(
      resultWithoutCap.totalTokens,
    );
  });

  it('uses model limit when maxContextTokens exceeds it', () => {
    const options: ContextBuilderOptions = {
      agentType: 'chat',
      modelContextLimit: 128000,
      maxContextTokens: 256000,
    };
    const builder = new ContextBuilder(options);
    builder.addContext('test', 'small content', ContextPriority.HIGH_RELEVANCE);

    const result = builder.build();

    expect(result.totalTokens).toBeGreaterThan(0);
    expect(result.wasTrimmed).toBe(false);
  });

  it('trims content when governance limit forces tight budget', () => {
    const largeContent = 'word '.repeat(20000);

    const builder = new ContextBuilder({
      agentType: 'chat',
      modelContextLimit: 128000,
      maxContextTokens: 4096,
      outputReserve: 512,
      currentPromptTokens: 100,
    });
    builder.addContext(
      'large_content',
      largeContent,
      ContextPriority.LOW_RELEVANCE,
      { canTrim: true },
    );

    const result = builder.build();

    expect(result.wasTrimmed).toBe(true);
  });
});
