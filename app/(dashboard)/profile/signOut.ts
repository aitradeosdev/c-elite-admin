'use client';

import { useCallback, useRef } from 'react';
import { useConfirm } from '../../_ui/Confirm';
import { forgetRecents, recentStorageKey } from '../../_ui/CommandPalette';
import { signOutEverywhere } from './securityActions';
import { LOGIN_PATH, signOutEverywhereConfirm } from './securityModel';

export type SignOutEverywhere = (returnFocusTo?: () => HTMLElement | null) => Promise<boolean>;

export function leaveConsole(username: string): void {
  if (username) forgetRecents(recentStorageKey(username));
  window.location.replace(LOGIN_PATH);
}

export function useSignOutEverywhere(username: string): SignOutEverywhere {
  const confirm = useConfirm();
  const busy = useRef(false);

  return useCallback<SignOutEverywhere>(async (returnFocusTo) => {
    if (busy.current) return false;
    busy.current = true;
    try {
      const decision = await confirm({
        ...signOutEverywhereConfirm(),
        returnFocusTo,
        action: () => signOutEverywhere(),
      });
      if (!decision) return false;
      leaveConsole(username);
      return true;
    } finally {
      busy.current = false;
    }
  }, [confirm, username]);
}
