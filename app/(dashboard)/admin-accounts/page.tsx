'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Eye, KeyRound, LogOut, MoreHorizontal, Pencil, RotateCw, ShieldCheck, Trash2, UserCheck, UserPlus, UserX,
} from 'lucide-react';
import {
  AccessDenied, Badge, Button, Card, CardBody, ErrorState, FilterBar, Menu, MobileDataList, Notice, PageHeader,
  ResponsiveView, SearchInput, SidePanel, SkeletonLines, StatStrip, StatusDot, TBody, THead, Table, TableEmpty,
  TableSkeleton, TableState, Tabs, Td, Th, Tr, useConfirm, usePermissions, useResource, useTableSort, useToast,
  useUrlState,
  type MenuEntryInput, type MobileDataListSortOption, type TableSkeletonColumn,
} from '../../_ui';
import { apiRequest, type ApiFailure } from '../../lib/apiClient';
import { isUuid } from '../../lib/http';
import { formatAge, formatBusinessDateTime, formatBusinessTime } from '../../lib/time';
import {
  ACTOR_TWO_STEP_FIRST, ADMINS_URL, POLICY_OFF, STATUS_LABEL, STATUS_TABS, STATUS_TONE, TWO_STEP_SETTINGS_HREF,
  TWO_STEP_STAT_UNAVAILABLE, actorCanReset, adminHandle, adminMfaPath, adminStats, allowsAction, capabilitiesFor,
  classifyMutation, confirmIdentity, hasRowActions, hasSecurityPanel, isSelf, mfaCellState, resetBlockedText,
  roleLabel, rowActionRequest, statusOf, tabCounts, toAdminList, toMutationResult, toResetResult, twoStepStat,
  twoStepStats, visibleAdmins, withAdmin,
  type AccessHandoff, type AdminCapabilities, type AdminList, type AdminPanel, type AdminRow, type MutationOutcome,
  type ResetResult, type RowActionKind, type SecurityPolicy, type StatusTab,
} from './model';
import { ROW_ACTION_PENDING, resetMfaConfirm, resetSuccess, rowActionConfirm, rowActionSuccess } from './confirmOptions';
import { AccessCell } from '../_access';
import { AdminEditor } from './AdminEditor';
import { AdminDetails } from './AdminDetails';
import { MfaBadge, MfaCell } from './SecurityParts';
import { AdminSecurityTab, type FocusTarget } from './SecurityTab';
import s from './page.module.css';

const TITLE = 'Admin accounts';
const SUBTITLE = 'Who can sign in to the console, what each admin can do, and their sessions. Super administrators only; times are WAT.';
const COLUMN_COUNT = 8;
const BAD_LINK = 'That admin link is not valid, so nothing was opened.';
const MISSING_LINK = 'That admin account could not be found, so nothing was opened.';
const RESET_AUDIT_WARNING = 'Two-step sign-in was reset, but the change could not be written to the audit log.';
const STEP_UP_REASON_MIN = 3;
const STEP_UP_REASON_SHORT = `Give a reason of at least ${STEP_UP_REASON_MIN} characters.`;

const SKELETON_COLUMNS: readonly TableSkeletonColumn[] = [
  { width: 150, lines: 2 },
  { width: 180 },
  { width: 120 },
  { width: 170, lines: 2 },
  { width: 130, lines: 2 },
  { width: 96 },
  { width: 110, lines: 2 },
  { width: 96, align: 'right', button: true },
];

const MOBILE_SORT: ReadonlyArray<MobileDataListSortOption> = [
  { key: 'username', label: 'Username' },
  { key: 'last_login_at', label: 'Last sign-in' },
];

const EMPTY_COPY: Readonly<Record<StatusTab, { title: string; hint: string }>> = {
  all: { title: 'No admin accounts yet', hint: 'Create an account to give someone access to the console.' },
  active: { title: 'No active admins', hint: 'Reactivate an account or create a new one.' },
  inactive: { title: 'No inactive admins', hint: 'Deactivated accounts are listed here until they are deleted.' },
  deleted: { title: 'No deleted admins', hint: 'Deleted accounts stay listed here for the record.' },
};

const NO_ADMINS: readonly AdminRow[] = [];

function readFailureText(failure: ApiFailure): string {
  return `Could not check the latest account details, so nothing was changed. ${failure.message}`;
}

function staleActionText(kind: RowActionKind, admin: AdminRow, self: boolean): string {
  const handle = adminHandle(admin);
  if (admin.deleted_at) return `${handle} was deleted, so nothing was changed.`;
  if (self) return 'You cannot do this to your own account here.';
  if (kind === 'reactivate') return `${handle} is already active.`;
  if (kind === 'remove') {
    return admin.is_super_admin ? 'Super admin accounts cannot be deleted.' : `Deactivate ${handle} before deleting the account.`;
  }
  return `${handle} is already inactive.`;
}

function signInText(value: string | null): string {
  return value ? `Signed in ${formatAge(value)} ago` : 'Never signed in';
}

function checkStepUpReason(reason: string): void {
  if (Array.from(reason.trim()).length < STEP_UP_REASON_MIN) throw new Error(STEP_UP_REASON_SHORT);
}

export default function AdminAccountsPage() {
  return (
    <Suspense fallback={<PageFallback />}>
      <AdminAccounts />
    </Suspense>
  );
}

function PageFallback() {
  return (
    <div>
      <PageHeader title={TITLE} subtitle={SUBTITLE} />
      <ResponsiveView
        desktop={
          <Card>
            <CardBody flush>
              <Table flush aria-label="Admin accounts">
                <TBody>
                  <TableSkeleton columns={SKELETON_COLUMNS} rows={5} />
                </TBody>
              </Table>
            </CardBody>
          </Card>
        }
        mobile={
          <MobileDataList<AdminRow>
            ariaLabel="Admin accounts"
            items={NO_ADMINS}
            getKey={(row) => row.id}
            renderRow={(row) => ({ primary: adminHandle(row) })}
            loading
            initialLoading
            skeletonRows={5}
          />
        }
      />
    </div>
  );
}

function AdminCell({ admin, self }: { admin: AdminRow; self: boolean }) {
  return (
    <div className={s.stack}>
      <span className={s.nameLine}>
        <span className={s.lead}>{adminHandle(admin)}</span>
        {self ? <Badge tone="neutral">You</Badge> : null}
      </span>
      <span className={s.sub}>{admin.role_title || 'No title'}</span>
    </div>
  );
}

function RoleCell({ admin }: { admin: AdminRow }) {
  const assigned = admin.is_super_admin || admin.role_id !== null;
  return <span className={assigned ? s.roleName : s.muted}>{roleLabel(admin)}</span>;
}

function EmailCell({ admin }: { admin: AdminRow }) {
  if (admin.email) return <span className={s.email}>{admin.email}</span>;
  return <span className={s.warnText}>No email, cannot sign in</span>;
}

function SignInCell({ value }: { value: string | null }) {
  if (!value) return <span className={s.muted}>Never</span>;
  return (
    <div className={s.stack}>
      <span className={s.time}>{formatBusinessDateTime(value)}</span>
      <span className={s.sub}>{formatAge(value)} ago</span>
    </div>
  );
}

function StatusCell({ admin }: { admin: AdminRow }) {
  const status = statusOf(admin);
  return (
    <span className={s.statusCell}>
      <StatusDot status={status} tone={STATUS_TONE[status]} label={STATUS_LABEL[status]} />
      {admin.is_super_admin ? (
        <Badge tone="neutral">
          <ShieldCheck size={12} aria-hidden />
          Super admin
        </Badge>
      ) : null}
    </span>
  );
}

function AdminAccounts() {
  const { isSuperAdmin } = usePermissions();
  const { show: notify } = useToast();
  const confirm = useConfirm();
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawId = searchParams.get('id');
  const [url, setUrl] = useUrlState(ADMINS_URL);
  const [query, setQuery] = useState('');
  const { sort, setSort, toggle: toggleSort } = useTableSort(null);
  const [creating, setCreating] = useState(false);
  const [handoff, setHandoff] = useState<AccessHandoff | null>(null);
  const [acting, setActing] = useState<string | null>(null);
  const [securityRevision, setSecurityRevision] = useState(0);
  const actingRef = useRef(false);
  const listRegionRef = useRef<HTMLDivElement>(null);
  const createButtonRef = useRef<HTMLButtonElement>(null);

  const list = useResource<AdminList>(
    isSuperAdmin ? 'admin-accounts' : null,
    (signal) => apiRequest('/api/admin-accounts', { signal, select: toAdminList }),
  );
  const { refresh: refreshList, mutate: mutateList } = list;
  const data = list.data;
  const admins = data?.admins ?? NO_ADMINS;
  const currentAdminId = data?.currentAdminId ?? null;
  const policy: SecurityPolicy = data?.policy ?? POLICY_OFF;
  const actorTwoStep = data?.actorTwoStep ?? null;
  const rows = useMemo(() => visibleAdmins(admins, url.tab, query, sort), [admins, url.tab, query, sort]);
  const counts = useMemo(() => tabCounts(admins), [admins]);
  const stats = useMemo(() => adminStats(admins), [admins]);
  const twoStep = useMemo(() => twoStepStats(admins), [admins]);
  const openAdmin = url.id ? admins.find((row) => row.id === url.id) ?? null : null;

  const badLink = rawId !== null && rawId.trim() !== '' && !isUuid(rawId.trim());

  useEffect(() => {
    if (!badLink) return;
    notify(BAD_LINK, 'warning');
    setUrl((value) => value);
  }, [badLink, notify, setUrl]);

  useEffect(() => {
    if (!url.id || !data || list.isPreviousData || openAdmin) return;
    notify(MISSING_LINK, 'warning');
    setUrl((value) => ({ ...value, id: null, panel: 'account' }));
  }, [url.id, data, list.isPreviousData, openAdmin, notify, setUrl]);

  const readFresh = useCallback(async (): Promise<AdminList | null> => {
    const result = await apiRequest('/api/admin-accounts', { select: toAdminList });
    if (!result.ok) {
      if (result.error.status !== 401) notify(readFailureText(result.error), 'error');
      if (result.error.status === 403) router.refresh();
      return null;
    }
    mutateList(result.data);
    return result.data;
  }, [mutateList, notify, router]);

  const applyAdmin = useCallback((admin: AdminRow) => {
    mutateList((previous) => withAdmin(previous, admin));
  }, [mutateList]);

  const refreshQuietly = useCallback(() => {
    void refreshList({ background: true });
  }, [refreshList]);

  const openRow = useCallback((admin: AdminRow) => {
    setCreating(false);
    setHandoff(null);
    setUrl((value) => ({ ...value, id: admin.id, panel: 'account' }));
  }, [setUrl]);

  const closePanel = useCallback(() => {
    setCreating(false);
    setHandoff(null);
    setUrl((value) => (value.id === null && value.panel === 'account' ? value : { ...value, id: null, panel: 'account' }));
  }, [setUrl]);

  const startCreate = useCallback(() => {
    setUrl((value) => (value.id === null && value.panel === 'account' ? value : { ...value, id: null, panel: 'account' }));
    setHandoff(null);
    setCreating(true);
  }, [setUrl]);

  const handOff = useCallback((admin: AdminRow, next: AccessHandoff) => {
    applyAdmin(admin);
    setHandoff(next);
    setCreating(false);
    setUrl((value) => ({ ...value, id: admin.id, panel: 'account' }));
  }, [applyAdmin, setUrl]);

  const changePanel = useCallback((next: AdminPanel) => {
    setUrl((value) => ({ ...value, panel: next }));
  }, [setUrl]);

  const changeTab = useCallback((next: StatusTab) => {
    setUrl((value) => ({ ...value, tab: next }));
  }, [setUrl]);

  const rowFocus = useCallback((id: string | null) => () => {
    const region = listRegionRef.current;
    if (!region) return null;
    const opener = id
      ? Array.from(region.querySelectorAll<HTMLElement>('[data-admin-open]')).find(
          (element) => element.dataset.adminOpen === id && element.getClientRects().length > 0,
        )
      : undefined;
    return opener ?? region;
  }, []);

  const report = (kind: RowActionKind, admin: AdminRow, outcome: MutationOutcome) => {
    switch (outcome.kind) {
      case 'done':
        notify(
          outcome.result.changed ? rowActionSuccess(kind, admin) : 'Nothing changed. The account was already in that state.',
          'success',
        );
        if (outcome.result.warning) notify(outcome.result.warning, 'warning');
        return;
      case 'unknown':
        notify(outcome.message, 'error');
        return;
      case 'stale':
        notify(outcome.message, 'warning');
        return;
      case 'refused':
        notify(outcome.message, 'error');
        router.refresh();
        return;
      case 'reauth':
        notify(outcome.message, 'warning');
        return;
      case 'expired':
        return;
    }
  };

  const runAction = async (kind: RowActionKind, target: AdminRow, returnFocusTo?: FocusTarget) => {
    if (actingRef.current) return;
    actingRef.current = true;
    setActing(target.id);
    let sent = false;
    let settled = false;
    try {
      const fresh = await readFresh();
      if (!fresh) return;
      const live = fresh.admins.find((row) => row.id === target.id);
      if (!live) {
        notify(`${adminHandle(target)} no longer exists, so nothing was changed.`, 'warning');
        return;
      }
      if (!allowsAction(capabilitiesFor(live, fresh.currentAdminId), kind)) {
        notify(staleActionText(kind, live, isSelf(live, fresh.currentAdminId)), 'warning');
        return;
      }
      const decision = await confirm<MutationOutcome>({
        ...rowActionConfirm(kind, live),
        pendingLabel: ROW_ACTION_PENDING[kind],
        action: async ({ reason }) => {
          sent = true;
          const request = rowActionRequest(kind, live, reason);
          const attempt = classifyMutation(await apiRequest('/api/admin-accounts', {
            method: request.method,
            body: request.body,
            select: toMutationResult,
          }));
          if (attempt.kind === 'retry') throw new Error(attempt.message);
          settled = true;
          if (attempt.kind === 'done' && attempt.result.admin) applyAdmin(attempt.result.admin);
          if (attempt.kind !== 'expired') await refreshList({ background: true });
          return attempt;
        },
        returnFocusTo: returnFocusTo ?? rowFocus(live.id),
      });
      if (decision?.value) report(kind, live, decision.value);
    } finally {
      actingRef.current = false;
      setActing(null);
      if (sent) setSecurityRevision((value) => value + 1);
      if (sent && !settled) refreshQuietly();
    }
  };

  const reportReset = (admin: AdminRow, outcome: MutationOutcome<ResetResult>) => {
    switch (outcome.kind) {
      case 'done':
        notify(resetSuccess(admin), 'success');
        if (!outcome.result.auditRecorded) notify(outcome.result.warning ?? RESET_AUDIT_WARNING, 'warning');
        return;
      case 'unknown':
        notify(outcome.message, 'error');
        return;
      case 'stale':
      case 'reauth':
        notify(outcome.message, 'warning');
        return;
      case 'refused':
        notify(outcome.message, 'error');
        router.refresh();
        return;
      case 'expired':
        return;
    }
  };

  const runReset = async (target: AdminRow, returnFocusTo?: FocusTarget) => {
    if (actingRef.current) return;
    actingRef.current = true;
    setActing(target.id);
    let sent = false;
    let settled = false;
    try {
      const fresh = await readFresh();
      if (!fresh) return;
      const live = fresh.admins.find((row) => row.id === target.id);
      if (!live) {
        notify(`${adminHandle(target)} no longer exists, so nothing was changed.`, 'warning');
        return;
      }
      if (!capabilitiesFor(live, fresh.currentAdminId).resetMfa) {
        notify(resetBlockedText(live, isSelf(live, fresh.currentAdminId)), 'warning');
        return;
      }
      if (!actorCanReset(fresh.actorTwoStep)) {
        notify(ACTOR_TWO_STEP_FIRST, 'warning');
        return;
      }
      const decision = await confirm<MutationOutcome<ResetResult>>({
        ...resetMfaConfirm(live, fresh.policy),
        action: async ({ reason, credential }) => {
          checkStepUpReason(reason);
          const identity = await confirmIdentity(credential ?? '');
          if (identity === 'expired') return { kind: 'expired' };
          sent = true;
          const attempt = classifyMutation(await apiRequest(adminMfaPath(live.id), {
            method: 'DELETE',
            body: { reason },
            select: toResetResult,
          }));
          if (attempt.kind === 'retry') throw new Error(attempt.message);
          if (attempt.kind === 'reauth' && attempt.code === 'REAUTH_REQUIRED') throw new Error(attempt.message);
          settled = true;
          if (attempt.kind !== 'expired') await refreshList({ background: true });
          return attempt;
        },
        returnFocusTo: returnFocusTo ?? rowFocus(live.id),
      });
      if (decision?.value) reportReset(live, decision.value);
    } finally {
      actingRef.current = false;
      setActing(null);
      if (sent) setSecurityRevision((value) => value + 1);
      if (sent && !settled) refreshQuietly();
    }
  };

  const menuItems = (admin: AdminRow, capabilities: AdminCapabilities): MenuEntryInput[] => [
    capabilities.revoke && {
      label: 'Sign out everywhere',
      icon: <LogOut size={14} aria-hidden />,
      onSelect: () => void runAction('revoke', admin),
    },
    capabilities.resetMfa && {
      label: 'Reset two-step sign-in',
      icon: <KeyRound size={14} aria-hidden />,
      description: actorCanReset(actorTwoStep) ? undefined : ACTOR_TWO_STEP_FIRST,
      disabled: !actorCanReset(actorTwoStep),
      onSelect: () => void runReset(admin),
    },
    capabilities.deactivate && {
      label: 'Deactivate',
      icon: <UserX size={14} aria-hidden />,
      onSelect: () => void runAction('deactivate', admin),
    },
    capabilities.reactivate && {
      label: 'Reactivate',
      icon: <UserCheck size={14} aria-hidden />,
      onSelect: () => void runAction('reactivate', admin),
    },
    capabilities.remove && { type: 'separator' },
    capabilities.remove && {
      label: 'Delete account',
      icon: <Trash2 size={14} aria-hidden />,
      danger: true,
      onSelect: () => void runAction('remove', admin),
    },
  ];

  const actionsFor = (admin: AdminRow, withOpen: boolean): ReactNode => {
    const capabilities = capabilitiesFor(admin, currentAdminId);
    const handle = adminHandle(admin);
    const more = hasRowActions(capabilities);
    if (!withOpen && !more) return undefined;
    return (
      <div className={s.rowActions}>
        {withOpen ? (
          <Button
            variant="ghost"
            size="sm"
            leftIcon={capabilities.edit ? <Pencil size={14} aria-hidden /> : <Eye size={14} aria-hidden />}
            aria-label={`${capabilities.edit ? 'Edit' : 'View'} ${handle}`}
            aria-haspopup="dialog"
            data-admin-open={admin.id}
            onClick={() => openRow(admin)}
          >
            {capabilities.edit ? 'Edit' : 'View'}
          </Button>
        ) : null}
        {more ? (
          <Menu
            align="end"
            aria-label={`Actions for ${handle}`}
            items={menuItems(admin, capabilities)}
            trigger={(props) => (
              <Button
                {...props}
                variant="ghost"
                size="sm"
                iconOnly
                leftIcon={<MoreHorizontal size={16} aria-hidden />}
                aria-label={`More actions for ${handle}`}
                loading={acting === admin.id}
                disabled={acting !== null}
              />
            )}
          />
        ) : null}
      </div>
    );
  };

  if (!isSuperAdmin || (list.error?.status === 403 && data === undefined)) {
    return (
      <div>
        <PageHeader title={TITLE} subtitle={SUBTITLE} />
        <AccessDenied
          title="Super administrators only"
          message="Admin accounts are managed by super administrators. Ask one if you need an account created or changed."
        />
      </div>
    );
  }

  const listError = list.error;
  const loaded = data !== undefined;
  const foreground = list.isInitialLoading || list.isRefreshing;
  const blocked = !loaded && listError !== null;
  const showSkeleton = !loaded && !blocked;
  const tableBusy = loaded && list.isRefreshing;
  const searching = query.trim() !== '';
  const emptyTitle = searching ? 'No admins match this search' : EMPTY_COPY[url.tab].title;
  const emptyHint = searching ? 'Try a username, email or title, or clear the search.' : EMPTY_COPY[url.tab].hint;
  const clearSearch = searching ? (
    <Button variant="secondary" size="sm" onClick={() => setQuery('')}>Clear search</Button>
  ) : undefined;
  const retry = () => void refreshList();
  const tabItems = STATUS_TABS.map((item) => ({
    value: item.value,
    label: item.label,
    count: loaded ? counts[item.value].toLocaleString('en-NG') : undefined,
  }));
  const now = new Date();
  const twoStepItem = twoStepStat(twoStep, policy, data?.securityLoaded ?? false, now);

  const staleNotice = listError && loaded ? (
    <Notice
      tone="warning"
      compact
      announce="polite"
      meta={list.lastUpdatedAt ? `Showing the list from ${formatBusinessTime(new Date(list.lastUpdatedAt))} WAT.` : undefined}
      actions={<Button variant="ghost" size="sm" onClick={retry}>Try again</Button>}
    >
      The list could not be refreshed. {listError.message}
    </Notice>
  ) : null;

  const desktop = (
    <Card>
      <CardBody flush>
        <Table flush aria-label="Admin accounts" busy={tableBusy}>
          <THead>
            <Tr>
              <Th sortKey="username" sort={sort} onSort={toggleSort}>Admin</Th>
              <Th>Email</Th>
              <Th>Role</Th>
              <Th>Access</Th>
              <Th sortKey="last_login_at" sort={sort} onSort={toggleSort}>Last sign-in</Th>
              <Th>Status</Th>
              <Th>Two-step</Th>
              <Th align="right"><span className={s.srOnly}>Actions</span></Th>
            </Tr>
          </THead>
          <TBody>
            {blocked && listError ? (
              <TableState colSpan={COLUMN_COUNT}>
                <ErrorState
                  compact
                  title="Admin accounts could not be loaded"
                  message={listError.message}
                  requestId={listError.requestId}
                  onRetry={retry}
                  retrying={foreground}
                />
              </TableState>
            ) : showSkeleton ? (
              <TableSkeleton columns={SKELETON_COLUMNS} rows={5} />
            ) : rows.length === 0 ? (
              <TableEmpty colSpan={COLUMN_COUNT} title={emptyTitle} hint={emptyHint} actions={clearSearch} />
            ) : (
              rows.map((admin) => (
                <Tr key={admin.id} selected={admin.id === url.id} onActivate={() => openRow(admin)}>
                  <Td><AdminCell admin={admin} self={isSelf(admin, currentAdminId)} /></Td>
                  <Td><EmailCell admin={admin} /></Td>
                  <Td><RoleCell admin={admin} /></Td>
                  <Td><AccessCell admin={admin} /></Td>
                  <Td><SignInCell value={admin.last_login_at} /></Td>
                  <Td><StatusCell admin={admin} /></Td>
                  <Td><MfaCell state={mfaCellState(admin, policy, now)} /></Td>
                  <Td align="right">{actionsFor(admin, true)}</Td>
                </Tr>
              ))
            )}
          </TBody>
        </Table>
      </CardBody>
    </Card>
  );

  const mobile = (
    <MobileDataList<AdminRow>
      ariaLabel="Admin accounts"
      items={rows}
      getKey={(admin) => admin.id}
      loading={foreground}
      initialLoading={showSkeleton}
      busy={tableBusy}
      error={listError ? listError.message : null}
      errorTitle="Admin accounts could not be loaded"
      onRetry={retry}
      skeletonRows={5}
      empty={{ title: emptyTitle, hint: emptyHint, actions: clearSearch }}
      sortOptions={MOBILE_SORT}
      sort={sort}
      onSortChange={setSort}
      renderRow={(admin) => ({
        primary: isSelf(admin, currentAdminId) ? `${adminHandle(admin)} · You` : adminHandle(admin),
        secondary: `${admin.role_title || 'No title'} · ${roleLabel(admin)}`,
        status: (
          <span className={s.statusStack}>
            <StatusCell admin={admin} />
            <MfaBadge state={mfaCellState(admin, policy, now)} />
          </span>
        ),
        meta: `${admin.email ?? 'No email'} · ${signInText(admin.last_login_at)}`,
        flag: !admin.email && !admin.deleted_at ? 'warning' : null,
        flagLabel: 'No email, so this admin cannot sign in',
        onClick: () => openRow(admin),
        actions: actionsFor(admin, false),
      })}
    />
  );

  const panelFocus = rowFocus(url.id);

  const securityTab = openAdmin && hasSecurityPanel(openAdmin) ? (
    <AdminSecurityTab
      admin={openAdmin}
      currentAdminId={currentAdminId}
      policy={policy}
      actorTwoStep={actorTwoStep}
      busy={acting !== null}
      revision={securityRevision}
      onResetMfa={(admin, focus) => void runReset(admin, focus)}
      onSignOutEverywhere={(admin, focus) => void runAction('revoke', admin, focus)}
      onChanged={refreshQuietly}
    />
  ) : undefined;

  return (
    <div>
      <PageHeader
        title={TITLE}
        subtitle={SUBTITLE}
        actions={
          <>
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<RotateCw size={14} aria-hidden />}
              loading={list.isRefreshing}
              onClick={retry}
            >
              Refresh
            </Button>
            <Button
              ref={createButtonRef}
              variant="primary"
              size="sm"
              leftIcon={<UserPlus size={14} aria-hidden />}
              aria-haspopup="dialog"
              onClick={startCreate}
            >
              New admin
            </Button>
          </>
        }
      />

      <StatStrip
        aria-label="Admin account totals"
        items={[
          { label: 'Active', value: stats.active.toLocaleString('en-NG'), loading: showSkeleton },
          { label: 'Inactive', value: stats.inactive.toLocaleString('en-NG'), loading: showSkeleton },
          {
            label: 'Super admins',
            value: stats.superAdmins.toLocaleString('en-NG'),
            hint: `${stats.activeSuperAdmins.toLocaleString('en-NG')} active`,
            loading: showSkeleton,
          },
          {
            label: 'Hold critical actions',
            value: stats.critical.toLocaleString('en-NG'),
            hint: 'Active admins, not counting super admins',
            loading: showSkeleton,
          },
          {
            label: 'Two-step sign-in',
            value: twoStepItem.value,
            hint: twoStepItem.hint,
            tone: twoStepItem.tone,
            href: TWO_STEP_SETTINGS_HREF,
            unavailable: twoStepItem.unavailable,
            unavailableHint: TWO_STEP_STAT_UNAVAILABLE,
            loading: showSkeleton,
          },
        ]}
      />

      <div className={s.tabsRow}>
        <Tabs<StatusTab> aria-label="Account status" value={url.tab} onChange={changeTab} items={tabItems} />
      </div>

      <FilterBar
        aria-label="Filter admin accounts"
        search={
          <SearchInput
            aria-label="Search admin accounts"
            placeholder="Username, email or title"
            value={query}
            onChange={setQuery}
          />
        }
        onClear={() => setQuery('')}
        active={searching}
      />

      {staleNotice}

      <div ref={listRegionRef} className={s.listRegion} tabIndex={-1} role="region" aria-label="Admin account list">
        <ResponsiveView desktop={desktop} mobile={mobile} />
      </div>

      {creating ? (
        <AdminEditor
          key="create"
          mode="create"
          admin={null}
          readFresh={readFresh}
          applyAdmin={applyAdmin}
          refreshList={refreshQuietly}
          onClose={closePanel}
          onHandoff={handOff}
          returnFocusTo={() => createButtonRef.current}
        />
      ) : openAdmin ? (
        capabilitiesFor(openAdmin, currentAdminId).edit ? (
          <AdminEditor
            key={`edit:${openAdmin.id}`}
            mode="edit"
            admin={openAdmin}
            readFresh={readFresh}
            applyAdmin={applyAdmin}
            refreshList={refreshQuietly}
            onClose={closePanel}
            handoff={handoff?.adminId === openAdmin.id ? handoff : undefined}
            returnFocusTo={panelFocus}
            panel={url.panel}
            onPanelChange={changePanel}
            security={securityTab}
            securityCount={openAdmin.security?.liveSessions ?? null}
          />
        ) : (
          <AdminDetails
            key={`view:${openAdmin.id}`}
            admin={openAdmin}
            onClose={closePanel}
            returnFocusTo={panelFocus}
            panel={url.panel}
            onPanelChange={changePanel}
            security={securityTab}
            securityCount={openAdmin.security?.liveSessions ?? null}
          />
        )
      ) : url.id && !loaded ? (
        <SidePanel open wide onClose={closePanel} title="Admin account" returnFocusTo={panelFocus}>
          {blocked && listError ? (
            <ErrorState
              compact
              title="This admin account could not be loaded"
              message={listError.message}
              requestId={listError.requestId}
              onRetry={retry}
              retrying={foreground}
            />
          ) : (
            <SkeletonLines rows={8} />
          )}
        </SidePanel>
      ) : null}
    </div>
  );
}
