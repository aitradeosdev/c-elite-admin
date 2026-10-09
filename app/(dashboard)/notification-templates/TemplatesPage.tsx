'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Eye, Pencil, RotateCw } from 'lucide-react';
import {
  AccessDenied, Button, Card, CardBody, ErrorState, FilterBar, MobileDataList, Notice, PageHeader, ResponsiveView,
  SearchInput, SidePanel, SkeletonLines, StatStrip, StatusDot, TBody, THead, Table, TableEmpty, TableSkeleton,
  TableState, Td, Th, Tr, urlParam, useCan, useResource, useTableSort, useToast, useUrlState,
  type MobileDataListSortOption, type StatItem, type TableSkeletonColumn,
} from '../../_ui';
import { apiRequest } from '../../lib/apiClient';
import { BUSINESS_TZ_LABEL, formatAge, formatBusinessDateTime, formatBusinessTime } from '../../lib/time';
import type { TemplateRecord } from './templateRules';
import {
  filterTemplates, sortTemplates, templateName, templateStats, toTemplateList, withTemplate,
} from './templateModel';
import type { TemplatePageConfig } from './templateConfig';
import { TemplateEditor } from './TemplateEditor';
import s from './page.module.css';

const COLUMN_COUNT = 5;
const KEY_PARAM_MAX = 128;
const MISSING_LINK = 'That template could not be found, so nothing was opened.';

const TEMPLATE_URL = urlParam<string | null>('template', {
  parse: (raw) => {
    const value = raw?.trim() ?? '';
    return value !== '' && value.length <= KEY_PARAM_MAX ? value : null;
  },
  format: (value) => value,
});

const SKELETON_COLUMNS: readonly TableSkeletonColumn[] = [
  { width: 180, lines: 2 },
  { width: 320, lines: 2 },
  { width: 96 },
  { width: 120, lines: 2 },
  { width: 64, align: 'right', button: true },
];

const MOBILE_SORT: ReadonlyArray<MobileDataListSortOption> = [
  { key: 'name', label: 'Name' },
  { key: 'updated', label: 'Last change' },
];

const NO_TEMPLATES: readonly TemplateRecord[] = [];

function sendingDot(record: TemplateRecord) {
  return (
    <StatusDot
      status={record.isActive ? 'active' : 'inactive'}
      tone={record.isActive ? 'success' : 'warning'}
      label={record.isActive ? 'Sending' : 'Switched off'}
    />
  );
}

function UpdatedCell({ value }: { value: string | null }) {
  if (!value) return <span className={s.muted}>Never</span>;
  return (
    <div className={s.stack}>
      <span className={s.time}>{`${formatAge(value)} ago`}</span>
      <span className={s.sub}>{formatBusinessDateTime(value)}</span>
    </div>
  );
}

function changedText(value: string | null): string {
  return value ? `changed ${formatAge(value)} ago` : 'never changed';
}

export function TemplatesPage({ config }: { config: TemplatePageConfig }) {
  return (
    <Suspense fallback={<PageFallback config={config} />}>
      <TemplatesList config={config} />
    </Suspense>
  );
}

function PageFallback({ config }: { config: TemplatePageConfig }) {
  return (
    <div>
      <PageHeader title={config.title} subtitle={config.subtitle} />
      <ResponsiveView
        desktop={
          <Card>
            <CardBody flush>
              <Table flush aria-label={config.listLabel}>
                <TBody>
                  <TableSkeleton columns={SKELETON_COLUMNS} rows={6} />
                </TBody>
              </Table>
            </CardBody>
          </Card>
        }
        mobile={
          <MobileDataList<TemplateRecord>
            ariaLabel={config.listLabel}
            items={NO_TEMPLATES}
            getKey={(row) => row.key}
            renderRow={(row) => ({ primary: templateName(row) })}
            loading
            initialLoading
            skeletonRows={6}
          />
        }
      />
    </div>
  );
}

function TemplatesList({ config }: { config: TemplatePageConfig }) {
  const { channel } = config;
  const { show: notify } = useToast();
  const router = useRouter();
  const canWrite = useCan(config.writePermission);
  const [openKey, setOpenKey] = useUrlState(TEMPLATE_URL);
  const [query, setQuery] = useState('');
  const { sort, setSort, toggle: toggleSort } = useTableSort(null);
  const listRegionRef = useRef<HTMLDivElement>(null);

  const select = useMemo(() => toTemplateList(channel), [channel]);
  const list = useResource<TemplateRecord[]>(
    config.resourceKey,
    (signal) => apiRequest(config.apiPath, { signal, select }),
  );
  const { refresh: refreshList, mutate: mutateList } = list;
  const data = list.data;
  const templates = data ?? NO_TEMPLATES;
  const rows = useMemo(
    () => sortTemplates(filterTemplates(channel, templates, query), sort),
    [channel, templates, query, sort],
  );
  const stats = useMemo(() => templateStats(templates), [templates]);
  const openTemplate = openKey ? templates.find((row) => row.key === openKey) ?? null : null;

  useEffect(() => {
    if (!openKey || !data || list.isPreviousData || openTemplate) return;
    notify(MISSING_LINK, 'warning');
    setOpenKey(null);
  }, [openKey, data, list.isPreviousData, openTemplate, notify, setOpenKey]);

  const readFresh = useCallback(async (): Promise<readonly TemplateRecord[] | null> => {
    const result = await apiRequest(config.apiPath, { select });
    if (!result.ok) {
      if (result.error.status !== 401) {
        notify(`The latest version of the templates could not be loaded. ${result.error.message}`, 'error');
      }
      if (result.error.status === 403) router.refresh();
      return null;
    }
    mutateList(result.data);
    return result.data;
  }, [config.apiPath, select, mutateList, notify, router]);

  const applySaved = useCallback((record: TemplateRecord) => {
    mutateList((previous) => withTemplate(previous, record));
    void refreshList({ background: true });
  }, [mutateList, refreshList]);

  const refreshQuietly = useCallback(() => {
    void refreshList({ background: true });
  }, [refreshList]);

  const openRow = useCallback((record: TemplateRecord) => {
    setOpenKey(record.key);
  }, [setOpenKey]);

  const closePanel = useCallback(() => {
    setOpenKey((value) => (value === null ? value : null));
  }, [setOpenKey]);

  const rowFocus = useCallback((key: string | null) => () => {
    const region = listRegionRef.current;
    if (!region) return null;
    const opener = key
      ? Array.from(region.querySelectorAll<HTMLElement>('[data-template-open]')).find(
          (element) => element.dataset.templateOpen === key && element.getClientRects().length > 0,
        )
      : undefined;
    return opener ?? region;
  }, []);

  if (list.error?.status === 403 && data === undefined) {
    return (
      <div>
        <PageHeader title={config.title} subtitle={config.subtitle} />
        <AccessDenied required={[config.readPermission]} />
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
  const emptyTitle = searching ? 'No templates match this search' : 'No templates yet';
  const emptyHint = searching
    ? 'Try a name, key or words from the text, or clear the search.'
    : 'Templates are added together with the feature that sends them, so there is nothing to create here.';
  const clearSearch = searching ? (
    <Button variant="secondary" size="sm" onClick={() => setQuery('')}>Clear search</Button>
  ) : undefined;
  const retry = () => void refreshList();
  const actionLabel = canWrite ? 'Edit' : 'View';

  const statItems: StatItem[] = [
    { label: 'Templates', value: stats.total.toLocaleString('en-NG'), loading: showSkeleton },
    { label: 'Sending', value: stats.active.toLocaleString('en-NG'), loading: showSkeleton },
    {
      label: 'Switched off',
      value: stats.inactive.toLocaleString('en-NG'),
      tone: stats.inactive > 0 ? 'warning' : 'neutral',
      loading: showSkeleton,
    },
    {
      label: 'Last change',
      value: stats.lastChanged ? `${formatAge(stats.lastChanged)} ago` : '—',
      hint: stats.lastChanged ? `${formatBusinessDateTime(stats.lastChanged)} ${BUSINESS_TZ_LABEL}` : undefined,
      loading: showSkeleton,
    },
  ];

  const openButton = (record: TemplateRecord) => (
    <Button
      variant="ghost"
      size="sm"
      leftIcon={canWrite ? <Pencil size={14} aria-hidden /> : <Eye size={14} aria-hidden />}
      aria-label={`${actionLabel} ${templateName(record)}`}
      aria-haspopup="dialog"
      data-template-open={record.key}
      onClick={() => openRow(record)}
    >
      {actionLabel}
    </Button>
  );

  const desktop = (
    <Card>
      <CardBody flush>
        <Table flush aria-label={config.listLabel} busy={tableBusy}>
          <THead>
            <Tr>
              <Th sortKey="name" sort={sort} onSort={toggleSort}>Template</Th>
              <Th>{config.summaryLabel}</Th>
              <Th>Status</Th>
              <Th sortKey="updated" sort={sort} onSort={toggleSort}>Last change</Th>
              <Th align="right"><span className={s.srOnly}>Actions</span></Th>
            </Tr>
          </THead>
          <TBody>
            {blocked && listError ? (
              <TableState colSpan={COLUMN_COUNT}>
                <ErrorState
                  compact
                  title="The templates could not be loaded"
                  message={listError.message}
                  requestId={listError.requestId}
                  onRetry={retry}
                  retrying={foreground}
                />
              </TableState>
            ) : showSkeleton ? (
              <TableSkeleton columns={SKELETON_COLUMNS} rows={6} />
            ) : rows.length === 0 ? (
              <TableEmpty colSpan={COLUMN_COUNT} title={emptyTitle} hint={emptyHint} actions={clearSearch} />
            ) : (
              rows.map((row) => (
                <Tr key={row.key} selected={row.key === openKey} onActivate={() => openRow(row)}>
                  <Td>
                    <div className={s.stack}>
                      <span className={s.lead}>{templateName(row)}</span>
                      <span className={s.subClamp}>{row.description ?? row.key}</span>
                    </div>
                  </Td>
                  <Td>
                    <div className={s.summary}>{config.renderSummary(row)}</div>
                  </Td>
                  <Td>{sendingDot(row)}</Td>
                  <Td><UpdatedCell value={row.updatedAt} /></Td>
                  <Td align="right">{openButton(row)}</Td>
                </Tr>
              ))
            )}
          </TBody>
        </Table>
      </CardBody>
    </Card>
  );

  const mobile = (
    <MobileDataList<TemplateRecord>
      ariaLabel={config.listLabel}
      items={rows}
      getKey={(row) => row.key}
      loading={foreground}
      initialLoading={showSkeleton}
      busy={tableBusy}
      error={listError ? listError.message : null}
      errorTitle="The templates could not be loaded"
      onRetry={retry}
      skeletonRows={6}
      empty={{ title: emptyTitle, hint: emptyHint, actions: clearSearch }}
      sortOptions={MOBILE_SORT}
      sort={sort}
      onSortChange={setSort}
      renderRow={(row) => ({
        primary: templateName(row),
        secondary: <span className={s.summaryMobile}>{config.renderSummary(row)}</span>,
        status: sendingDot(row),
        meta: `${row.key} · ${changedText(row.updatedAt)}`,
        flag: row.isActive ? null : 'warning',
        flagLabel: 'Switched off, so nothing is sent for this event',
        onClick: () => openRow(row),
      })}
    />
  );

  return (
    <div>
      <PageHeader
        title={config.title}
        subtitle={config.subtitle}
        actions={
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<RotateCw size={14} aria-hidden />}
            loading={list.isRefreshing}
            disabled={list.isInitialLoading}
            onClick={retry}
          >
            Refresh
          </Button>
        }
      />

      {listError && loaded ? (
        <Notice
          tone="warning"
          compact
          announce="polite"
          meta={list.lastUpdatedAt ? `Showing the list from ${formatBusinessTime(new Date(list.lastUpdatedAt))} ${BUSINESS_TZ_LABEL}.` : undefined}
          actions={<Button variant="ghost" size="sm" onClick={retry}>Try again</Button>}
        >
          The templates could not be refreshed. {listError.message}
        </Notice>
      ) : null}

      {loaded && !canWrite ? (
        <Notice tone="neutral" compact>
          {`You can view these templates but not change them. Editing needs the ${config.writePermissionLabel} permission (${config.writePermission}).`}
        </Notice>
      ) : null}

      <StatStrip aria-label={`${config.listLabel} summary`} items={statItems} />

      <FilterBar
        aria-label={`Filter ${config.listLabel.toLowerCase()}`}
        search={
          <SearchInput
            aria-label={`Search ${config.listLabel.toLowerCase()}`}
            placeholder={config.searchPlaceholder}
            value={query}
            onChange={setQuery}
          />
        }
        onClear={() => setQuery('')}
        active={searching}
      />

      <div ref={listRegionRef} className={s.listRegion} tabIndex={-1} role="region" aria-label={`${config.listLabel} list`}>
        <ResponsiveView desktop={desktop} mobile={mobile} />
      </div>

      {openTemplate ? (
        <TemplateEditor
          key={openTemplate.key}
          config={config}
          template={openTemplate}
          canWrite={canWrite}
          readFresh={readFresh}
          onSaved={applySaved}
          onRefresh={refreshQuietly}
          onClose={closePanel}
          returnFocusTo={rowFocus(openTemplate.key)}
        />
      ) : openKey && !loaded ? (
        <SidePanel open wide onClose={closePanel} title="Template" returnFocusTo={rowFocus(openKey)}>
          {blocked && listError ? (
            <ErrorState
              compact
              title="This template could not be loaded"
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
