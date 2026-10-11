import { Link, Navigate, useSearchParams } from 'react-router';
import { useLogin, useMe, useSignup } from '../api/queries';
import { AuthForm } from '../components/AuthForm';
import { errorMessage } from '../lib/messages';
import { nextPath } from '../lib/nextPath';
import type { Credentials } from '../types';
import { Loading, Stack } from '../ui';

interface Props {
  mode: 'login' | 'signup';
}

/** Logging in, or making an account; then on to the page that sent you here (?next=), or your collection. */
export function AuthPage({ mode }: Props) {
  const me = useMe();
  const login = useLogin();
  const signup = useSignup();
  const [params] = useSearchParams();
  const next = nextPath(params.get('next'), '/collection');
  const attempt = mode === 'login' ? login : signup;
  // The other page, keeping where to go afterwards.
  const other = `/${mode === 'login' ? 'signup' : 'login'}${params.has('next') ? `?next=${encodeURIComponent(params.get('next')!)}` : ''}`;

  // Signed in, already or just now: on to the next page.
  if (me.data) return <Navigate to={next} replace />;
  if (me.isPending) return <Loading />;

  return (
    <Stack as="section" className={`auth-page auth-page--${mode}`}>
      <title>{`${mode === 'login' ? 'Log in' : 'Sign up'} · mtgcollector`}</title>
      <h1>{mode === 'login' ? 'Log in' : 'Create an account'}</h1>
      <AuthForm
        // A fresh form for each page, so a password typed on one isn't carried to the other.
        key={mode}
        mode={mode}
        onSubmit={(c: Credentials) => attempt.mutate(c)}
        submitting={attempt.isPending}
        error={attempt.isError ? errorMessage(attempt.error) : undefined}
      />
      <p>
        {mode === 'login' ? 'No account yet? ' : 'Have an account? '}
        <Link to={other}>{mode === 'login' ? 'Sign up' : 'Log in'}</Link>
      </p>
    </Stack>
  );
}
