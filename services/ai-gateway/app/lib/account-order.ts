import {
  ACCOUNT_STATES,
  type AccountState,
  type AccountView,
  type ProviderId,
} from '@/app/lib/api';

/**
 * The order the pool reads in: vendor, then what each account is doing, then
 * who comes back first.
 *
 * An operator opens this screen to answer "how is my Claude pool doing", which
 * rows sitting by vendor, and inside a vendor by state, answer in one glance:
 * the accounts that can take work first, then the ones waiting on a reset —
 * soonest back at the top of that band — and last the ones that need a person.
 * Inside a state the accounts go by address rather than label, so a renamed
 * account stays where its e-mail says it belongs.
 *
 * Every comparison but the vendor and the state is in the reader's own locale,
 * so an umlaut sorts where that reader expects it.
 */
export function compareAccounts(
  providers: readonly ProviderId[],
  locale: string,
): (a: AccountView, b: AccountView) => number {
  const providerRank = (id: ProviderId) => {
    const index = providers.indexOf(id);
    // A provider the catalog no longer offers still has rows; park them
    // after the ones it does rather than at the top.
    return index === -1 ? providers.length : index;
  };
  const stateRank = (state: AccountState) => ACCOUNT_STATES.indexOf(state);
  // No known return sorts after every known one: it is the account that can
  // be promised the least.
  const returnAt = (account: AccountView) =>
    account.state === 'limited' && account.limitedUntil
      ? Date.parse(account.limitedUntil)
      : Number.POSITIVE_INFINITY;

  return (a, b) => {
    const byProvider = providerRank(a.provider) - providerRank(b.provider);
    if (byProvider !== 0) return byProvider;

    const byState = stateRank(a.state) - stateRank(b.state);
    if (byState !== 0) return byState;

    const aReturn = returnAt(a);
    const bReturn = returnAt(b);
    if (aReturn !== bReturn) return aReturn < bReturn ? -1 : 1;

    return (a.accountEmail ?? a.label).localeCompare(
      b.accountEmail ?? b.label,
      locale,
      { sensitivity: 'base' },
    );
  };
}
