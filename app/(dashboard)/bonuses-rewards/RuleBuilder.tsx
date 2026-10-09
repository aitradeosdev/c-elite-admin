'use client';

import { Plus, TriangleAlert, X } from 'lucide-react';
import { Button, FieldShell, Input, Select } from '../../_ui';
import {
  DEFAULT_RULE_TYPE, LEVEL_COUNT, OFFERED_RULES, RULES_MAX, RULE_GROUPS, describeRule, ruleSpec, type RuleKind,
} from './rewardRules';
import { isLegacyRule, newRuleDraft, ruleFromDraft, type RuleDraft } from './model';
import s from './page.module.css';

interface ValueField {
  slot: 'a' | 'b';
  label: string;
  placeholder?: string;
  numeric: boolean;
  wide?: boolean;
}

const VALUE_FIELDS: Readonly<Record<RuleKind, readonly ValueField[]>> = {
  count: [{ slot: 'a', label: 'At least', numeric: true }],
  days: [{ slot: 'a', label: 'Days', numeric: true }],
  level: [{ slot: 'a', label: `Level (1–${LEVEL_COUNT})`, numeric: true }],
  usd: [{ slot: 'a', label: 'At least ($)', numeric: true }],
  naira: [{ slot: 'a', label: 'At least (₦)', numeric: true }],
  text: [{ slot: 'a', label: 'Card name', placeholder: 'e.g. Amazon', numeric: false, wide: true }],
  list: [{ slot: 'a', label: 'Countries, comma-separated', placeholder: 'e.g. Nigeria', numeric: false, wide: true }],
  none: [],
  countDays: [
    { slot: 'a', label: 'Trades (at least)', numeric: true },
    { slot: 'b', label: 'In the last (days)', numeric: true },
  ],
  usdDays: [
    { slot: 'a', label: 'At least ($)', numeric: true },
    { slot: 'b', label: 'In the last (days)', numeric: true },
  ],
  usdCard: [
    { slot: 'a', label: 'At least ($)', numeric: true },
    { slot: 'b', label: 'On card (blank for any)', placeholder: 'Any card', numeric: false, wide: true },
  ],
};

export interface RuleBuilderProps {
  idBase: string;
  rules: readonly RuleDraft[];
  problems: Readonly<Record<string, string>>;
  warnings: Readonly<Record<string, string>>;
  disabled?: boolean;
  nextKey: () => string;
  onChange: (next: RuleDraft[]) => void;
  onBlur: (key: string) => void;
}

export function RuleBuilder({ idBase, rules, problems, warnings, disabled, nextKey, onChange, onBlur }: RuleBuilderProps) {
  const helpId = `${idBase}-rules-help`;
  const update = (key: string, patch: Partial<RuleDraft>) => {
    onChange(rules.map((rule) => (rule.key === key ? { ...rule, ...patch } : rule)));
  };
  const remove = (key: string) => onChange(rules.filter((rule) => rule.key !== key));
  const add = () => onChange([...rules, newRuleDraft(nextKey(), DEFAULT_RULE_TYPE)]);
  const full = rules.length >= RULES_MAX;

  return (
    <fieldset className={s.rules} aria-describedby={helpId}>
      <legend className={s.rulesLegend}>Who can claim</legend>
      <p id={helpId} className={s.rulesHelp}>
        A user must pass every rule. With no rules, every user can claim the gift box once.
      </p>
      {rules.length === 0 ? (
        <p className={s.rulesEmpty}>No rules yet: every user can claim this gift box once.</p>
      ) : (
        <ol className={s.ruleList}>
          {rules.map((rule, index) => (
            <RuleRow
              key={rule.key}
              rule={rule}
              position={index + 1}
              idBase={`${idBase}-${rule.key}`}
              problem={problems[rule.key] ?? null}
              warning={warnings[rule.key] ?? null}
              disabled={disabled}
              onType={(type) => update(rule.key, { type, a: '', b: '' })}
              onValue={(slot, value) => update(rule.key, slot === 'a' ? { a: value } : { b: value })}
              onRemove={() => remove(rule.key)}
              onBlur={() => onBlur(rule.key)}
            />
          ))}
        </ol>
      )}
      <div className={s.rulesFoot}>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          leftIcon={<Plus size={14} aria-hidden />}
          disabled={disabled || full}
          onClick={add}
        >
          Add rule
        </Button>
        {full ? <span className={s.rulesLimit}>A gift box can have at most {RULES_MAX} rules.</span> : null}
      </div>
    </fieldset>
  );
}

interface RuleRowProps {
  rule: RuleDraft;
  position: number;
  idBase: string;
  problem: string | null;
  warning: string | null;
  disabled?: boolean;
  onType: (type: string) => void;
  onValue: (slot: 'a' | 'b', value: string) => void;
  onRemove: () => void;
  onBlur: () => void;
}

function RuleRow({ rule, position, idBase, problem, warning, disabled, onType, onValue, onRemove, onBlur }: RuleRowProps) {
  const legacy = isLegacyRule(rule);
  const spec = ruleSpec(rule.type);
  const parsed = legacy ? rule.legacy : ruleFromDraft(rule).rule;
  const summary = describeRule(parsed ?? { type: rule.type, value: null });
  const problemId = `${idBase}-problem`;
  const noteId = problem ? problemId : warning ? `${idBase}-warning` : undefined;
  const fields = spec && !legacy ? VALUE_FIELDS[spec.kind] : [];

  return (
    <li className={[s.ruleRow, problem ? s.ruleRowInvalid : warning ? s.ruleRowWarning : null].filter(Boolean).join(' ')}>
      <div className={s.ruleBody}>
        {legacy ? (
          <p className={s.ruleLegacy}>
            <span className={s.ruleLegacyLabel}>Rule {position}</span>
            <span className={s.ruleLegacyText}>{describeRule(rule.legacy)}</span>
          </p>
        ) : (
          <div className={s.ruleFields}>
            <FieldShell label={`Rule ${position}`} htmlFor={`${idBase}-type`} className={s.ruleType}>
              <Select
                id={`${idBase}-type`}
                size="sm"
                value={rule.type}
                disabled={disabled}
                aria-describedby={noteId}
                onChange={(event) => onType(event.target.value)}
              >
                {RULE_GROUPS.map((group) => {
                  const options = OFFERED_RULES.filter((option) => option.group === group);
                  if (options.length === 0) return null;
                  return (
                    <optgroup key={group} label={group}>
                      {options.map((option) => <option key={option.type} value={option.type}>{option.label}</option>)}
                    </optgroup>
                  );
                })}
              </Select>
            </FieldShell>
            {fields.map((field) => (
              <FieldShell
                key={field.slot}
                label={field.label}
                htmlFor={`${idBase}-${field.slot}`}
                className={field.wide ? s.ruleValueWide : s.ruleValue}
              >
                <Input
                  id={`${idBase}-${field.slot}`}
                  size="sm"
                  mono={field.numeric}
                  inputMode={field.numeric ? 'decimal' : undefined}
                  autoComplete="off"
                  placeholder={field.placeholder}
                  value={rule[field.slot]}
                  disabled={disabled}
                  invalid={Boolean(problem)}
                  aria-label={`Rule ${position}, ${spec?.label ?? 'rule'}: ${field.label}`}
                  aria-describedby={noteId}
                  onChange={(event) => onValue(field.slot, event.target.value)}
                  onBlur={onBlur}
                />
              </FieldShell>
            ))}
            {fields.length === 0 ? <p className={s.ruleNoValue}>No value needed.</p> : null}
          </div>
        )}
        {problem ? (
          <p id={problemId} className={s.ruleProblem}>{problem}</p>
        ) : warning ? (
          <p id={`${idBase}-warning`} className={s.ruleWarning}>
            <TriangleAlert size={14} aria-hidden className={s.ruleWarningIcon} />
            <span>{warning}</span>
          </p>
        ) : null}
      </div>
      <Button
        id={`${idBase}-remove`}
        type="button"
        variant="ghost"
        size="sm"
        iconOnly
        className={s.ruleRemove}
        leftIcon={<X size={14} aria-hidden />}
        aria-label={`Remove rule ${position}: ${summary}`}
        disabled={disabled}
        onClick={onRemove}
      />
    </li>
  );
}
