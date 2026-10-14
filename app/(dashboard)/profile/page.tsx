'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, ErrorState, PageHeader, notifySessionExpired, useResource } from '../../_ui';
import { apiRequest } from '../../lib/apiClient';
import { DevicesCard } from './DevicesCard';
import { AccountDetails, PasswordCard, ProfileSkeleton } from './ProfileParts';
import { TwoStepCard } from './TwoStepCard';
import { PAGE_SUBTITLE, PAGE_TITLE, PROFILE_PATH, toProfileAccount, type ProfileAccount } from './model';
import s from './page.module.css';

export default function ProfilePage() {
  const profile = useResource<ProfileAccount>(
    'profile',
    (signal) => apiRequest(PROFILE_PATH, { signal, select: toProfileAccount }),
  );
  const [devicesVersion, setDevicesVersion] = useState(0);
  const account = profile.data;
  const failure = profile.error;
  const expired = failure?.kind === 'http' && failure.status === 401;

  useEffect(() => {
    if (expired) notifySessionExpired();
  }, [expired]);

  const devicesChanged = useCallback(() => setDevicesVersion((version) => version + 1), []);

  return (
    <div className={s.root}>
      <PageHeader title={PAGE_TITLE} subtitle={PAGE_SUBTITLE} />
      {account ? (
        <>
          <AccountDetails account={account} />
          <PasswordCard account={account} />
          <TwoStepCard account={account} onSignInChange={devicesChanged} />
          <DevicesCard account={account} version={devicesVersion} />
        </>
      ) : failure ? (
        <Card>
          <ErrorState
            compact
            title="Your profile could not be loaded"
            message={failure.message}
            requestId={failure.requestId}
            onRetry={() => void profile.refresh()}
            retrying={profile.isInitialLoading}
          />
        </Card>
      ) : (
        <ProfileSkeleton />
      )}
    </div>
  );
}
