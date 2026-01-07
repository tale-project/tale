import jexl from 'jexl';
import {
  first,
  get,
  isArray,
  isString,
  join,
  last,
  map,
  orderBy,
  reverse as lodashReverse,
  size,
  slice as lodashSlice,
  toNumber,
  toString,
  toLower,
  toUpper,
  trim,
} from 'lodash';

/**
 * Configure JEXL instance with custom transforms for workflow use cases
 */
export const jexlInstance = new jexl.Jexl();

// Add custom transforms for common string operations
jexlInstance.addTransform('upper', (val: string) => toUpper(toString(val)));
jexlInstance.addTransform('lower', (val: string) => toLower(toString(val)));
jexlInstance.addTransform('trim', (val: string) => trim(toString(val)));
jexlInstance.addTransform('length', (val: string | unknown[]) => {
  if (isString(val) || isArray(val)) {
    return size(val);
  }
  return 0;
});

// Add custom transforms for array operations
jexlInstance.addTransform('first', (arr: unknown[]) => {
  return first(arr);
});
jexlInstance.addTransform('last', (arr: unknown[]) => {
  return last(arr);
});
jexlInstance.addTransform('join', (arr: unknown[], separator = ',') => {
  return isArray(arr) ? join(arr, toString(separator)) : '';
});

// Add custom transforms for type conversion
jexlInstance.addTransform('string', (val: unknown) => {
  // For objects and arrays, use JSON.stringify to get proper string representation
  if (val !== null && typeof val === 'object') {
    return JSON.stringify(val);
  }
  return toString(val);
});
jexlInstance.addTransform('number', (val: unknown) => toNumber(val));
jexlInstance.addTransform('boolean', (val: unknown) => Boolean(val));

// Add custom transforms for advanced array operations using lodash
jexlInstance.addTransform('map', (arr: unknown[], fieldPath: string) => {
  if (!isArray(arr)) return [];
  // Use lodash map with get for clean, reliable field extraction
  return map(arr, (item) => get(item, fieldPath)).filter(
    (val) => val !== undefined,
  );
});

// Add transforms for advanced array operations
jexlInstance.addTransform('filter', (arr: unknown[], condition: string) => {
  // Filter array based on a simple condition
  if (!isArray(arr)) return [];

  return arr.filter((item) => {
    if (!item || typeof item !== 'object') return false;

    try {
      // Parse simple conditions like "field > value" or "field.nested > value"
      const match = condition.match(/^(.+?)\s*(>|<|>=|<=|==|!=)\s*(.+)$/);
      if (!match) return false;

      const [, fieldPath, operator, valueStr] = match;
      const fieldValue = get(item as Record<string, unknown>, fieldPath.trim());
      const compareValue = parseFloat(valueStr.trim());

      if (fieldValue === undefined || fieldValue === null) return false;

      const numValue =
        typeof fieldValue === 'number'
          ? fieldValue
          : parseFloat(String(fieldValue));
      if (isNaN(numValue) || isNaN(compareValue)) return false;

      switch (operator) {
        case '>':
          return numValue > compareValue;
        case '<':
          return numValue < compareValue;
        case '>=':
          return numValue >= compareValue;
        case '<=':
          return numValue <= compareValue;
        case '==':
          return numValue === compareValue;
        case '!=':
          return numValue !== compareValue;
        default:
          return false;
      }
    } catch {
      return false;
    }
  });
});

jexlInstance.addTransform('flatten', (arr: unknown[]) => {
  // Flatten nested arrays one level deep
  if (!isArray(arr)) return [];
  return arr.reduce((acc: unknown[], val) => {
    if (isArray(val)) {
      return acc.concat(val);
    }
    return acc.concat([val]);
  }, []);
});

jexlInstance.addTransform('unique', (arr: unknown[]) => {
  // Remove duplicate values from array
  if (!isArray(arr)) return [];
  return [...new Set(arr.map((item) => toString(item)))];
});

jexlInstance.addTransform('concat', (arr1: unknown[], arr2: unknown[]) => {
  // Concatenate two arrays
  if (!isArray(arr1)) arr1 = [];
  if (!isArray(arr2)) arr2 = [];
  return arr1.concat(arr2);
});

jexlInstance.addTransform('parseJSON', (str: string) => {
  // Parse JSON string safely
  try {
    return JSON.parse(toString(str));
  } catch {
    return null;
  }
});

// Simplified formatList for basic templating needs
jexlInstance.addTransform(
  'formatList',
  (arr: unknown[], template: string, separator = '\n') => {
    // Simple template formatting for arrays
    if (!isArray(arr)) return '';

    const formatted = map(arr, (item) => {
      if (!item || typeof item !== 'object') return toString(item);

      // Simple template replacement: "Product: {name}, Price: {price}"
      return template.replace(/\{([^}]+)\}/g, (_, key) => {
        const value = get(item as Record<string, unknown>, key);
        return value != null ? toString(value) : '';
      });
    });

    return formatted
      .filter((item) => item.trim() !== '')
      .join(toString(separator));
  },
);

// Add find transform to find an object in array by field value
jexlInstance.addTransform(
  'find',
  (arr: unknown[], fieldPath: string, value: unknown) => {
    if (!isArray(arr)) return null;

    return arr.find((item) => {
      if (!item || typeof item !== 'object') return false;
      const fieldValue = get(item as Record<string, unknown>, fieldPath);
      return fieldValue === value;
    });
  },
);

// Add filterBy transform to filter array by field value (supports any value type)
jexlInstance.addTransform(
  'filterBy',
  (arr: unknown[], fieldPath: string, value: unknown) => {
    if (!isArray(arr)) return [];

    return arr.filter((item) => {
      if (!item || typeof item !== 'object') return false;
      const fieldValue = get(item as Record<string, unknown>, fieldPath);
      return fieldValue === value;
    });
  },
);

// Add hasOverlap transform to check if two arrays have any common elements
jexlInstance.addTransform('hasOverlap', (arr1: unknown[], arr2: unknown[]) => {
  // Check if two arrays have any overlapping values (array intersection)
  if (!isArray(arr1) || !isArray(arr2)) return false;

  // Convert to strings for comparison to handle different types
  const set1 = new Set(arr1.map((item) => toString(item)));
  return arr2.some((item) => set1.has(toString(item)));
});

// Add sort transform to sort arrays by a field
jexlInstance.addTransform(
  'sort',
  (arr: unknown[], fieldPath: string, order: 'asc' | 'desc' = 'asc') => {
    // Sort array by a field path
    if (!isArray(arr)) return [];

    // Use lodash orderBy for robust sorting
    return orderBy(
      arr,
      [(item) => get(item as Record<string, unknown>, fieldPath)],
      [order],
    );
  },
);

// Add reverse transform to reverse arrays
jexlInstance.addTransform('reverse', (arr: unknown[]) => {
  // Reverse array order
  if (!isArray(arr)) return [];
  return lodashReverse([...arr]); // Clone to avoid mutating original
});

// Add slice transform to extract a portion of an array
jexlInstance.addTransform(
  'slice',
  (arr: unknown[], start: number, end?: number) => {
    // Extract a portion of an array
    if (!isArray(arr)) return [];
    return lodashSlice(arr, start, end);
  },
);

// =============================================================================
// Date/Time Transforms for Filtering
// =============================================================================

/**
 * Helper to safely parse a date value (string, number, or Date)
 * Returns timestamp in milliseconds, or NaN if invalid.
 *
 * Handles both seconds and milliseconds timestamps:
 * - Timestamps < 1e11 (before year 5138 in seconds, or year 1973 in ms) are treated as seconds
 * - This heuristic works because reasonable timestamps are always > 1e12 in milliseconds
 */
function parseDateValue(val: unknown): number {
  if (val === null || val === undefined) return NaN;

  let timestamp: number;
  if (typeof val === 'number') {
    timestamp = val;
  } else if (val instanceof Date) {
    return val.getTime(); // Date objects are always in milliseconds
  } else if (typeof val === 'string') {
    timestamp = new Date(val).getTime();
    if (isNaN(timestamp)) return NaN;
    return timestamp; // String parsing via Date constructor returns milliseconds
  } else {
    return NaN;
  }

  // Heuristic: if timestamp is less than 1e11, it's likely in seconds
  // 1e11 ms = March 1973, so any valid recent timestamp in ms will be > 1e12
  // 1e11 s = year 5138, so any valid seconds timestamp will be < 1e11
  if (timestamp > 0 && timestamp < 1e11) {
    timestamp *= 1000; // Convert seconds to milliseconds
  }

  return timestamp;
}

// Calculate days since a given date
jexlInstance.addTransform('daysAgo', (dateVal: unknown) => {
  const timestamp = parseDateValue(dateVal);
  if (isNaN(timestamp)) return -1; // Return -1 for invalid dates
  return Math.floor((Date.now() - timestamp) / (24 * 60 * 60 * 1000));
});

// Calculate hours since a given date
jexlInstance.addTransform('hoursAgo', (dateVal: unknown) => {
  const timestamp = parseDateValue(dateVal);
  if (isNaN(timestamp)) return -1;
  return Math.floor((Date.now() - timestamp) / (60 * 60 * 1000));
});

// Calculate minutes since a given date
jexlInstance.addTransform('minutesAgo', (dateVal: unknown) => {
  const timestamp = parseDateValue(dateVal);
  if (isNaN(timestamp)) return -1;
  return Math.floor((Date.now() - timestamp) / (60 * 1000));
});

// Parse date string to timestamp (milliseconds)
jexlInstance.addTransform('parseDate', (dateVal: unknown) => {
  const timestamp = parseDateValue(dateVal);
  return isNaN(timestamp) ? null : timestamp;
});

// Check if a date is before another date (or days ago)
jexlInstance.addTransform(
  'isBefore',
  (dateVal: unknown, compareVal: unknown) => {
    const timestamp = parseDateValue(dateVal);
    const compareTimestamp = parseDateValue(compareVal);
    if (isNaN(timestamp) || isNaN(compareTimestamp)) return false;
    return timestamp < compareTimestamp;
  },
);

// Check if a date is after another date
jexlInstance.addTransform(
  'isAfter',
  (dateVal: unknown, compareVal: unknown) => {
    const timestamp = parseDateValue(dateVal);
    const compareTimestamp = parseDateValue(compareVal);
    if (isNaN(timestamp) || isNaN(compareTimestamp)) return false;
    return timestamp > compareTimestamp;
  },
);

