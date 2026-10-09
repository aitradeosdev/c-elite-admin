'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Button, Checkbox, FieldShell, Input, Modal, Notice, RadioGroup, useConfirm } from '../../_ui';
import {
  INPUT_TYPES, INPUT_TYPE_HINTS, INPUT_TYPE_LABELS, LABEL_MAX, NAME_MAX, cleanText, findDuplicate, isInputType,
  labelProblem, nameProblem, type InputType,
} from './rules';
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
}

interface FieldValues {
  label: string;
  input_type: InputType | null;
  is_required: boolean;
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
  const savingRef = useRef(false);
  const [initial] = useState<FieldValues>(() => ({
    label: field?.label ?? '',
    input_type: field ? (isInputType(field.input_type) ? field.input_type : null) : 'text',
    is_required: field ? field.is_required : true,
  }));
  const [places] = useState(() => template.countries.map((install) => countryLabel(install, countries)));
  const [values, setValues] = useState<FieldValues>(initial);
  const [submitted, setSubmitted] = useState(false);
  const [serverError, setServerError] = useState<ServerError | null>(null);
  const [saving, setSaving] = useState(false);

  const creating = mode === 'create';
  const cleaned = cleanText(values.label);
  const dirty = cleaned !== cleanText(initial.label)
    || values.input_type !== initial.input_type
    || values.is_required !== initial.is_required;
  const duplicate = findDuplicate(template.fields, (item) => item.label, cleaned, field?.id ?? null);
  const labelIssue = labelProblem(cleaned) ?? (duplicate ? `${template.name} already has a field called ${duplicate.label}.` : null);
  const typeIssue = values.input_type ? null : 'Choose what users provide.';
  const labelError = serverError?.field === 'label' ? serverError.message : submitted ? labelIssue : null;
  const typeError = serverError?.field === 'input_type' ? serverError.message : submitted ? typeIssue : null;
  const formError = serverError && serverError.field !== 'label' && serverError.field !== 'input_type'
    ? serverError.message
    : null;

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
    if (!creating && !dirty) return;
    savingRef.current = true;
    setSaving(true);
    setServerError(null);
    try {
      const result = await onSave({ label: cleaned, input_type: values.input_type, is_required: values.is_required });
      if (!alive.current) return;
      if (result.close) {
        onClose();
      } else if (result.error) {
        setServerError({ field: result.field ?? null, message: result.error });
        if (result.field === 'label') labelRef.current?.focus();
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
