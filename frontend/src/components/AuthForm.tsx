import { useState, type FormEvent } from 'react';
import { passwordProblem } from '../lib/auth';
import { MaxPasswordLength, MinPasswordLength, type Credentials } from '../types';
import { Button, Field, FormError, Stack, TextInput } from '../ui';

interface Props {
  /** Logging in to an account, or making one. */
  mode: 'login' | 'signup';
  onSubmit: (credentials: Credentials) => void;
  submitting?: boolean;
  /** Why the last attempt failed, e.g. "Email or password is incorrect." */
  error?: string;
}

const TEXT = {
  login: { submit: 'Log in', busy: 'Logging in…', password: 'current-password' },
  signup: { submit: 'Create account', busy: 'Creating account…', password: 'new-password' },
} as const;

/** An email address and password, for logging in or signing up. A new password's length is checked before it's sent. */
export function AuthForm({ mode, onSubmit, submitting = false, error }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  // Shown once the form is submitted, then updated as the password is retyped.
  const [checked, setChecked] = useState(false);
  const problem = mode === 'signup' && checked ? passwordProblem(password) : undefined;
  const text = TEXT[mode];

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setChecked(true);
    if (mode === 'signup' && passwordProblem(password)) return;
    // The password is sent as typed: spaces in it are part of it.
    onSubmit({ email: email.trim(), password });
  }

  return (
    <form className={`auth-form auth-form--${mode}`} onSubmit={handleSubmit}>
      <Stack>
        <Field label="Email">
          {/* "username" on logging in: what password managers look for beside a current password. */}
          <TextInput type="email" autoComplete={mode === 'login' ? 'username' : 'email'} required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field
          label="Password"
          description={mode === 'signup' ? `${MinPasswordLength} to ${MaxPasswordLength} characters. A few words together make a password that's long but easy to remember.` : undefined}
          error={problem}
        >
          <TextInput type="password" autoComplete={text.password} required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        {error && <FormError className="auth-form__error">{error}</FormError>}
        <Button type="submit" variant="primary" busy={submitting}>
          {submitting ? text.busy : text.submit}
        </Button>
      </Stack>
    </form>
  );
}
