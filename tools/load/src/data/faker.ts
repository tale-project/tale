/**
 * Faker for tens of thousands of users without tens of thousands of Fakers.
 *
 * One process holds ONE Faker per locale. A user borrows it through
 * {@link UserFaker.get}, which reseeds it from the user's own random stream
 * first; generation is synchronous, so nothing else can touch the instance
 * between the reseed and the user's calls, and each user's data stays a
 * pure function of its seed. A Faker per user would cost megabytes each.
 */

import type { Faker } from '@faker-js/faker';
import { faker as fakerDe } from '@faker-js/faker/locale/de';
import { faker as fakerEn } from '@faker-js/faker/locale/en';
import { faker as fakerFr } from '@faker-js/faker/locale/fr';

import { type Random, pickWeighted, seedFrom } from './random.ts';

export const DATA_LOCALES = ['en', 'de', 'fr'] as const;
export type DataLocale = (typeof DATA_LOCALES)[number];

const FAKERS: Readonly<Record<DataLocale, Faker>> = {
  en: fakerEn,
  de: fakerDe,
  fr: fakerFr,
};

/** The language mix of the population: an English-first Swiss customer base. */
const LOCALE_WEIGHTS: readonly (readonly [DataLocale, number])[] = [
  ['en', 55],
  ['de', 30],
  ['fr', 15],
];

/** The language a user writes in, drawn once per user. */
export function drawLocale(random: Random): DataLocale {
  return pickWeighted(random, LOCALE_WEIGHTS) ?? 'en';
}

export class UserFaker {
  readonly locale: DataLocale;
  readonly #random: Random;

  constructor(random: Random, locale: DataLocale) {
    this.#random = random;
    this.locale = locale;
  }

  /**
   * The process's Faker for `locale` (default: the user's), reseeded from
   * this user's stream. Use it synchronously: an `await` between this call
   * and the generation would let another user reseed it.
   */
  get(locale: DataLocale = this.locale): Faker {
    const faker = FAKERS[locale];
    faker.seed(seedFrom(this.#random));
    return faker;
  }
}
