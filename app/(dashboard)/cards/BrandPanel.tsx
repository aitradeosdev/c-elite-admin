'use client';

import { useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
import {
  Button, Combobox, DetailRow, EmptyState, FieldShell, Input, Menu, Notice, Ref, SectionLabel, SidePanel, Toggle,
  useConfirm, useToast,
} from '../../_ui';
import { apiRequest } from '../../lib/apiClient';
import { CURRENCY_SYMBOL_MAX, currencySymbolProblem } from './catalogRules';
import { AvailabilityDot, BrandMark, BrandStatus, Flag, ValueDiff, useDeferredFocus, useLeaveWarning } from './CatalogParts';
import { countryOptions, currencyCodeOf, isoCountry } from './countries';
import {
  availabilityAfter, availabilityText, availableCountries, brandLabel, classifyMutation, countryOffConsequences,
  countryRemovalConsequences, countrySummary, dropCountry, needsCountry, positionText, sortCountries, statusText,
  symbolConsequences, toCountryReceipt, upsertCountry, withCountries,
  type Catalog, type CatalogCard, type CatalogCountry, type CountryReceipt, type MutationOutcome,
} from './model';
import s from './page.module.css';

export interface BrandPanelProps {
  card: CatalogCard;
  index: number;
  total: number;
  canWrite: boolean;
  reload: () => Promise<Catalog | null>;
  patchCards: (update: (cards: CatalogCard[]) => CatalogCard[]) => void;
  refreshQuietly: () => void;
  onEdit: () => void;
  onClose: () => void;
  returnFocusTo: () => HTMLElement | null;
}

interface SymbolEdit {
  id: string;
  value: string;
  error: string | null;
}

interface LiveCountry {
  card: CatalogCard;
  country: CatalogCountry;
}

type CountryMethod = 'POST' | 'PATCH' | 'DELETE';

const CHECK_FAILED = 'The latest values could not be checked, so nothing was changed. Try again.';

function countryLabel(country: Pick<CatalogCountry, 'country_name' | 'country_code'>): string {
  return `${country.country_name} (${country.country_code})`;
}

export function BrandPanel({
  card, index, total, canWrite, reload, patchCards, refreshQuietly, onEdit, onClose, returnFocusTo,
}: BrandPanelProps) {
  const toast = useToast();
  const confirm = useConfirm();
  const router = useRouter();
  const focusLater = useDeferredFocus();
  const baseId = useId();
  const comboRef = useRef<HTMLInputElement>(null);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const symbolInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const busyRef = useRef(false);
  const closingRef = useRef(false);

  const [pick, setPick] = useState<string | null>(null);
  const [symbol, setSymbol] = useState('');
  const [available, setAvailable] = useState(true);
  const [symbolError, setSymbolError] = useState<string | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [edit, setEdit] = useState<SymbolEdit | null>(null);
  const [savingSymbol, setSavingSymbol] = useState(false);

  const brand = brandLabel(card);
  const countries = useMemo(() => sortCountries(card.countries), [card.countries]);
  const options = useMemo(() => countryOptions(card.countries.map((country) => country.country_code)), [card.countries]);
  const iso = isoCountry(pick);
  const summary = countrySummary(card.countries);
  const editing = edit ? card.countries.find((country) => country.id === edit.id) ?? null : null;
  const editDirty = edit !== null && editing !== null && edit.value.trim() !== editing.currency_symbol;
  const dirty = pick !== null || editDirty;
  const locked = busyId !== null || adding || savingSymbol;
  const headingId = `${baseId}-countries`;
  const addHeadingId = `${baseId}-add`;
  const symbolErrorId = `${baseId}-symbol-error`;
  const currencyCode = iso ? currencyCodeOf(iso.code) : null;

  useLeaveWarning(dirty);

  const menuTrigger = (countryId: string) => (
    listRef.current?.querySelector<HTMLElement>(`[data-country-menu="${countryId}"]`) ?? null
  );

  const afterRemoval = () => comboRef.current;

  const sendCountry = (body: Record<string, unknown>, method: CountryMethod) => (
    apiRequest('/api/cards', { method, body, select: toCountryReceipt })
  );

  const applyCountry = (country: CatalogCountry) => {
    patchCards((cards) => withCountries(cards, card.id, (list) => upsertCountry(list, country)));
  };

  const applyRemoval = (countryId: string) => {
    patchCards((cards) => withCountries(cards, card.id, (list) => dropCountry(list, countryId)));
  };

  const report = (
    outcome: MutationOutcome<CountryReceipt>,
    success: string,
    failure: string,
    apply: (receipt: CountryReceipt) => void,
  ): boolean => {
    switch (outcome.kind) {
      case 'done':
        apply(outcome.data);
        toast.show(success, 'success');
        if (outcome.data.warning) toast.show(outcome.data.warning, 'warning');
        refreshQuietly();
        return true;
      case 'expired':
        return false;
      case 'refused':
        toast.show(`${failure} ${outcome.message}`, 'error');
        if (outcome.status === 403) router.refresh();
        refreshQuietly();
        return false;
      case 'unknown':
        toast.show(outcome.message, 'error');
        refreshQuietly();
        return false;
      case 'retry':
        toast.show(`${failure} ${outcome.message}`, 'error');
        return false;
    }
  };

  const readLive = async (country: CatalogCountry): Promise<LiveCountry | null> => {
    const fresh = await reload();
    if (!fresh) {
      toast.show(CHECK_FAILED, 'error');
      return null;
    }
    const liveCard = fresh.cards.find((entry) => entry.id === card.id);
    const liveCountry = liveCard?.countries.find((entry) => entry.id === country.id);
    if (!liveCard || !liveCountry) {
      toast.show(`${country.country_name} is no longer on ${brand}, so nothing was changed.`, 'warning');
      return null;
    }
    return { card: liveCard, country: liveCountry };
  };

  const cancelEdit = () => {
    if (savingSymbol || !edit) return;
    const target = edit.id;
    setEdit(null);
    focusLater(() => menuTrigger(target));
  };

  const requestClose = async () => {
    if (busyRef.current || closingRef.current) return;
    if (edit && !editDirty && pick === null) {
      cancelEdit();
      return;
    }
    if (!dirty) {
      onClose();
      return;
    }
    const unsaved = [
      iso ? `${iso.name} has not been added to ${brand}.` : null,
      editDirty && editing ? `The new currency symbol for ${editing.country_name} has not been saved.` : null,
    ].filter(Boolean).join(' ');
    closingRef.current = true;
    try {
      const decision = await confirm({
        title: 'Discard unsaved changes?',
        message: `${unsaved} Closing discards ${pick !== null && editDirty ? 'them' : 'it'}, and nothing changes for users.`,
        confirmLabel: 'Discard and close',
        cancelLabel: 'Keep editing',
      });
      if (decision) onClose();
    } finally {
      closingRef.current = false;
    }
  };

  const choose = (code: string | null) => {
    setPick(code);
    setPickError(null);
    setSymbolError(null);
    setSymbol(code ? isoCountry(code)?.symbol ?? '' : '');
  };

  const add = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busyRef.current || locked) return;
    if (!iso) {
      setPickError('Choose a country to add.');
      comboRef.current?.focus();
      return;
    }
    const clean = symbol.trim();
    const problem = currencySymbolProblem(clean);
    if (problem) {
      setSymbolError(problem);
      return;
    }
    busyRef.current = true;
    setAdding(true);
    let added = false;
    try {
      const outcome = classifyMutation(await sendCountry({
        type: 'country',
        card_id: card.id,
        country_code: iso.code,
        country_name: iso.name,
        currency_symbol: clean,
        is_active: available,
      }, 'POST'));
      const success = !available
        ? `${iso.name} added to ${brand} as unavailable. Make it available when it is ready to sell.`
        : card.is_active
          ? `${iso.name} added. Users can choose it when selling ${brand} within about two minutes.`
          : `${iso.name} added. ${brand} is inactive, so users see it once the brand is activated.`;
      added = report(outcome, success, `${iso.name} was not added.`, (receipt) => {
        if (receipt.country) applyCountry(receipt.country);
      });
      if (added) {
        setPick(null);
        setSymbol('');
        setAvailable(true);
      }
    } finally {
      busyRef.current = false;
      setAdding(false);
      focusLater(() => (added ? comboRef.current : addButtonRef.current));
    }
  };

  const makeAvailable = async (country: CatalogCountry) => {
    const outcome = classifyMutation(await sendCountry({ type: 'country', id: country.id, is_active: true }, 'PATCH'));
    report(
      outcome,
      card.is_active
        ? `${country.country_name} is available. Users can choose it when selling ${brand} within about two minutes.`
        : `${country.country_name} is available. ${brand} is inactive, so users see it once the brand is activated.`,
      `${country.country_name} was not made available.`,
      (receipt) => applyCountry(receipt.country ?? { ...country, is_active: true }),
    );
  };

  const makeUnavailable = async (country: CatalogCountry) => {
    const live = await readLive(country);
    setBusyId(null);
    if (!live) return;
    if (!live.country.is_active) {
      toast.show(`${live.country.country_name} is already unavailable for ${brand}.`);
      applyCountry(live.country);
      return;
    }
    const before = availableCountries(live.card);
    const after = availabilityAfter(live.card, country.id, false);
    let sent = false;
    const decision = await confirm<MutationOutcome<CountryReceipt>>({
      tone: 'danger',
      title: `Stop selling ${brand} in ${live.country.country_name}?`,
      message: `${live.country.country_name} stays on the brand but is hidden from users.`,
      details: [
        { label: 'Brand', value: brand },
        { label: 'Country', value: countryLabel(live.country) },
        { label: 'Availability', value: <ValueDiff before={availabilityText(true)} after={availabilityText(false)} /> },
        { label: 'Available countries', value: <ValueDiff before={String(before)} after={String(after)} />, mono: true },
      ],
      consequences: countryOffConsequences(live.card, live.country),
      confirmLabel: 'Make unavailable',
      pendingLabel: 'Saving…',
      action: async () => {
        sent = true;
        const outcome = classifyMutation(await sendCountry({ type: 'country', id: country.id, is_active: false }, 'PATCH'));
        if (outcome.kind === 'retry') throw new Error(outcome.message);
        return outcome;
      },
    });
    if (decision?.value) {
      report(
        decision.value,
        `${live.country.country_name} is unavailable for ${brand}.`,
        `${live.country.country_name} was not changed.`,
        (receipt) => applyCountry(receipt.country ?? { ...live.country, is_active: false }),
      );
      return;
    }
    if (sent) refreshQuietly();
  };

  const setAvailability = async (country: CatalogCountry, next: boolean) => {
    if (!canWrite || busyRef.current) return;
    busyRef.current = true;
    setBusyId(country.id);
    try {
      if (next) await makeAvailable(country);
      else await makeUnavailable(country);
    } finally {
      busyRef.current = false;
      setBusyId(null);
    }
  };

  const remove = async (country: CatalogCountry) => {
    if (!canWrite || busyRef.current) return;
    busyRef.current = true;
    setBusyId(country.id);
    let sent = false;
    let removed = false;
    try {
      const live = await readLive(country);
      setBusyId(null);
      if (!live) return;
      const after = availabilityAfter(live.card, country.id, null);
      const wasAvailable = live.country.is_active;
      const decision = await confirm<MutationOutcome<CountryReceipt>>({
        tone: 'danger',
        title: `Remove ${live.country.country_name} from ${brand}?`,
        message: 'The country is taken off this brand completely. You can add it again later.',
        details: [
          { label: 'Brand', value: brand },
          { label: 'Country', value: countryLabel(live.country) },
          { label: 'Currency symbol', value: live.country.currency_symbol || '—', mono: true },
          { label: 'Availability', value: <ValueDiff before={availabilityText(wasAvailable)} after="Removed" /> },
          {
            label: 'Available countries',
            value: <ValueDiff before={String(availableCountries(live.card))} after={String(after)} />,
            mono: true,
          },
        ],
        consequences: countryRemovalConsequences(live.card, live.country),
        confirmLabel: 'Remove country',
        pendingLabel: 'Removing…',
        action: async () => {
          sent = true;
          const outcome = classifyMutation(await sendCountry({ type: 'country', id: country.id }, 'DELETE'));
          if (outcome.kind === 'retry') throw new Error(outcome.message);
          removed = outcome.kind === 'done';
          return outcome;
        },
        returnFocusTo: () => (removed ? afterRemoval() : menuTrigger(country.id) ?? afterRemoval()),
      });
      if (decision?.value) {
        report(
          decision.value,
          `${live.country.country_name} removed from ${brand}.`,
          `${live.country.country_name} was not removed.`,
          () => applyRemoval(country.id),
        );
        return;
      }
      if (sent) refreshQuietly();
    } finally {
      busyRef.current = false;
      setBusyId(null);
    }
  };

  const startEdit = (country: CatalogCountry) => {
    if (!canWrite || locked) return;
    setEdit({ id: country.id, value: country.currency_symbol, error: null });
    focusLater(() => symbolInputRef.current, true);
  };

  const saveSymbol = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!edit || !editing || busyRef.current) return;
    const clean = edit.value.trim();
    const problem = currencySymbolProblem(clean);
    if (problem) {
      setEdit({ ...edit, error: problem });
      symbolInputRef.current?.focus();
      return;
    }
    if (clean === editing.currency_symbol) {
      cancelEdit();
      return;
    }
    const target = editing;
    busyRef.current = true;
    setSavingSymbol(true);
    let saved = false;
    let sent = false;
    try {
      const live = await readLive(target);
      if (!live) {
        setEdit(null);
        return;
      }
      if (live.country.currency_symbol === clean) {
        toast.show(`${live.country.country_name} already shows amounts with “${clean}”.`);
        applyCountry(live.country);
        saved = true;
        setEdit(null);
        return;
      }
      const decision = await confirm<MutationOutcome<CountryReceipt>>({
        title: `Change the currency symbol for ${live.country.country_name}?`,
        message: `This changes how amounts for ${brand} cards from ${live.country.country_name} are shown to users.`,
        details: [
          { label: 'Brand', value: brand },
          { label: 'Country', value: countryLabel(live.country) },
          {
            label: 'Currency symbol',
            value: <ValueDiff before={live.country.currency_symbol || '—'} after={clean} />,
            mono: true,
          },
        ],
        consequences: symbolConsequences(live.card, live.country, clean),
        confirmLabel: 'Change symbol',
        pendingLabel: 'Saving…',
        action: async () => {
          sent = true;
          const outcome = classifyMutation(await sendCountry({ type: 'country', id: target.id, currency_symbol: clean }, 'PATCH'));
          if (outcome.kind === 'retry') throw new Error(outcome.message);
          return outcome;
        },
        returnFocusTo: () => symbolInputRef.current ?? menuTrigger(target.id),
      });
      if (!decision?.value) {
        if (sent) refreshQuietly();
        return;
      }
      saved = report(
        decision.value,
        `${live.country.country_name} now shows amounts with “${clean}”.`,
        `The symbol for ${live.country.country_name} was not changed.`,
        (receipt) => applyCountry(receipt.country ?? { ...live.country, currency_symbol: clean }),
      );
      if (saved) setEdit(null);
    } finally {
      busyRef.current = false;
      setSavingSymbol(false);
      focusLater(() => (saved ? menuTrigger(target.id) : symbolInputRef.current ?? menuTrigger(target.id)));
    }
  };

  return (
    <SidePanel
      open
      onClose={() => void requestClose()}
      title={brand}
      subtitle={`${statusText(card.is_active)} · ${summary.count}`}
      returnFocusTo={returnFocusTo}
    >
      <div className={s.panelBody}>
        <section className={s.summary} aria-label="Brand summary">
          <BrandMark src={card.logo_url} name={card.name} size="lg" />
          <div className={s.summaryText}>
            <span className={s.summaryName}>{brand}</span>
            <BrandStatus card={card} />
          </div>
          {canWrite ? (
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<Pencil size={14} aria-hidden />}
              disabled={locked}
              onClick={onEdit}
            >
              Edit brand
            </Button>
          ) : null}
        </section>

        {needsCountry(card) ? (
          <Notice tone="warning" compact flush>
            Users can see {brand} but cannot sell it, because no country is available.
          </Notice>
        ) : null}

        <div className={s.details}>
          <DetailRow label="Position" value={positionText(index, total)} mono />
          <DetailRow label="Available countries" value={`${summary.available} of ${card.countries.length}`} mono />
          <DetailRow label="Brand ID" value={<Ref value={card.id} label="brand ID" size="sm" />} />
        </div>

        <section className={s.section} aria-labelledby={headingId}>
          <div className={s.sectionHead}>
            <SectionLabel as="h3" id={headingId} flush>Countries</SectionLabel>
            <span className={s.sectionCount}>{summary.count}</span>
          </div>
          {countries.length === 0 ? (
            <EmptyState
              variant="plain"
              title="No countries yet"
              hint={canWrite ? 'Add the countries users can sell this brand in.' : 'No country has been set up for this brand.'}
            />
          ) : (
            <ul ref={listRef} className={s.countryList}>
              {countries.map((country) => {
                const code = currencyCodeOf(country.country_code);
                const editingThis = edit?.id === country.id;
                const rowBusy = busyId === country.id;
                return (
                  <li key={country.id} className={s.countryRow}>
                    <Flag code={country.country_code} />
                    <div className={s.countryMain}>
                      <span className={s.countryName}>{country.country_name}</span>
                      {editingThis && edit ? (
                        <form className={s.symbolEditor} onSubmit={(event) => void saveSymbol(event)} noValidate>
                          <span className={s.symbolField}>
                            <Input
                              ref={symbolInputRef}
                              size="sm"
                              mono
                              value={edit.value}
                              maxLength={CURRENCY_SYMBOL_MAX}
                              aria-label={`Currency symbol for ${country.country_name}`}
                              aria-describedby={edit.error ? symbolErrorId : undefined}
                              invalid={Boolean(edit.error)}
                              readOnly={savingSymbol}
                              onChange={(event) => setEdit({ ...edit, value: event.target.value, error: null })}
                            />
                          </span>
                          <Button type="submit" variant="primary" size="sm" loading={savingSymbol}>Save</Button>
                          <Button type="button" variant="ghost" size="sm" disabled={savingSymbol} onClick={cancelEdit}>
                            Cancel
                          </Button>
                          {edit.error ? (
                            <span id={symbolErrorId} className={s.inlineError} role="alert">{edit.error}</span>
                          ) : null}
                        </form>
                      ) : (
                        <span className={s.countryMeta}>
                          <span>
                            <span className={s.srOnly}>Country code </span>
                            {country.country_code}
                          </span>
                          {code ? (
                            <span title="Currency from the country. It is not saved with the brand.">
                              <span className={s.srOnly}>Currency </span>
                              {code}
                            </span>
                          ) : null}
                          <span>
                            <span className={s.srOnly}>Currency symbol </span>
                            {country.currency_symbol || '—'}
                          </span>
                        </span>
                      )}
                    </div>
                    <div className={s.countryControls}>
                      {canWrite ? (
                        <>
                          <Toggle
                            checked={country.is_active}
                            label={availabilityText(country.is_active)}
                            aria-label={`Users can sell ${brand} in ${country.country_name}`}
                            aria-disabled={locked || undefined}
                            className={rowBusy ? s.pendingControl : locked ? s.lockedControl : undefined}
                            onChange={(next) => {
                              if (locked) return;
                              void setAvailability(country, next);
                            }}
                          />
                          <Menu
                            aria-label={`Actions for ${country.country_name}`}
                            align="end"
                            items={[
                              {
                                label: 'Change currency symbol',
                                icon: <Pencil size={14} aria-hidden />,
                                disabled: locked,
                                onSelect: () => startEdit(country),
                              },
                              { type: 'separator' },
                              {
                                label: 'Remove from brand',
                                icon: <Trash2 size={14} aria-hidden />,
                                danger: true,
                                disabled: locked,
                                onSelect: () => void remove(country),
                              },
                            ]}
                            trigger={(props) => (
                              <Button
                                {...props}
                                type="button"
                                variant="ghost"
                                size="sm"
                                iconOnly
                                leftIcon={<MoreHorizontal size={14} aria-hidden />}
                                aria-label={`More actions for ${country.country_name}`}
                                data-country-menu={country.id}
                              />
                            )}
                          />
                        </>
                      ) : (
                        <AvailabilityDot active={country.is_active} />
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {canWrite ? (
          <section className={s.section} aria-labelledby={addHeadingId}>
            <SectionLabel as="h3" id={addHeadingId}>Add a country</SectionLabel>
            <form className={s.addForm} onSubmit={(event) => void add(event)} noValidate>
              <FieldShell label="Country" required error={pickError}>
                <Combobox
                  ref={comboRef}
                  options={options}
                  value={pick}
                  onChange={(value) => choose(value)}
                  placeholder="Search by name, code or currency"
                  emptyText={options.length === 0 ? 'Every listed country is already on this brand' : 'No matching country'}
                  invalid={Boolean(pickError)}
                  readOnly={adding}
                />
              </FieldShell>
              {iso ? (
                <div className={s.formRow}>
                  <FieldShell
                    label="Currency symbol"
                    required
                    error={symbolError}
                    help={symbolError ? undefined : 'Saved with the brand. Shown next to amounts in the app and in notifications.'}
                  >
                    <Input
                      mono
                      value={symbol}
                      maxLength={CURRENCY_SYMBOL_MAX}
                      readOnly={adding}
                      onChange={(event) => {
                        setSymbol(event.target.value);
                        if (symbolError) setSymbolError(null);
                      }}
                    />
                  </FieldShell>
                  <div className={s.derived}>
                    <DetailRow label="Currency" value={currencyCode ?? '—'} mono />
                    <p className={s.fieldNote}>From the country you picked. It is not saved with the brand.</p>
                  </div>
                </div>
              ) : null}
              <Toggle
                checked={available}
                disabled={adding}
                onChange={setAvailable}
                label="Available to users as soon as it is added"
              />
              <div className={s.addActions}>
                <Button
                  ref={addButtonRef}
                  type="submit"
                  variant="primary"
                  size="sm"
                  leftIcon={<Plus size={14} aria-hidden />}
                  loading={adding}
                  disabled={locked && !adding}
                >
                  Add country
                </Button>
              </div>
            </form>
          </section>
        ) : null}
      </div>
    </SidePanel>
  );
}
