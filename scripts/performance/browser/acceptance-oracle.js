/** Installed verbatim by Playwright before navigation. Keep every dependency
 * inside this function. Stamps describe DOM readiness and a later rendering
 * opportunity, not compositor pixel completion. The fixture is English. */
export function installAcceptanceOracle() {
  if (window.__acceptance)
    throw new Error('Acceptance oracle already installed');
  const cardsSelector = '[role="region"] section button.line-clamp-2';
  const searchSelector =
    'input[type="text"][placeholder="Search tasks"][aria-label="Search tasks"]';
  const deadlineMs = 120000;
  const pathMatches = (path) => window.location.pathname === path;
  const assertPath = (path) => {
    if (typeof path !== 'string' || !path.startsWith('/') || /[?#]/.test(path))
      throw new Error('Expected an exact pathname');
  };
  const isBusy = (element) =>
    element.closest('[aria-busy="true"]') !== null ||
    element.querySelector('[aria-busy="true"]') !== null;
  const prepareBoard = (expected) => {
    assertPath(expected.path);
    if (
      typeof expected.searchValue !== 'string' ||
      !Array.isArray(expected.tasks) ||
      expected.tasks.some(
        (task) =>
          typeof task.title !== 'string' ||
          task.title.trim() !== task.title ||
          !task.title ||
          (task.assigneeName !== null &&
            (typeof task.assigneeName !== 'string' || !task.assigneeName)),
      )
    )
      throw new Error('Invalid expected board identity');
    const identities = expected.tasks
      .map((task) =>
        JSON.stringify([task.title, task.assigneeName ?? 'Unassigned']),
      )
      .sort();
    // Copy inputs: a caller cannot change the target while a watch is pending.
    return {
      path: expected.path,
      searchValue: expected.searchValue,
      identities,
    };
  };
  const boardCount = (expected) =>
    pathMatches(expected.path) &&
    document.querySelectorAll(cardsSelector).length ===
      expected.identities.length;
  const completeBoard = (expected) => {
    if (!boardCount(expected)) return false;
    const boards = document.querySelectorAll(
      '[role="region"][aria-label="Board"]',
    );
    const searches = document.querySelectorAll(searchSelector);
    if (boards.length !== 1 || searches.length !== 1) return false;
    const board = boards[0];
    const search = searches[0];
    if (
      isBusy(board) ||
      search.disabled ||
      search.value !== expected.searchValue
    )
      return false;
    const cards = [...document.querySelectorAll(cardsSelector)];
    const identities = [];
    for (const title of cards) {
      if (!board.contains(title)) return false;
      const avatars = title.parentElement?.querySelectorAll('[role="img"]');
      if (!avatars || avatars.length !== 1) return false;
      const avatar = avatars[0];
      const label = avatar.getAttribute('aria-label');
      if (!label || avatar.getAttribute('title') !== label) return false;
      identities.push(JSON.stringify([title.textContent.trim(), label]));
    }
    identities.sort();
    return identities.every(
      (identity, index) => identity === expected.identities[index],
    );
  };
  const prepareGeneral = (expected) => {
    assertPath(expected.path);
    if (typeof expected.projectName !== 'string' || !expected.projectName)
      throw new Error('Expected a project name');
    return { path: expected.path, projectName: expected.projectName };
  };
  const completeGeneral = (expected) => {
    if (!pathMatches(expected.path) || document.querySelector(cardsSelector))
      return false;
    const forms = document.querySelectorAll('#project-overview-identity-form');
    const fields = document.querySelectorAll('#project-overview-name');
    if (forms.length !== 1 || fields.length !== 1) return false;
    const form = forms[0];
    const field = fields[0];
    const fieldset = field.closest('fieldset');
    return (
      field instanceof HTMLInputElement &&
      fieldset !== null &&
      form.contains(fieldset) &&
      !field.matches(':disabled') &&
      !field.readOnly &&
      !isBusy(form) &&
      field.value === expected.projectName
    );
  };
  const watch = (ready, countReady, label, options, pollProperties = false) =>
    new Promise((resolve, reject) => {
      if (options?.requireFalse !== true) {
        reject(
          new Error('Acceptance watches require an initially false predicate'),
        );
        return;
      }
      if (ready()) {
        reject(
          new Error('Acceptance predicate was already true before the action'),
        );
        return;
      }
      let finished = false;
      let completeFrame;
      let countFrame;
      let countStarted = false;
      let completeStarted = false;
      let pollId;
      const frames = new Set();
      const channels = new Set();
      const cleanup = () => {
        observer.disconnect();
        clearTimeout(timer);
        cancelAnimationFrame(pollId);
        for (const id of frames) cancelAnimationFrame(id);
        for (const channel of channels) {
          channel.port1.close();
          channel.port2.close();
        }
        window.removeEventListener('pagehide', pagehide);
        document.removeEventListener('input', input);
        document.removeEventListener('change', input);
      };
      const fail = (error) => {
        if (finished) return;
        finished = true;
        cleanup();
        reject(error);
      };
      const finish = () => {
        if (!completeFrame || (countReady && !countFrame) || finished) return;
        finished = true;
        cleanup();
        resolve({
          ...completeFrame,
          label,
          ...(countFrame ? { countFrame } : {}),
        });
      };
      const stamp = (source, accept) => {
        const tDom = performance.now();
        const id = requestAnimationFrame(() => {
          frames.delete(id);
          if (finished) return;
          const tRaf = performance.now();
          const channel = new MessageChannel();
          channels.add(channel);
          channel.port1.addEventListener(
            'message',
            () => {
              channels.delete(channel);
              channel.port1.close();
              channel.port2.close();
              if (finished) return;
              accept({ source, tDom, tRaf, tFrame: performance.now() });
              finish();
            },
            { once: true },
          );
          channel.port1.start();
          channel.port2.postMessage(0);
        });
        frames.add(id);
      };
      const check = (source) => {
        if (finished) return;
        try {
          if (countReady && !countStarted && countReady()) {
            countStarted = true;
            stamp(source, (frame) => {
              countFrame = frame;
            });
          }
          if (!completeStarted && ready()) {
            completeStarted = true;
            stamp(source, (frame) => {
              // Transient DOM readiness that disappears before the rendering
              // opportunity cannot certify a complete board or destination.
              if (ready()) completeFrame = frame;
              else completeStarted = false;
            });
          }
        } catch (error) {
          fail(error);
        }
      };
      const observer = new MutationObserver(() => check('mutation'));
      const timer = setTimeout(
        () => fail(new Error('Acceptance readiness exceeded 120 seconds')),
        deadlineMs,
      );
      const pagehide = () =>
        fail(new Error('Acceptance document was replaced'));
      const input = () => check('input');
      window.addEventListener('pagehide', pagehide, { once: true });
      document.addEventListener('input', input);
      document.addEventListener('change', input);
      observer.observe(document, {
        subtree: true,
        childList: true,
        attributes: true,
        characterData: true,
      });
      // React may update input.value without mutating an attribute. Polling is
      // bounded with the same lifecycle as the mutation observer.
      const poll = () => {
        check('animation-frame');
        if (!finished) pollId = requestAnimationFrame(poll);
      };
      if (pollProperties) pollId = requestAnimationFrame(poll);
      check('initial');
    });
  window.__acceptance = {
    boardState: (expected) => completeBoard(prepareBoard(expected)),
    generalState: (expected) => completeGeneral(prepareGeneral(expected)),
    watchBoard: (expected, options) => {
      const target = prepareBoard(expected);
      return watch(
        () => completeBoard(target),
        () => boardCount(target),
        'board-complete',
        options,
      );
    },
    watchGeneral: (expected, options) => {
      const target = prepareGeneral(expected);
      return watch(
        () => completeGeneral(target),
        undefined,
        'general-complete',
        options,
        true,
      );
    },
  };
}
