'use client';

import { useMemo } from 'react';

import { inferSchema, type SchemaTreeSchema } from '../../../data/infer-schema';
import { SchemaTree } from '../schema-tree';
import { compareShape, shapePathKey } from './shape-compare';

/** How a value's shape is read for the view: lists by their first hundred
 *  items, eight levels deep, two hundred fields per object. */
const SHAPE_LIMITS = {
  sampleItems: 100,
  maxDepth: 8,
  maxProperties: 200,
  maxNodes: 2000,
} as const;

export interface ShapeViewProps {
  value: unknown;
  /** The shape the value should have: fields that differ are marked, in
   *  words and with a glyph, and required fields it lacks are listed. */
  expected?: SchemaTreeSchema | null;
  /** "in 9 of 12 items" for a field only some items hold: on. */
  counts?: boolean;
  'aria-label': string;
  density?: 'compact' | 'comfortable';
  className?: string;
}

/**
 * The fields a value has, read from the value itself — a `SchemaTree` of
 * its inferred shape: each field's kind in words, how often the items of a
 * list hold it, and, against an `expected` shape, what differs.
 */
export function ShapeView({
  value,
  expected,
  counts = true,
  'aria-label': ariaLabel,
  density = 'comfortable',
  className,
}: ShapeViewProps) {
  const actual = useMemo(() => inferSchema(value, SHAPE_LIMITS), [value]);
  const comparison = useMemo(
    () =>
      expected === undefined || expected === null
        ? null
        : compareShape(expected, actual),
    [expected, actual],
  );
  return (
    <SchemaTree
      schema={comparison?.schema ?? actual}
      density={density}
      counts={counts}
      marks={
        comparison === null
          ? undefined
          : (path) => comparison.marks.get(shapePathKey(path))
      }
      aria-label={ariaLabel}
      className={className}
    />
  );
}
