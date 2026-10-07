import { useState, type ReactNode } from 'react';
import { COLORS, RARITIES } from '../lib/labels';
import { slug } from './gallerySections';
import {
  Badge,
  Button,
  Chip,
  Cluster,
  DataTable,
  Dialog,
  Disclosure,
  EmptyState,
  ErrorState,
  Field,
  Grid,
  IconButton,
  Loading,
  Menu,
  MenuItem,
  NumberInput,
  Popover,
  SearchInput,
  SegmentedControl,
  Select,
  Skeleton,
  Stack,
  Tabs,
  TextInput,
  toast,
  ToggleButton,
  Tooltip,
  TooltipText,
  VisuallyHidden,
  type BadgeTone,
  type ButtonVariant,
} from '../ui';

const VARIANTS: ButtonVariant[] = ['primary', 'secondary', 'danger', 'ghost'];
const TONES: BadgeTone[] = ['neutral', 'accent', 'success', 'warning', 'danger'];
const swatch = (token: string) => (
  <span key={token} className="gallery__swatch">
    <span className="gallery__swatch-colour" style={{ background: `var(${token})` }} /> <code>{token}</code>
  </span>
);

/** Every src/ui primitive in its states, for review before styling. */
export function PrimitivesGallery() {
  const [busy, setBusy] = useState(false);
  const [foil, setFoil] = useState(false);
  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [finish, setFinish] = useState<'nonfoil' | 'foil'>('nonfoil');
  const [query, setQuery] = useState('');
  const [chips, setChips] = useState(['Red', 'Rare', 'Modern Horizons 2']);
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [lastAction, setLastAction] = useState<string | null>(null);

  return (
    <>
      <Section name="Design tokens" note="Placeholder values until the design brief; the names are the contract (src/styles/tokens.css).">
        <h3>Rarity</h3>
        <Cluster gap={4}>{Object.keys(RARITIES).map((r) => swatch(`--rarity-${r}`))}</Cluster>
        <h3>Mana</h3>
        <Cluster gap={4}>{Object.keys(COLORS).map((c) => swatch(`--mana-${c.toLowerCase()}`))}</Cluster>
        <h3>Spacing</h3>
        <Stack gap={1}>
          {[1, 2, 3, 4, 5, 6, 7].map((n) => (
            <span key={n}>
              <span className="gallery__space" style={{ width: `var(--space-${n})` }} /> <code>--space-{n}</code>
            </span>
          ))}
        </Stack>
      </Section>

      <Section name="Button / IconButton / ToggleButton" note="Busy buttons ignore presses but keep focus. The icon button's label shows as a tooltip on hover or focus.">
        <Cluster>
          {VARIANTS.map((v) => (
            <Button key={v} variant={v}>
              {v}
            </Button>
          ))}
          <Button isDisabled>Disabled</Button>
          <Button variant="primary" busy={busy} onPress={() => setBusy(true)}>
            {busy ? 'Saving…' : 'Save (goes busy)'}
          </Button>
          <Button onPress={() => setBusy(false)}>Reset</Button>
          <IconButton label="Delete entry" icon="🗑" variant="danger" />
          <ToggleButton selected={foil} onPress={() => setFoil(!foil)}>
            Foil only
          </ToggleButton>
        </Cluster>
      </Section>

      <Section name="Field / TextInput / NumberInput / Select / SearchInput" note="Search reports once typing pauses (300 ms), at once on Enter; Escape clears.">
        <Stack className="gallery__form">
          <Field label="Group name" description="Shown on the group's card.">
            <TextInput value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Quantity" error={Number(quantity) > 999 ? 'At most 999' : undefined}>
            <NumberInput min={1} max={999} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          </Field>
          <Field label="Finish">
            <Select
              options={[
                { value: 'nonfoil', label: 'Non-foil' },
                { value: 'foil', label: 'Foil' },
              ]}
              value={finish}
              onChange={setFinish}
            />
          </Field>
          <Field label="Search cards">
            <SearchInput onSearch={setQuery} placeholder="e.g. bolt" />
          </Field>
          <p>Last search: {query === '' ? '(none)' : <q>{query}</q>}</p>
        </Stack>
      </Section>

      <Section name="Badge / Chip">
        <Cluster>
          {TONES.map((t) => (
            <Badge key={t} tone={t}>
              {t}
            </Badge>
          ))}
        </Cluster>
        <Cluster>
          {chips.map((c) => (
            <Chip key={c} onRemove={() => setChips(chips.filter((x) => x !== c))}>
              {c}
            </Chip>
          ))}
          <Chip>Not removable</Chip>
        </Cluster>
      </Section>

      <Section name="Disclosure" note="Content renders only while open.">
        <Disclosure title="Open by default" headingLevel={3}>
          <p>Some content.</p>
        </Disclosure>
        <Disclosure title="Closed by default" headingLevel={3} defaultOpen={false}>
          <p>Hidden content.</p>
        </Disclosure>
      </Section>

      <Section name="Stack / Cluster / Grid">
        <Stack gap={2}>
          <span className="gallery__box">Stack 1</span>
          <span className="gallery__box">Stack 2</span>
        </Stack>
        <Cluster gap={2}>
          {['Cluster', 'wraps', 'when', 'out', 'of', 'room'].map((w) => (
            <span key={w} className="gallery__box">
              {w}
            </span>
          ))}
        </Cluster>
        <Grid minItemWidth="8rem" gap={2}>
          {Array.from({ length: 6 }, (_, i) => (
            <span key={i} className="gallery__box">
              Grid {i + 1}
            </span>
          ))}
        </Grid>
      </Section>

      <Section name="Loading / Skeleton / ErrorState / EmptyState">
        <Loading label="Loading cards…" />
        <Skeleton lines={3} width="60%" />
        <ErrorState message="Couldn't load your collection." onRetry={() => toast({ title: 'Retrying…' })} />
        <EmptyState title="No cards yet" action={<Button variant="primary">Add cards</Button>}>
          Search for a card to add it to your collection.
        </EmptyState>
      </Section>

      <Section name="DataTable" note="A real table: the name column is the row header; the actions header is for screen readers only.">
        <DataTable
          aria-label="Example"
          rows={[
            { id: 1, name: 'Lightning Bolt', qty: 4 },
            { id: 2, name: 'Llanowar Elves', qty: 1 },
          ]}
          rowKey={(r) => r.id}
          columns={[
            { key: 'qty', header: 'Qty', cell: (r) => r.qty },
            { key: 'name', header: 'Name', rowHeader: true, cell: (r) => r.name },
            { key: 'actions', header: 'Actions', hideHeader: true, cell: () => <Button>Remove</Button> },
          ]}
        />
      </Section>

      <Section name="Tooltip / TooltipText" note="Hover the abbreviations; screen readers read the full form instead. Tab to the button for a tooltip on focus.">
        <p>
          Condition{' '}
          <TooltipText as="abbr" tooltip="Near Mint">
            NM
          </TooltipText>
          , language{' '}
          <TooltipText as="abbr" tooltip="German">
            DE
          </TooltipText>
          , price <TooltipText tooltip="No price available">—</TooltipText>
        </p>
        <Tooltip content="Sorts by Cardmarket price, highest first">
          <Button>Sort by price</Button>
        </Tooltip>
      </Section>

      <Section name="Dialog" note="Focus stays inside until it closes; Escape closes it. The delete confirmation can't be dismissed by clicking outside.">
        <Cluster>
          <Dialog title="Rename group" trigger={<Button>Rename…</Button>}>
            {(close) => (
              <Stack>
                <Field label="Name">
                  <TextInput defaultValue="Trade binder" />
                </Field>
                <Cluster>
                  <Button variant="primary" onPress={close}>
                    Save
                  </Button>
                  <Button onPress={close}>Cancel</Button>
                </Cluster>
              </Stack>
            )}
          </Dialog>
          <Dialog title="Delete Trade binder?" role="alertdialog" trigger={<Button variant="danger">Delete…</Button>}>
            {(close) => (
              <Stack>
                <p>Its cards stay in your collection.</p>
                <Cluster>
                  <Button variant="danger" onPress={close}>
                    Delete
                  </Button>
                  <Button onPress={close}>Cancel</Button>
                </Cluster>
              </Stack>
            )}
          </Dialog>
        </Cluster>
      </Section>

      <Section name="Menu / MenuItem / Popover">
        <Cluster>
          <Menu trigger={<Button>Actions</Button>} onAction={(id) => setLastAction(String(id))}>
            <MenuItem id="edit">Edit</MenuItem>
            <MenuItem id="move" isDisabled>
              Move to group
            </MenuItem>
            <MenuItem id="delete" danger>
              Delete
            </MenuItem>
          </Menu>
          <Popover trigger={<Button>Filters</Button>} title="Filter cards">
            <p>Filter controls go here.</p>
          </Popover>
        </Cluster>
        <p>Last action: {lastAction ?? '(none)'}</p>
      </Section>

      <Section name="SegmentedControl / Tabs">
        <SegmentedControl
          label="View"
          options={[
            { value: 'grid', label: 'Grid' },
            { value: 'list', label: 'List' },
          ]}
          value={view}
          onChange={setView}
        />
        <p>View: {view}</p>
        <Tabs
          label="Collection"
          tabs={[
            { id: 'cards', label: 'Cards', content: <p>All your cards.</p> },
            { id: 'stats', label: 'Stats', content: <p>Totals and breakdowns.</p> },
          ]}
        />
      </Section>

      <Section name="Toaster / toast" note="Toasts close after 5 seconds; errors stay until dismissed. F6 jumps to them.">
        <Cluster>
          <Button onPress={() => toast({ title: 'Added 4 × Lightning Bolt', description: 'to Trade binder', tone: 'success' })}>Success toast</Button>
          <Button onPress={() => toast({ title: "Couldn't save", description: 'Check your connection and try again.', tone: 'error' })}>
            Error toast
          </Button>
        </Cluster>
      </Section>

      <Section name="VisuallyHidden" note="The button below shows only ×; screen readers hear “Close”.">
        <button type="button">
          <span aria-hidden>×</span>
          <VisuallyHidden>Close</VisuallyHidden>
        </button>
      </Section>
    </>
  );
}

export function Section({ name, note, children }: { name: string; note?: string; children: ReactNode }) {
  return (
    <section id={slug(name)} className="gallery__section">
      <h2>{name}</h2>
      {note && <p className="gallery__note">{note}</p>}
      {children}
    </section>
  );
}
