import { Link } from 'react-router';

/** Placeholder until the search, collection and groups pages are wired to the API. */
export function Home() {
  return (
    <main>
      <h1>mtgcollector</h1>
      <p>
        <Link to="/dev/components">Component gallery</Link>
      </p>
    </main>
  );
}
