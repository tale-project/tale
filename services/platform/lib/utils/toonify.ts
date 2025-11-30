/**
 * toonify - Convert workflow data object/string to compact toon format
 * Useful for attaching context to automation-assistant messages
 */

/**
 * Serialize a value for toon format
 * Objects become single-quoted JSON, booleans become 0/1
 */
const serializeValue = (value: any): string => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    return JSON.stringify(value).replace(/"/g, "'");
  }
  if (typeof value === 'boolean') return value ? '1' : '0';
  return String(value);
};

interface WorkflowStep {
  [key: string]: any;
  organizationId: string;
  wfDefinitionId: string;
}

interface WorkflowData {
  steps: WorkflowStep[];
}

/**
 * Convert workflow data to toon format
 * @param data - Input data object or JSON string with steps array
 * @param fields - Fields to include (default: standard fields)
 * @returns Formatted toon output string
 */
export function toonify(
  data: WorkflowData | string,
  fields?: string[],
): string {
  // Parse if string input
  const parsedData: WorkflowData =
    typeof data === 'string' ? JSON.parse(data) : data;

  if (
    !parsedData.steps ||
    !Array.isArray(parsedData.steps) ||
    parsedData.steps.length === 0
  ) {
    throw new Error('Invalid data: must contain non-empty steps array');
  }

  const firstStep = parsedData.steps[0];
  const organizationId = firstStep.organizationId;
  const wfDefinitionId = firstStep.wfDefinitionId;

  // Default fields if not specified
  const selectedFields = fields || [
    '_creationTime',
    '_id',
    'config',
    'name',
    'nextSteps',
    'stepSlug',
    'stepType',
  ];

  const fieldList = selectedFields.join(',');

  // Build output
  let output = `organizationId: ${organizationId}\n`;
  output += `wfDefinitionId: ${wfDefinitionId}\n`;
  output += `steps[${parsedData.steps.length}]{${fieldList}}:\n`;

  // Add each step as a row
  parsedData.steps.forEach((step) => {
    const values = selectedFields.map((field) => serializeValue(step[field]));
    output += `  ${values.join(',')}\n`;
  });

  return output;
}
