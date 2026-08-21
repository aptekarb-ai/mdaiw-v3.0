import type { InputHTMLAttributes } from 'react';
import { FormField } from './FormField';

interface DateFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  id: string;
  label: string;
  error?: string;
  required?: boolean;
}

export function DateField(props: DateFieldProps) {
  return <FormField type="date" {...props} />;
}
