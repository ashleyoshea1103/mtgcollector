import { Link } from 'react-router';
import { Stack } from '../ui';

interface Props {
  /** What wasn't found, e.g. "card"; leave out for a page. */
  thing?: string;
  /** Where to look instead. */
  back?: { to: string; label: string };
}

/** Nothing at this address: no such page, or no such card or group. */
export function NotFoundPage({ thing = 'page', back = { to: '/', label: 'Go to the start' } }: Props) {
  const title = `${thing[0].toUpperCase()}${thing.slice(1)} not found`;
  return (
    <Stack as="section" className="not-found">
      <title>{`${title} · mtgcollector`}</title>
      <h1>{title}</h1>
      <p>{thing === 'page' ? "There's no page at this address." : `There's no ${thing} at this address. It may have been deleted.`}</p>
      <p>
        <Link to={back.to}>{back.label}</Link>
      </p>
    </Stack>
  );
}
