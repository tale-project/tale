import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { isRecord } from '../utils/type-utils';
import {
  GENERATE_IMAGE_INPUTS_MAX,
  type ImageModelInputs,
  isWorkToolName,
  RUN_CODE_LANGUAGES,
  RUN_CODE_MAX_TIMEOUT_SECONDS,
  WORK_TOOL_NAMES,
  workToolDoc,
  workToolTier,
  workWireTool,
} from './work-tools';

function schemaOf(name: (typeof WORK_TOOL_NAMES)[number]) {
  const parameters = workWireTool(name).parameters;
  if (!isRecord(parameters)) throw new Error('schema is not an object');
  return parameters;
}

describe('work tools', () => {
  it('every tool has a closed object schema, a description and a doc line', () => {
    for (const name of WORK_TOOL_NAMES) {
      const schema = schemaOf(name);
      expect(schema.type).toBe('object');
      expect(schema.additionalProperties).toBe(false);
      expect(workWireTool(name).description.length).toBeGreaterThan(80);
      expect(workToolDoc(name).id).toBe(name);
    }
  });

  it('each tool runs in its tier: the platform, a light sandbox, or the full workspace', () => {
    const tiers = Object.fromEntries(
      WORK_TOOL_NAMES.map((name) => [name, workToolTier(name)]),
    );
    expect(tiers).toEqual({
      create_file: 'none',
      generate_image: 'none',
      load_skill: 'none',
      read_skill_file: 'none',
      run_code: 'light',
      use_workspace: 'full',
    });
  });

  it('use_workspace names its last-resort cost and what to hand over', () => {
    const description = workWireTool('use_workspace').description;
    expect(description).toMatch(/last resort/);
    expect(description).toMatch(/without seeing this conversation/);
    expect(description).toMatch(/create_file and run_code/);
    const schema = schemaOf('use_workspace');
    expect(schema.required).toEqual(['reason', 'brief']);
  });

  it('recognizes its own names only', () => {
    expect(isWorkToolName('run_code')).toBe(true);
    expect(isWorkToolName('rag_search')).toBe(false);
  });

  it('steers binary formats away from create_file to run_code', () => {
    const description = workWireTool('create_file').description;
    expect(description).toMatch(/DOCX, XLSX, PPTX, PDF/);
    expect(description).toMatch(/run_code/);
  });

  it('keeps charts and documents away from the image model', () => {
    expect(workWireTool('generate_image').description).toMatch(
      /Not for charts, diagrams or documents/,
    );
  });

  it('asks only for the pictures the turn’s image model takes', () => {
    const peers = { createFile: true, runCode: true };
    const imageTool = (image: ImageModelInputs) => {
      const { description, parameters } = workWireTool(
        'generate_image',
        peers,
        image,
      );
      if (!isRecord(parameters) || !isRecord(parameters.properties)) {
        throw new Error('schema is not an object');
      }
      return {
        description,
        required: parameters.required,
        inputImages: parameters.properties.inputImages,
      };
    };

    // A model that draws from the prompt alone is offered no picture, so a
    // call cannot pass one for the tool to refuse.
    const promptOnly = imageTool({ acceptsImageInput: false });
    expect(promptOnly.inputImages).toBeUndefined();
    expect(promptOnly.description).toMatch(
      /draws from the prompt alone: it cannot edit a picture/,
    );
    expect(promptOnly.description).not.toMatch(/[{}]/);

    // A model that takes pictures is offered as many as its catalog says,
    // and never more than Tale's own limit.
    expect(
      imageTool({ acceptsImageInput: true, maxReferenceImages: 3 }).inputImages,
    ).toMatchObject({
      maxItems: 3,
      description: expect.stringMatching(/: at most 3\.$/),
    });
    for (const image of [
      { acceptsImageInput: true },
      { acceptsImageInput: true, maxReferenceImages: 16 },
    ]) {
      expect(imageTool(image).inputImages).toMatchObject({
        maxItems: GENERATE_IMAGE_INPUTS_MAX,
      });
      expect(imageTool(image).inputImages).not.toHaveProperty('minItems');
      expect(imageTool(image).required).toEqual(['prompt']);
    }

    // A model that only edits needs a picture in every call.
    const edit = imageTool({ acceptsImageInput: true, minReferenceImages: 1 });
    expect(edit.inputImages).toMatchObject({
      minItems: 1,
      maxItems: GENERATE_IMAGE_INPUTS_MAX,
      description: expect.stringMatching(/: at least 1, at most 4\.$/),
    });
    expect(edit.required).toEqual(['prompt', 'inputImages']);
    expect(edit.description).toMatch(
      /every call needs at least 1 picture to start from in "inputImages"/,
    );

    // A catalog's least beyond its most, or beyond Tale's four, still states
    // a range a call can meet: a provider may refuse a schema that cannot.
    for (const image of [
      { acceptsImageInput: true, minReferenceImages: 3, maxReferenceImages: 2 },
      { acceptsImageInput: true, minReferenceImages: 6 },
    ]) {
      const { inputImages } = imageTool(image);
      if (!isRecord(inputImages)) throw new Error('no inputImages');
      expect(inputImages.minItems).toBe(inputImages.maxItems);
    }

    // Without a model, nothing is said of one.
    expect(schemaOf('generate_image').properties).toHaveProperty(
      'inputImages.maxItems',
      GENERATE_IMAGE_INPUTS_MAX,
    );
  });

  it('never points a description at a tool the turn is not offered', () => {
    const neither = { createFile: false, runCode: false };
    for (const name of WORK_TOOL_NAMES.filter(
      (tool) => tool !== 'use_workspace' && tool !== 'run_code',
    )) {
      const description = workWireTool(name, neither).description;
      expect(description).not.toMatch(/run_code|create_file/);
      expect(description).not.toMatch(/[{}]/);
    }
    expect(
      workWireTool('generate_image', { createFile: true, runCode: false })
        .description,
    ).toMatch(
      /Not for charts, diagrams or documents — write an SVG with create_file\./,
    );
    expect(
      workWireTool('load_skill', { createFile: true, runCode: false })
        .description,
    ).toMatch(/scripts cannot run here/);
  });

  it('names the Mermaid CLI and the headless Chromium run_code has, with their launch', () => {
    // Without them a model asked for a diagram as a PNG tried to download a
    // browser, which a sandbox's read-only root and egress filter refuse.
    const description = workWireTool('run_code').description;
    expect(description).toMatch(/mmdc, the Mermaid CLI, for diagrams as PNG/);
    expect(description).toMatch(/headless Chromium is installed/);
    expect(description).toMatch(/puppeteer launches it with no browser/);
    // The args the image's own mmdc launches that Chromium with.
    const mmdc = JSON.parse(
      readFileSync(
        path.resolve(
          path.dirname(fileURLToPath(import.meta.url)),
          '../../../sandbox-runtime/mmdc-puppeteer.json',
        ),
        'utf8',
      ),
    ) as { args: string[] };
    expect(description).toContain(
      `pass args [${mmdc.args.map((arg) => `'${arg}'`).join(', ')}]`,
    );
  });

  it('fills every slot of a description', () => {
    for (const name of WORK_TOOL_NAMES) {
      expect(workWireTool(name).description).not.toMatch(/[{}]/);
    }
  });

  it('bounds run_code by language and timeout', () => {
    const schema = schemaOf('run_code');
    const properties = schema.properties;
    if (!isRecord(properties)) throw new Error('no properties');
    const language = properties.language;
    const timeout = properties.timeoutSeconds;
    if (!isRecord(language) || !isRecord(timeout)) throw new Error('missing');
    expect(language.enum).toEqual([...RUN_CODE_LANGUAGES]);
    expect(timeout.maximum).toBe(RUN_CODE_MAX_TIMEOUT_SECONDS);
    expect(schema.required).toEqual(['language', 'code']);
  });
});
