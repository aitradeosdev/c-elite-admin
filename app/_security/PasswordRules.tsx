'use client';

import { Check, Circle } from 'lucide-react';
import type { OwnPasswordRule } from '../lib/passwordPolicy';
import s from './security.module.css';

export interface PasswordRuleItem {
  id: OwnPasswordRule;
  label: string;
  met: boolean;
}

export interface PasswordRulesProps {
  id: string;
  items: readonly PasswordRuleItem[];
}

export function PasswordRules({ id, items }: PasswordRulesProps) {
  return (
    <ul id={id} className={s.rules} aria-label="Password requirements">
      {items.map((item) => (
        <li key={item.id} className={item.met ? s.ruleMet : s.rule}>
          <span className={s.ruleIcon} aria-hidden>
            {item.met ? <Check size={14} /> : <Circle size={14} />}
          </span>
          <span>{item.label}</span>
          <span className={s.srOnly}>{item.met ? ', met' : ', not met yet'}</span>
        </li>
      ))}
    </ul>
  );
}
