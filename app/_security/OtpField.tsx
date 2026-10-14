'use client';

import { forwardRef } from 'react';
import { Input, type InputProps } from '../_ui/Field';
import { OTP_INPUT_ATTRIBUTES, sanitizeOtp } from '../lib/adminSecurity';

export interface OtpFieldProps
  extends Omit<InputProps, 'value' | 'defaultValue' | 'onChange' | 'type' | 'inputMode' | 'autoComplete' | 'mono' | 'maxLength'> {
  value: string;
  onValueChange: (next: string) => void;
}

export const OtpField = forwardRef<HTMLInputElement, OtpFieldProps>(function OtpField(
  { value, onValueChange, name = 'otp', ...rest },
  ref,
) {
  return (
    <Input
      ref={ref}
      mono
      {...OTP_INPUT_ATTRIBUTES}
      name={name}
      {...rest}
      value={value}
      onChange={(event) => onValueChange(sanitizeOtp(event.target.value))}
    />
  );
});
