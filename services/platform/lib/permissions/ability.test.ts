import { describe, expect, it } from 'vitest';

import { defineAbilityFor } from './ability';

describe('defineAbilityFor', () => {
  describe('knowledgeRead', () => {
    it.each(['owner', 'admin', 'developer', 'editor', 'member'])(
      'grants knowledgeRead to %s role',
      (role) => {
        const ability = defineAbilityFor(role);
        expect(ability.can('read', 'knowledgeRead')).toBe(true);
      },
    );

    it('denies knowledgeRead for disabled role', () => {
      const ability = defineAbilityFor('disabled');
      expect(ability.can('read', 'knowledgeRead')).toBe(false);
    });

    it('denies knowledgeRead for null role', () => {
      const ability = defineAbilityFor(null);
      expect(ability.can('read', 'knowledgeRead')).toBe(false);
    });
  });

  describe('knowledgeWrite', () => {
    it.each(['owner', 'admin', 'developer', 'editor'])(
      'grants knowledgeWrite to %s role',
      (role) => {
        const ability = defineAbilityFor(role);
        expect(ability.can('write', 'knowledgeWrite')).toBe(true);
      },
    );

    it('denies knowledgeWrite for member role', () => {
      const ability = defineAbilityFor('member');
      expect(ability.can('write', 'knowledgeWrite')).toBe(false);
    });

    it('denies knowledgeWrite for disabled role', () => {
      const ability = defineAbilityFor('disabled');
      expect(ability.can('write', 'knowledgeWrite')).toBe(false);
    });
  });

  describe('orgSettings', () => {
    it.each(['owner', 'admin'])(
      'grants orgSettings read to %s role',
      (role) => {
        const ability = defineAbilityFor(role);
        expect(ability.can('read', 'orgSettings')).toBe(true);
      },
    );

    it.each(['developer', 'editor', 'member', 'disabled'])(
      'denies orgSettings read for %s role',
      (role) => {
        const ability = defineAbilityFor(role);
        expect(ability.can('read', 'orgSettings')).toBe(false);
      },
    );
  });

  describe('developerSettings', () => {
    it.each(['owner', 'admin', 'developer'])(
      'grants developerSettings read to %s role',
      (role) => {
        const ability = defineAbilityFor(role);
        expect(ability.can('read', 'developerSettings')).toBe(true);
      },
    );

    it.each(['editor', 'member', 'disabled'])(
      'denies developerSettings read for %s role',
      (role) => {
        const ability = defineAbilityFor(role);
        expect(ability.can('read', 'developerSettings')).toBe(false);
      },
    );
  });

  describe('members', () => {
    it.each(['owner', 'admin'])('grants members write to %s role', (role) => {
      const ability = defineAbilityFor(role);
      expect(ability.can('write', 'members')).toBe(true);
    });

    it.each(['developer', 'editor', 'member', 'disabled'])(
      'denies members write for %s role',
      (role) => {
        const ability = defineAbilityFor(role);
        expect(ability.can('write', 'members')).toBe(false);
      },
    );
  });
});
