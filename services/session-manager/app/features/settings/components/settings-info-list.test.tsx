import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { renderApp } from '@/tests/utils/render';

import { InfoList, InfoRow } from './settings-info-list';

describe('InfoList', () => {
  it('reads as names and values', async () => {
    const view = renderApp(
      <InfoList>
        <InfoRow label="Version">1.2.3</InfoRow>
        <InfoRow label="Browser">Camoufox 1</InfoRow>
      </InfoList>,
    );

    expect(screen.getAllByRole('term').map((term) => term.textContent)).toEqual(
      ['Version', 'Browser'],
    );
    expect(
      screen.getAllByRole('definition').map((value) => value.textContent),
    ).toEqual(['1.2.3', 'Camoufox 1']);
    await checkAccessibility(view);
  });
});
