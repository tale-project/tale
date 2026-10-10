import { describe, expect, it } from 'vitest';

import { deMessages, enMessages, frMessages } from '@/tests/utils/messages';

// #4453: panel-specific translations must name the same capabilities as
// the equipment editor, rather than the separate Governance competences feature.
const cases = [
  { locale: 'en', messages: enMessages, tools: 'Platform tools' },
  { locale: 'de', messages: deMessages, tools: 'Plattform-Tools' },
  { locale: 'fr', messages: frMessages, tools: 'Outils de la plateforme' },
];

describe('agent details terminology', () => {
  for (const { locale, messages, tools } of cases) {
    it(`${locale}: uses the shipped skills, connectors and platform tools labels`, () => {
      const panel = messages.projects.agents;
      const equipment = messages.chat.skills;
      expect(panel.detailsSkills).toBe('Skills');
      expect(panel.detailsConnectors).toBe('Connectors');
      expect(panel.detailsTools).toBe(tools);
      expect(panel.detailsSkills).toBe(equipment.sectionSkills);
      expect(panel.detailsConnectors).toBe(equipment.sectionConnectors);
      expect(panel.detailsTools).toBe(equipment.sectionTools);
    });
  }

  it('fr: names skills in the saved snapshot without borrowing the competences feature name', () => {
    expect(frMessages.projects.agents.detailsStandardSnapshot).toBe(
      'Configuration enregistrée. L’agent standard détermine à nouveau son modèle, ses skills et ses instructions au démarrage de chaque exécution.',
    );
    expect(frMessages.projects.agents.detailsSkills).not.toBe(
      frMessages.governance.competences.title,
    );
  });
});
