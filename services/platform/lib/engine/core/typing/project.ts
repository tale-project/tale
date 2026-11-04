/**
 * Projection: a value cut down to the members its shape declares.
 *
 * A connector action declares its output as a signature (`signature.ts`),
 * and the dispatcher hands on only what the signature declares: whatever a
 * service adds to its answer, now or later, stays behind (`CONN-R36`). An
 * object the shape lists keeps only its listed members, at every depth —
 * array items, record values, the object branches of a union. An open shape
 * (`object`, `unknown`, `any`) hands its value on as it is. A string, number,
 * boolean or null carries no members and passes unchanged: projection cuts,
 * it never validates.
 *
 * A union takes the branches whose kind admits the value's. When one of them
 * is open, the value passes; otherwise a member survives only where some
 * taken branch declares it, and its value is projected onto every declaring
 * branch together. Those are kept as a flat list of alternatives rather than
 * built with `union()`, whose cap would turn a wide union into UNKNOWN and
 * open it. An object that no branch admits keeps no member, since no branch
 * declares one.
 *
 * Values are JSON data: an array by its items, any other object by its own
 * enumerable keys. The recursion follows the shape, so it goes no deeper
 * than the signature, whose reader caps nesting. Pure: it returns new
 * objects and never edits its arguments.
 */

import { isClosed, kindsOf, membersOf, type Shape } from './shape';

/** `value` with every member `shape` does not declare left out. */
export function projectOntoShape(value: unknown, shape: Shape): unknown {
  return project(value, alternativesOf([shape]));
}

/**
 * The places of `shape` whose value the projection hands on whole, as paths
 * from `$`: `.name` a member, `[]` an array's items, `{}` a record's values.
 * The connector catalog gives each of its own a reason (`CONN-R36`).
 */
export function openPlacesOf(shape: Shape): string[] {
  const places = new Set<string>();
  collectOpenPlaces(alternativesOf([shape]), '$', places);
  return [...places];
}

function collectOpenPlaces(
  alternatives: readonly Shape[],
  at: string,
  places: Set<string>,
): void {
  for (const alternative of alternatives) {
    const kinds = kindsOf(alternative);
    if (kinds === null) {
      places.add(at);
      continue;
    }
    if (kinds.has('array')) {
      if (alternative.items === undefined) places.add(at);
      else {
        collectOpenPlaces(
          alternativesOf([alternative.items]),
          `${at}[]`,
          places,
        );
      }
    }
    if (!kinds.has('object')) continue;
    if (isOpen(alternative)) {
      places.add(at);
      continue;
    }
    for (const [key, member] of Object.entries(alternative.properties ?? {})) {
      collectOpenPlaces(alternativesOf([member]), `${at}.${key}`, places);
    }
    if (typeof alternative.additionalProperties === 'object') {
      collectOpenPlaces(
        alternativesOf([alternative.additionalProperties]),
        `${at}{}`,
        places,
      );
    }
  }
}

function alternativesOf(shapes: readonly Shape[]): Shape[] {
  return shapes.flatMap((shape) =>
    shape.anyOf === undefined ? [shape] : alternativesOf(membersOf(shape)),
  );
}

function project(value: unknown, alternatives: readonly Shape[]): unknown {
  if (value === null || typeof value !== 'object') return value;
  const kind = Array.isArray(value) ? 'array' : 'object';
  const taken: Shape[] = [];
  for (const alternative of alternatives) {
    const kinds = kindsOf(alternative);
    // A shape that admits anything (`unknown`, `any`) leaves nothing out.
    if (kinds === null) return value;
    if (kinds.has(kind)) taken.push(alternative);
  }
  return Array.isArray(value)
    ? projectItems(value, taken)
    : projectMembers(value, taken);
}

function projectItems(value: readonly unknown[], taken: readonly Shape[]) {
  const items: Shape[] = [];
  for (const branch of taken) {
    // An array whose items are not described holds anything.
    if (branch.items === undefined) return value;
    items.push(branch.items);
  }
  const alternatives = alternativesOf(items);
  return value.map((item) => project(item, alternatives));
}

function projectMembers(value: object, taken: readonly Shape[]): unknown {
  // `object`, or an object shape that does not list every key it can have.
  if (taken.some(isOpen)) return value;
  const kept: Array<[string, unknown]> = [];
  for (const [key, member] of Object.entries(value)) {
    const declared: Shape[] = [];
    for (const branch of taken) {
      if (
        branch.properties !== undefined &&
        Object.hasOwn(branch.properties, key)
      ) {
        declared.push(branch.properties[key]);
      } else if (typeof branch.additionalProperties === 'object') {
        declared.push(branch.additionalProperties);
      }
    }
    if (declared.length > 0) {
      kept.push([key, project(member, alternativesOf(declared))]);
    }
  }
  // `fromEntries` defines each key as data, so a member named `__proto__`
  // stays a member and never becomes the result's prototype.
  return Object.fromEntries(kept);
}

function isOpen(branch: Shape): boolean {
  return typeof branch.additionalProperties !== 'object' && !isClosed(branch);
}
