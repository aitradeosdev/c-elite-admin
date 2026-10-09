'use client';

import { useId, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronRight, Pencil, Plus, Trash2 } from 'lucide-react';
import { Badge, Button, Card, SectionLabel, Select, Skeleton, StatusDot, Toggle } from '../../_ui';
import type { MoveDirection } from './rules';
import {
  addableCountries, countryLabel, fieldSummary, fieldsDiffer, plural, rateText, templateSummary,
  type BrandCountry, type Install, type Template, type TemplateField,
} from './model';
import s from './page.module.css';

export type FocusKind = 'template' | 'field' | 'install';

export function focusKey(kind: FocusKind, id: string, part?: string): string {
  return part ? `${kind}:${id}:${part}` : `${kind}:${id}`;
}

interface MoveButtonsProps {
  kind: FocusKind;
  id: string;
  name: string;
  index: number;
  total: number;
  disabled: boolean;
  onMove: (direction: MoveDirection) => void;
}

function MoveButtons({ kind, id, name, index, total, disabled, onMove }: MoveButtonsProps) {
  if (total < 2) return null;
  return (
    <>
      <Button
        type="button"
        iconOnly
        variant="ghost"
        size="sm"
        leftIcon={<ArrowUp size={14} aria-hidden />}
        aria-label={`Move ${name} up`}
        data-focus={focusKey(kind, id, 'up')}
        disabled={disabled || index === 0}
        onClick={() => onMove('up')}
      />
      <Button
        type="button"
        iconOnly
        variant="ghost"
        size="sm"
        leftIcon={<ArrowDown size={14} aria-hidden />}
        aria-label={`Move ${name} down`}
        data-focus={focusKey(kind, id, 'down')}
        disabled={disabled || index === total - 1}
        onClick={() => onMove('down')}
      />
    </>
  );
}

export interface TemplateCardProps {
  template: Template;
  index: number;
  total: number;
  countries: readonly BrandCountry[];
  expanded: boolean;
  canWrite: boolean;
  moving: boolean;
  onToggleExpanded: () => void;
  onMove: (direction: MoveDirection) => void;
  onRename: () => void;
  onDelete: () => void;
  onSwitchCountry: (install: Install, next: boolean) => void;
  onAddCountry: (country: BrandCountry) => void;
  onAddField: () => void;
  onEditField: (field: TemplateField) => void;
  onDeleteField: (field: TemplateField) => void;
  onMoveField: (field: TemplateField, direction: MoveDirection) => void;
}

export function TemplateCard({
  template, index, total, countries, expanded, canWrite, moving, onToggleExpanded, onMove, onRename, onDelete,
  onSwitchCountry, onAddCountry, onAddField, onEditField, onDeleteField, onMoveField,
}: TemplateCardProps) {
  const bodyId = useId();
  return (
    <Card>
      <div className={s.typeHead}>
        <h3 className={s.typeHeading}>
          <button
            type="button"
            className={s.disclosure}
            aria-expanded={expanded}
            aria-controls={bodyId}
            data-focus={focusKey('template', template.id)}
            onClick={onToggleExpanded}
          >
            <ChevronRight
              size={14}
              aria-hidden
              className={[s.chevron, expanded && s.chevronOpen].filter(Boolean).join(' ')}
            />
            <span className={s.typeText}>
              <span className={s.typeName}>{template.name}</span>
              <span className={s.typeMeta}>{templateSummary(template)}</span>
            </span>
          </button>
        </h3>
        {canWrite ? (
          <div className={s.rowActions}>
            <MoveButtons
              kind="template"
              id={template.id}
              name={template.name}
              index={index}
              total={total}
              disabled={moving}
              onMove={onMove}
            />
            <Button
              type="button"
              iconOnly
              variant="ghost"
              size="sm"
              leftIcon={<Pencil size={14} aria-hidden />}
              aria-label={`Rename ${template.name}`}
              data-focus={focusKey('template', template.id, 'rename')}
              disabled={moving}
              onClick={onRename}
            />
            <Button
              type="button"
              iconOnly
              variant="ghost"
              size="sm"
              leftIcon={<Trash2 size={14} aria-hidden />}
              aria-label={`Delete ${template.name}`}
              disabled={moving}
              onClick={onDelete}
            />
          </div>
        ) : null}
      </div>
      <div id={bodyId} className={s.typeBody} hidden={!expanded}>
        <CountriesBlock
          template={template}
          countries={countries}
          canWrite={canWrite}
          moving={moving}
          onSwitch={onSwitchCountry}
          onAdd={onAddCountry}
        />
        <FieldsBlock
          template={template}
          canWrite={canWrite}
          moving={moving}
          onAddField={onAddField}
          onEditField={onEditField}
          onDeleteField={onDeleteField}
          onMoveField={onMoveField}
        />
      </div>
    </Card>
  );
}

interface CountriesBlockProps {
  template: Template;
  countries: readonly BrandCountry[];
  canWrite: boolean;
  moving: boolean;
  onSwitch: (install: Install, next: boolean) => void;
  onAdd: (country: BrandCountry) => void;
}

function CountriesBlock({ template, countries, canWrite, moving, onSwitch, onAdd }: CountriesBlockProps) {
  const headingId = useId();
  const addable = addableCountries(template, countries);
  return (
    <section className={s.block} aria-labelledby={headingId}>
      <SectionLabel as="h4" id={headingId} flush>Countries</SectionLabel>
      {template.countries.length === 0 ? (
        <p className={s.emptyLine}>Not added to any country yet, so users cannot sell it.</p>
      ) : (
        <ul className={s.countryList}>
          {template.countries.map((install) => (
            <CountryRow
              key={install.id}
              template={template}
              install={install}
              countries={countries}
              canWrite={canWrite}
              moving={moving}
              onSwitch={onSwitch}
            />
          ))}
        </ul>
      )}
      {canWrite && countries.length === 0 ? (
        <p className={s.emptyLine}>This card has no active countries. Switch one on in Cards first.</p>
      ) : null}
      {canWrite && addable.length > 0 ? (
        <AddCountry template={template} options={addable} moving={moving} onAdd={onAdd} />
      ) : null}
    </section>
  );
}

interface CountryRowProps {
  template: Template;
  install: Install;
  countries: readonly BrandCountry[];
  canWrite: boolean;
  moving: boolean;
  onSwitch: (install: Install, next: boolean) => void;
}

function CountryRow({ template, install, countries, canWrite, moving, onSwitch }: CountryRowProps) {
  const place = countryLabel(install, countries);
  const differ = fieldsDiffer(template, install);
  const status = install.is_active ? 'Live' : 'Off';
  return (
    <li className={s.countryRow}>
      <div className={s.countryMain}>
        <span className={s.countryName}>{place}</span>
        <span className={s.countryCode}>{install.country_code}</span>
      </div>
      <div className={s.countryFacts}>
        <span className={install.active_rate_count === 0 ? s.factWarn : s.fact}>{rateText(install)}</span>
        {install.fields ? <span className={s.fact}>{plural(install.fields.length, 'field')}</span> : null}
        {differ ? <Badge tone="warning">Fields differ</Badge> : null}
      </div>
      <div className={s.countryControl}>
        {canWrite ? (
          <>
            <span className={install.is_active ? s.liveText : s.offText} aria-hidden>{status}</span>
            <Toggle
              checked={install.is_active}
              aria-label={`${template.name} live in ${place}`}
              data-focus={focusKey('install', install.id)}
              disabled={moving}
              onChange={(next) => onSwitch(install, next)}
            />
          </>
        ) : (
          <StatusDot status={install.is_active ? 'active' : 'off'} tone={install.is_active ? 'success' : 'neutral'} label={status} />
        )}
      </div>
    </li>
  );
}

interface AddCountryProps {
  template: Template;
  options: readonly BrandCountry[];
  moving: boolean;
  onAdd: (country: BrandCountry) => void;
}

function AddCountry({ template, options, moving, onAdd }: AddCountryProps) {
  const selectId = useId();
  const [code, setCode] = useState('');
  const chosen = options.find((country) => country.country_code === code) ?? null;
  return (
    <div className={s.addCountry}>
      <label htmlFor={selectId} className={s.addLabel}>Add to</label>
      <Select
        id={selectId}
        size="sm"
        inline
        value={chosen ? chosen.country_code : ''}
        onChange={(event) => setCode(event.target.value)}
      >
        <option value="">Choose a country</option>
        {options.map((country) => (
          <option key={country.country_code} value={country.country_code}>{country.country_name}</option>
        ))}
      </Select>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        leftIcon={<Plus size={14} aria-hidden />}
        aria-label={`Add ${template.name} to ${chosen ? chosen.country_name : 'the chosen country'}`}
        data-focus={focusKey('template', template.id, 'add-country')}
        disabled={!chosen || moving}
        onClick={() => {
          if (chosen) onAdd(chosen);
        }}
      >
        Add
      </Button>
    </div>
  );
}

interface FieldsBlockProps {
  template: Template;
  canWrite: boolean;
  moving: boolean;
  onAddField: () => void;
  onEditField: (field: TemplateField) => void;
  onDeleteField: (field: TemplateField) => void;
  onMoveField: (field: TemplateField, direction: MoveDirection) => void;
}

function FieldsBlock({ template, canWrite, moving, onAddField, onEditField, onDeleteField, onMoveField }: FieldsBlockProps) {
  const headingId = useId();
  const total = template.fields.length;
  return (
    <section className={s.block} aria-labelledby={headingId}>
      <SectionLabel as="h4" id={headingId} flush>Fields</SectionLabel>
      <p className={s.blockHint}>
        Copied to a country when the card type is added there. Changes here apply to countries added afterwards.
      </p>
      {total === 0 ? (
        <p className={s.emptyLine}>No fields yet, so users are not asked for a card code or an image.</p>
      ) : (
        <ol className={s.fieldList}>
          {template.fields.map((field, index) => {
            const name = field.label || 'Untitled field';
            return (
              <li key={field.id} className={s.fieldRow}>
                <span className={s.fieldPos} aria-hidden>{index + 1}</span>
                <div className={s.fieldMain}>
                  <span className={s.fieldLabel}>{name}</span>
                  <span className={s.fieldMeta}>{fieldSummary(field)}</span>
                </div>
                {canWrite ? (
                  <div className={s.rowActions}>
                    <MoveButtons
                      kind="field"
                      id={field.id}
                      name={name}
                      index={index}
                      total={total}
                      disabled={moving}
                      onMove={(direction) => onMoveField(field, direction)}
                    />
                    <Button
                      type="button"
                      iconOnly
                      variant="ghost"
                      size="sm"
                      leftIcon={<Pencil size={14} aria-hidden />}
                      aria-label={`Edit ${name}`}
                      data-focus={focusKey('field', field.id, 'edit')}
                      disabled={moving}
                      onClick={() => onEditField(field)}
                    />
                    <Button
                      type="button"
                      iconOnly
                      variant="ghost"
                      size="sm"
                      leftIcon={<Trash2 size={14} aria-hidden />}
                      aria-label={`Delete ${name}`}
                      disabled={moving}
                      onClick={() => onDeleteField(field)}
                    />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
      {canWrite ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={s.addField}
          leftIcon={<Plus size={14} aria-hidden />}
          aria-label={`Add field to ${template.name}`}
          data-focus={focusKey('template', template.id, 'add-field')}
          disabled={moving}
          onClick={onAddField}
        >
          Add field
        </Button>
      ) : null}
    </section>
  );
}

export function BuilderSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className={s.skeletonList}>
      <span className={s.srOnly} role="status">Loading card types</span>
      {Array.from({ length: rows }, (_, index) => (
        <Card key={index} aria-hidden>
          <div className={s.skeletonHead}>
            <Skeleton width={14} height={14} />
            <div className={s.skeletonText}>
              <Skeleton width="9em" height={14} />
              <Skeleton width="16em" height={11} />
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}
