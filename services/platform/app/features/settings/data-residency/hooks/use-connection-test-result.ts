import { useCallback, useEffect, useRef, useState } from 'react';
import type { FieldValues, UseFormReturn } from 'react-hook-form';

interface ConnectionTestResult {
  ok: boolean;
  message?: string;
}

export function useConnectionTestResult<Values extends FieldValues>(
  form: UseFormReturn<Values>,
  organizationId: string,
) {
  const [testResult, setTestResult] = useState<ConnectionTestResult>();
  const revision = useRef(0);

  const clearTestResult = useCallback(() => {
    revision.current += 1;
    setTestResult(undefined);
  }, []);

  useEffect(() => {
    clearTestResult();
    const subscription = form.watch(clearTestResult);
    return () => {
      revision.current += 1;
      subscription.unsubscribe();
    };
  }, [form, organizationId, clearTestResult]);

  const beginTest = useCallback(() => {
    clearTestResult();
    const testedRevision = revision.current;
    return (result: ConnectionTestResult) => {
      if (revision.current === testedRevision) setTestResult(result);
    };
  }, [clearTestResult]);

  return { testResult, clearTestResult, beginTest };
}
