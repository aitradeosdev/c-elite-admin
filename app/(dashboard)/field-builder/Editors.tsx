'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Button, Checkbox, FieldShell, Input, Modal, Notice, RadioGroup, Select, useConfirm } from '../../_ui';
import {
  FORMAT_CHOICES, FORMAT_HINTS, FORMAT_LABELS, INPUT_TYPES, INPUT_TYPE_HINTS, INPUT_TYPE_LABELS, LABEL_MAX, NAME_MAX,
  PATTERN_HELP, cleanText, findDuplicate, formatChoiceOf, isFormatChoice, isInputType, labelProblem, nameProblem,
  previewStatus, takesFormat, type FormatChoice, type InputType,
} from './rules';
import {
  PATTERN_MAX, fieldFormatDigitsOnly, fieldFormatExample, fieldFormatMaxLength, fieldFormatOf, formatFieldValue,
  patternProblem, type FieldFormat, type InputFormat,
} from '../../lib/fieldFormat';
import { countryLabel, listText, type BrandCountry, type Template, type TemplateField } from './model';
import s from './page.module.css';

export interface EditorResult {
  close: boolean;
  error?: string | null;
  field?: string | null;
}

export interface FieldDraft {
  label: string;
  input_type: InputType;
  is_required: boolean;
  input_format: InputFormat | null;
  format_pattern: string | null;
}

interface FieldValues {
  label: string;
  input_type: InputType | null;
  is_required: boolean;
  format: FormatChoice | null;
  pattern: string;
}

interface ServerError {
  field: string | null;
  message: string;
}

const TYPE_OPTIONS = INPUT_TYPES.map((value) => ({
  value,
  label: INPUT_TYPE_LABELS[value],
  description: INPUT_TYPE_HINTS[value],
}));

const FORMAT_OPTIONS = FORMAT_CHOICES.map((value) => ({ value, label: FORMAT_LABELS[value] }));

function draftFormatOf(values: FieldValues): { input_format: InputFormat | null; format_pattern: string | null } {
  const choice = takesFormat(values.input_type) ? values.format : 'free';
  const inputFormat = choice === null || choice === 'free' ? null : choice;
  return { input_format: inputFormat, format_pattern: inputFormat === 'custom' ? values.pattern : null };
}

function FormatPreview({ format }: { format: FieldFormat }) {
  const [value, setValue] = useState('');
  return (
    <FieldShell label="Preview" help={previewStatus(format, value)}>
      <Input
        mono
        value={value}
        placeholder={fieldFormatExample(format)}
        maxLength={fieldFormatMaxLength(format)}
        inputMode={fieldFormatDigitsOnly(format) ? 'numeric' : 'text'}
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => setValue(formatFieldValue(format, event.target.value))}
      />
    </FieldShell>
  );
}

function useLeaveWarning(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [active]);
}

function useAlive() {
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  return alive;
}

export interface TemplateEditorProps {
  mode: 'create' | 'rename';
  cardName: string;
  template: Template | null;
  siblings: readonly Template[];
  countries: readonly BrandCountry[];
  onSave: (name: string) => Promise<EditorResult>;
  onClose: () => void;
}

export function TemplateEditor({ mode, cardName, template, siblings, countries, onSave, onClose }: TemplateEditorProps) {
  const confirm = useConfirm();
  const alive = useAlive();
  const formId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const savingRef = useRef(false);
  const [initial] = useState(() => template?.name ?? '');
  const [places] = useState(() => (
    mode === 'rename' && template ? template.countries.map((install) => countryLabel(install, countries)) : []
  ));
  const [name, setName] = useState(initial);
  const [submitted, setSubmitted] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const renaming = mode === 'rename';
  const cleaned = cleanText(name);
  const dirty = cleaned !== cleanText(initial);
  const duplicate = findDuplicate(siblings, (item) => item.name, cleaned, template?.id ?? null);
  const problem = nameProblem(cleaned) ?? (duplicate ? `${cardName} already has a card type called ${duplicate.name}.` : null);
  const error = serverError ?? (submitted ? problem : null);

  useLeaveWarning(dirty || saving);

  const requestClose = async () => {
    if (savingRef.current) return;
    if (!dirty) {
      onClose();
      return;
    }
    const decision = await confirm({
      title: renaming ? 'Discard the new name?' : 'Discard this card type?',
      message: renaming ? `${initial} keeps its current name.` : 'Nothing has been created yet.',
      confirmLabel: 'Discard',
      cancelLabel: 'Keep editing',
    });
    if (decision && alive.current) onClose();
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (savingRef.current) return;
    setSubmitted(true);
    if (problem) {
      inputRef.current?.focus();
      return;
    }
    if (renaming && !dirty) return;
    savingRef.current = true;
    setSaving(true);
    setServerError(null);
    try {
      const result = await onSave(cleaned);
      if (!alive.current) return;
      if (result.close) {
        onClose();
      } else if (result.error) {
        setServerError(result.error);
        inputRef.current?.focus();
      }
    } finally {
      savingRef.current = false;
      if (alive.current) setSaving(false);
    }
  };

  return (
    <Modal
      open
      size="sm"
      hideClose
      static={saving}
      onClose={() => void requestClose()}
      title={renaming ? `Rename ${initial}` : 'Add card type'}
      subtitle={cardName}
      footer={
        <div className={s.editorFooter}>
          <Button type="button" variant="ghost" disabled={saving} onClick={() => void requestClose()}>
            Cancel
          </Button>
          <Button type="submit" form={formId} variant="primary" loading={saving} disabled={renaming && !dirty}>
            {renaming ? 'Save name' : 'Add card type'}
          </Button>
        </div>
      }
    >
      <form id={formId} className={s.editorForm} noValidate onSubmit={(event) => void submit(event)}>
        <FieldShell
          label="Name"
          required
          error={error}
          help={
            places.length > 0
              ? `Also renames it in ${listText(places)}, where it has been added. Users there see the new name.`
              : 'Users see this name when they choose how to sell a card, for example E-code or Physical card.'
          }
        >
          <Input
            ref={inputRef}
            value={name}
            maxLength={NAME_MAX}
            autoComplete="off"
            readOnly={saving}
            onChange={(event) => {
              setName(event.target.value);
              setServerError(null);
            }}
          />
        </FieldShell>
      </form>
    </Modal>
  );
}

export interface FieldEditorProps {
  mode: 'create' | 'edit';
  template: Template;
  field: TemplateField | null;
  countries: readonly BrandCountry[];
  onSave: (draft: FieldDraft) => Promise<EditorResult>;
  onClose: () => void;
}

export function FieldEditor({ mode, template, field, countries, onSave, onClose }: FieldEditorProps) {
  const confirm = useConfirm();
  const alive = useAlive();
  const formId = useId();
  const labelRef = useRef<HTMLInputElement>(null);
  const formatRef = useRef<HTMLSelectElement>(null);
  const patternRef = useRef<HTMLInputElement>(null);
  const savingRef = useRef(false);
  const [initial] = useState<FieldValues>(() => ({
    label: field?.label ?? '',
    input_type: field ? (isInputType(field.input_type) ? field.input_type : null) : 'text',
    is_required: field ? field.is_required : true,
    format: field ? formatChoiceOf(field.input_format) : 'free',
    pattern: field?.format_pattern ?? '',
  }));
  const [places] = useState(() => template.countries.map((install) => countryLabel(install, countries)));
  const [values, setValues] = useState<FieldValues>(initial);
  const [submitted, setSubmitted] = useState(false);
  const [serverError, setServerError] = useState<ServerError | null>(null);
  const [saving, setSaving] = useState(false);

  const creating = mode === 'create';
  const cleaned = cleanText(values.label);
  const formatted = takesFormat(values.input_type);
  const draftFormat = draftFormatOf(values);
  const formatDirty = formatted
    && (values.format !== initial.format || (values.format === 'custom' && values.pattern !== initial.pattern));
  const dirty = cleaned !== cleanText(initial.label)
    || values.input_type !== initial.input_type
    || values.is_required !== initial.is_required
    || formatDirty;
  const duplicate = findDuplicate(template.fields, (item) => item.label, cleaned, field?.id ?? null);
  const labelIssue = labelProblem(cleaned) ?? (duplicate ? `${template.name} already has a field called ${duplicate.label}.` : null);
  const typeIssue = values.input_type ? null : 'Choose what users provide.';
  const formatIssue = formatted && values.format === null ? 'Choose a format.' : null;
  const patternIssue = draftFormat.input_format === 'custom' ? patternProblem(values.pattern) : null;
  const preview = draftFormat.input_format ? fieldFormatOf(draftFormat.input_format, draftFormat.format_pattern) : null;
  const shownFields = [
    'label',
    'input_type',
    ...(formatted ? ['input_format'] : []),
    ...(draftFormat.input_format === 'custom' ? ['format_pattern'] : []),
  ];
  const fieldError = (name: string) => (serverError?.field === name ? serverError.message : null);
  const labelError = fieldError('label') ?? (submitted ? labelIssue : null);
  const typeError = fieldError('input_type') ?? (submitted ? typeIssue : null);
  const formatError = fieldError('input_format') ?? (submitted ? formatIssue : null);
  const patternError = fieldError('format_pattern') ?? (submitted ? patternIssue : null);
  const formError = serverError && !shownFields.includes(serverError.field ?? '') ? serverError.message : null;

  useLeaveWarning(dirty || saving);

  const update = (patch: Partial<FieldValues>) => {
    setValues((current) => ({ ...current, ...patch }));
    setServerError(null);
  };

  const requestClose = async () => {
    if (savingRef.current) return;
    if (!dirty) {
      onClose();
      return;
    }
    const decision = await confirm({
      title: creating ? 'Discard this field?' : 'Discard your changes?',
      message: creating
        ? 'Nothing has been added yet.'
        : `${initial.label || 'This field'} stays as it is.`,
      confirmLabel: 'Discard',
      cancelLabel: 'Keep editing',
    });
    if (decision && alive.current) onClose();
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (savingRef.current) return;
    setSubmitted(true);
    if (labelIssue) {
      labelRef.current?.focus();
      return;
    }
    if (!values.input_type) return;
    if (formatIssue) {
      formatRef.current?.focus();
      return;
    }
    if (patternIssue) {
      patternRef.current?.focus();
      return;
    }
    if (!creating && !dirty) return;
    savingRef.current = true;
    setSaving(true);
    setServerError(null);
    try {
      const result = await onSave({
        label: cleaned,
        input_type: values.input_type,
        is_required: values.is_required,
        ...draftFormat,
      });
      if (!alive.current) return;
      if (result.close) {
        onClose();
      } else if (result.error) {
        setServerError({ field: result.field ?? null, message: result.error });
        if (result.field === 'label') labelRef.current?.focus();
        if (result.field === 'input_format') formatRef.current?.focus();
        if (result.field === 'format_pattern') patternRef.current?.focus();
      }
    } finally {
      savingRef.current = false;
      if (alive.current) setSaving(false);
    }
  };

  return (
    <Modal
      open
      size="md"
      hideClose
      static={saving}
      onClose={() => void requestClose()}
      title={creating ? `Add a field to ${template.name}` : `Edit ${initial.label || 'field'}`}
      subtitle={creating ? 'Users fill it in when they sell this card type.' : template.name}
      footer={
        <div className={s.editorFooter}>
          <Button type="button" variant="ghost" disabled={saving} onClick={() => void requestClose()}>
            Cancel
          </Button>
          <Button type="submit" form={formId} variant="primary" loading={saving} disabled={!creating && !dirty}>
            {creating ? 'Add field' : 'Save field'}
          </Button>
        </div>
      }
    >
      <form id={formId} className={s.editorForm} noValidate onSubmit={(event) => void submit(event)}>
        <FieldShell label="Label" required error={labelError} help="Shown to users above the input, for example Card code.">
          <Input
            ref={labelRef}
            value={values.label}
            maxLength={LABEL_MAX}
            autoComplete="off"
            readOnly={saving}
            onChange={(event) => update({ label: event.target.value })}
          />
        </FieldShell>
        <RadioGroup<InputType>
          legend="What users provide"
          required
          options={TYPE_OPTIONS}
          value={values.input_type}
          error={typeError}
          disabled={saving}
          onChange={(next) => update({ input_type: next })}
        />
        {formatted ? (
          <FieldShell label="Format" error={formatError} help={values.format ? FORMAT_HINTS[values.format] : undefined}>
            <Select
              ref={formatRef}
              value={values.format ?? ''}
              disabled={saving}
              onChange={(event) => update({ format: isFormatChoice(event.target.value) ? event.target.value : null })}
            >
              {values.format === null ? <option value="" disabled>Choose a format</option> : null}
              {FORMAT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </Select>
          </FieldShell>
        ) : null}
        {formatted && values.format === 'custom' ? (
          <FieldShell label="Pattern" required error={patternError} help={PATTERN_HELP}>
            <Input
              ref={patternRef}
              mono
              value={values.pattern}
              maxLength={PATTERN_MAX}
              autoComplete="off"
              spellCheck={false}
              readOnly={saving}
              onChange={(event) => update({ pattern: event.target.value })}
            />
          </FieldShell>
        ) : null}
        {preview ? <FormatPreview key={preview.mask} format={preview} /> : null}
        <Checkbox
          checked={values.is_required}
          disabled={saving}
          label="Users must fill this in"
          description="If it is off, users can leave it empty."
          onChange={(next) => update({ is_required: next })}
        />
        {places.length > 0 ? (
          <Notice tone="info" compact>
            Applies to countries you add {template.name} to from now on. {listText(places)} {places.length === 1 ? 'keeps' : 'keep'} the fields {places.length === 1 ? 'it was' : 'they were'} added with.
          </Notice>
        ) : (
          <Notice tone="neutral" compact>
            {template.name} is not in any country yet, so users are not affected until you add it to one.
          </Notice>
        )}
        {formError ? (
          <Notice tone="danger" compact announce>
            {formError}
          </Notice>
        ) : null}
      </form>
    </Modal>
  );
}
