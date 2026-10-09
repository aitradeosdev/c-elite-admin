import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

type Listener = (e: unknown) => void;

function installFakeDocument(initialOverflow = '') {
  const listeners = new Map<string, Set<Listener>>();
  const doc = {
    body: { style: { overflow: initialOverflow } },
    activeElement: null as unknown,
    addEventListener(type: string, fn: Listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener(type: string, fn: Listener) {
      listeners.get(type)?.delete(fn);
    },
    listenerCount(type: string) {
      return listeners.get(type)?.size ?? 0;
    },
  };
  (globalThis as unknown as { document: typeof doc }).document = doc;
  return doc;
}

function fakeRoot(): HTMLElement {
  return {
    querySelectorAll: () => [],
    contains: () => false,
    focus: () => {},
  } as unknown as HTMLElement;
}

function keyEvent(key: string) {
  let prevented = false;
  let stopped = false;
  return {
    key,
    shiftKey: false,
    preventDefault: () => { prevented = true; },
    stopPropagation: () => { stopped = true; },
    get prevented() { return prevented; },
    get stopped() { return stopped; },
  } as unknown as KeyboardEvent & { prevented: boolean; stopped: boolean };
}

const stackMod = await import('../app/_ui/overlayStack.ts');
const { pushOverlay, popOverlay, overlayDepth, isTopmostTrap, handleOverlayKeyDown, topmostOverlay } = stackMod;

function drain() {
  while (overlayDepth() > 0) popOverlay(topmostOverlay()!.id);
}

describe('scroll lock', () => {
  beforeEach(() => { drain(); });

  test('one overlay locks scroll and restores it on close', () => {
    const doc = installFakeDocument('');
    const id = pushOverlay(fakeRoot(), () => {});
    assert.equal(doc.body.style.overflow, 'hidden');
    popOverlay(id);
    assert.equal(doc.body.style.overflow, '');
  });

  test('the original overflow value is preserved, not assumed empty', () => {
    const doc = installFakeDocument('auto');
    const id = pushOverlay(fakeRoot(), () => {});
    popOverlay(id);
    assert.equal(doc.body.style.overflow, 'auto');
  });

  test('stacked overlays closed innermost-first restore scroll', () => {
    const doc = installFakeDocument('');
    const drawer = pushOverlay(fakeRoot(), () => {});
    const viewer = pushOverlay(fakeRoot(), () => {});
    popOverlay(viewer);
    assert.equal(doc.body.style.overflow, 'hidden', 'drawer still open, scroll must stay locked');
    popOverlay(drawer);
    assert.equal(doc.body.style.overflow, '');
  });

  test('REGRESSION: stacked overlays closed outermost-first still restore scroll', () => {
    const doc = installFakeDocument('');
    const drawer = pushOverlay(fakeRoot(), () => {});
    const viewer = pushOverlay(fakeRoot(), () => {});
    popOverlay(drawer);
    assert.equal(doc.body.style.overflow, 'hidden', 'viewer still open, scroll must stay locked');
    popOverlay(viewer);
    assert.equal(doc.body.style.overflow, '', 'page was left permanently unscrollable before the fix');
  });

  test('popping an unknown id is harmless', () => {
    const doc = installFakeDocument('');
    const id = pushOverlay(fakeRoot(), () => {});
    popOverlay(999999);
    assert.equal(doc.body.style.overflow, 'hidden');
    popOverlay(id);
    assert.equal(doc.body.style.overflow, '');
  });

  test('double-pop of the same id does not corrupt the lock', () => {
    const doc = installFakeDocument('');
    const a = pushOverlay(fakeRoot(), () => {});
    const b = pushOverlay(fakeRoot(), () => {});
    popOverlay(b);
    popOverlay(b);
    assert.equal(doc.body.style.overflow, 'hidden');
    popOverlay(a);
    assert.equal(doc.body.style.overflow, '');
  });
});

describe('escape routing', () => {
  beforeEach(() => { drain(); });

  test('REGRESSION: Escape closes only the topmost overlay', () => {
    installFakeDocument('');
    const closed: string[] = [];
    pushOverlay(fakeRoot(), () => closed.push('drawer'));
    pushOverlay(fakeRoot(), () => closed.push('viewer'));
    handleOverlayKeyDown(keyEvent('Escape'));
    assert.deepEqual(closed, ['viewer'], 'before the fix both layers closed on one keypress');
  });

  test('after the top closes, the next Escape reaches the layer below', () => {
    installFakeDocument('');
    const closed: string[] = [];
    pushOverlay(fakeRoot(), () => closed.push('drawer'));
    const viewer = pushOverlay(fakeRoot(), () => closed.push('viewer'));
    handleOverlayKeyDown(keyEvent('Escape'));
    popOverlay(viewer);
    handleOverlayKeyDown(keyEvent('Escape'));
    assert.deepEqual(closed, ['viewer', 'drawer']);
  });

  test('Escape is consumed so page-level handlers do not also react', () => {
    installFakeDocument('');
    pushOverlay(fakeRoot(), () => {});
    const e = keyEvent('Escape');
    handleOverlayKeyDown(e);
    assert.equal(e.prevented, true);
    assert.equal(e.stopped, true);
  });

  test('other keys are not swallowed', () => {
    installFakeDocument('');
    const closed: string[] = [];
    pushOverlay(fakeRoot(), () => closed.push('x'));
    const e = keyEvent('a');
    handleOverlayKeyDown(e);
    assert.deepEqual(closed, []);
    assert.equal(e.stopped, false);
  });

  test('with no overlay open, Escape does nothing', () => {
    installFakeDocument('');
    const e = keyEvent('Escape');
    handleOverlayKeyDown(e);
    assert.equal(e.prevented, false);
  });
});

describe('non-locking, non-trapping layers (popovers)', () => {
  beforeEach(() => { drain(); });

  test('a popover alone does not lock page scroll', () => {
    const doc = installFakeDocument('');
    const id = pushOverlay(fakeRoot(), () => {}, { lockScroll: false, trapFocus: false });
    assert.equal(doc.body.style.overflow, '', 'opening a dropdown must not freeze the page');
    popOverlay(id);
    assert.equal(doc.body.style.overflow, '');
  });

  test('a popover inside a drawer keeps the drawer lock and does not release it early', () => {
    const doc = installFakeDocument('');
    const drawer = pushOverlay(fakeRoot(), () => {});
    const pop = pushOverlay(fakeRoot(), () => {}, { lockScroll: false, trapFocus: false });
    popOverlay(pop);
    assert.equal(doc.body.style.overflow, 'hidden', 'closing the popover must not unlock the drawer');
    popOverlay(drawer);
    assert.equal(doc.body.style.overflow, '');
  });

  test('closing the drawer while its popover is still registered restores scroll exactly once', () => {
    const doc = installFakeDocument('auto');
    const drawer = pushOverlay(fakeRoot(), () => {});
    const pop = pushOverlay(fakeRoot(), () => {}, { lockScroll: false, trapFocus: false });
    popOverlay(drawer);
    assert.equal(doc.body.style.overflow, 'auto', 'the only locking layer is gone, so restore');
    popOverlay(pop);
    assert.equal(doc.body.style.overflow, 'auto', 'a non-locking pop must not overwrite the restored value');
  });

  test('Escape closes the popover before the drawer it sits in', () => {
    installFakeDocument('');
    const closed: string[] = [];
    pushOverlay(fakeRoot(), () => closed.push('drawer'));
    const pop = pushOverlay(fakeRoot(), () => closed.push('popover'), { lockScroll: false, trapFocus: false });
    handleOverlayKeyDown(keyEvent('Escape'));
    assert.deepEqual(closed, ['popover']);
    popOverlay(pop);
    handleOverlayKeyDown(keyEvent('Escape'));
    assert.deepEqual(closed, ['popover', 'drawer']);
  });

  test('focus containment falls through to the nearest trapping layer', () => {
    installFakeDocument('');
    const drawerRoot = fakeRoot();
    pushOverlay(drawerRoot, () => {});
    pushOverlay(fakeRoot(), () => {}, { lockScroll: false, trapFocus: false });
    assert.equal(stackMod.topmostTrap()?.root, drawerRoot, 'Tab must still be contained by the drawer');
  });

  test('with only a non-trapping layer open, nothing traps focus', () => {
    installFakeDocument('');
    pushOverlay(fakeRoot(), () => {}, { lockScroll: false, trapFocus: false });
    assert.equal(stackMod.topmostTrap(), undefined);
  });

  test('default options are unchanged: lock and trap', () => {
    const doc = installFakeDocument('');
    const root = fakeRoot();
    const id = pushOverlay(root, () => {});
    assert.equal(doc.body.style.overflow, 'hidden');
    assert.equal(stackMod.topmostTrap()?.root, root);
    popOverlay(id);
  });
});

describe('focus return on close', () => {
  type FakeFocusable = HTMLElement & { focusCalls: number };

  function element(doc: ReturnType<typeof installFakeDocument>, opts: { connected?: boolean; focusable?: boolean } = {}) {
    const el = {
      isConnected: opts.connected ?? true,
      focusCalls: 0,
      focus() {
        el.focusCalls += 1;
        if (opts.focusable ?? true) doc.activeElement = el;
      },
    };
    return el as unknown as FakeFocusable;
  }

  test('focus goes back to the element that had it, and returnFocusTo is not consulted', () => {
    const doc = installFakeDocument('');
    const opener = element(doc);
    let asked = 0;
    const back = stackMod.restoreFocus(opener, () => {
      asked += 1;
      return element(doc);
    });
    assert.equal(back, opener);
    assert.equal(doc.activeElement, opener);
    assert.equal(asked, 0);
  });

  test('REGRESSION: an opener removed while the overlay was open falls back to returnFocusTo', () => {
    const doc = installFakeDocument('');
    const opener = element(doc, { connected: false });
    const table = element(doc);
    const back = stackMod.restoreFocus(opener, () => table);
    assert.equal(opener.focusCalls, 0, 'a detached node cannot take focus');
    assert.equal(back, table);
    assert.equal(doc.activeElement, table, 'before the fix focus fell to <body> after the row unmounted');
  });

  test('an opener that refuses focus (disabled while the action ran) falls back to returnFocusTo', () => {
    const doc = installFakeDocument('');
    const opener = element(doc, { focusable: false });
    const table = element(doc);
    const back = stackMod.restoreFocus(opener, () => table);
    assert.equal(opener.focusCalls, 1);
    assert.equal(back, table);
    assert.equal(doc.activeElement, table);
  });

  test('when nothing had focus before opening (<body>), returnFocusTo is used', () => {
    const doc = installFakeDocument('');
    const table = element(doc);
    const back = stackMod.restoreFocus(doc.body as unknown as HTMLElement, () => table);
    assert.equal(back, table);
  });

  test('without returnFocusTo the old behaviour holds: a connected opener is focused, a removed one is left alone', () => {
    const doc = installFakeDocument('');
    const opener = element(doc);
    assert.equal(stackMod.restoreFocus(opener), opener);
    assert.equal(opener.focusCalls, 1);
    const removed = element(doc, { connected: false });
    doc.activeElement = null;
    assert.equal(stackMod.restoreFocus(removed), null);
    assert.equal(removed.focusCalls, 0);
    assert.equal(doc.activeElement, null);
    assert.equal(stackMod.restoreFocus(null), null);
  });

  test('a fallback that returns nothing, a removed node, an unfocusable node or throws leaves focus alone', () => {
    const doc = installFakeDocument('');
    const opener = element(doc, { connected: false });
    assert.equal(stackMod.restoreFocus(opener, () => null), null);
    assert.equal(stackMod.restoreFocus(opener, () => element(doc, { connected: false })), null);
    assert.equal(stackMod.restoreFocus(opener, () => element(doc, { focusable: false })), null);
    assert.equal(stackMod.restoreFocus(opener, () => { throw new Error('page bug'); }), null);
    assert.equal(doc.activeElement, null);
  });
});

describe('topmost tracking and listener lifecycle', () => {
  beforeEach(() => { drain(); });

  test('isTopmostTrap identifies only the top root', () => {
    installFakeDocument('');
    const drawerRoot = fakeRoot();
    const viewerRoot = fakeRoot();
    pushOverlay(drawerRoot, () => {});
    const v = pushOverlay(viewerRoot, () => {});
    assert.equal(isTopmostTrap(viewerRoot), true);
    assert.equal(isTopmostTrap(drawerRoot), false);
    popOverlay(v);
    assert.equal(isTopmostTrap(drawerRoot), true);
    assert.equal(isTopmostTrap(null), false);
  });

  test('document listeners are attached once and removed when the stack empties', () => {
    const doc = installFakeDocument('');
    const a = pushOverlay(fakeRoot(), () => {});
    const b = pushOverlay(fakeRoot(), () => {});
    assert.equal(doc.listenerCount('keydown'), 1, 'must not stack a listener per overlay');
    assert.equal(doc.listenerCount('focusin'), 1);
    popOverlay(a);
    assert.equal(doc.listenerCount('keydown'), 1, 'still one overlay open');
    popOverlay(b);
    assert.equal(doc.listenerCount('keydown'), 0);
    assert.equal(doc.listenerCount('focusin'), 0);
  });
});
