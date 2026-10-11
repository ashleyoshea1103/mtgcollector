import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { EMPTY_SEARCH } from '../lib/search';
import { cards, customGroups, entries, makeEntry } from '../fixtures';
import type { CardSearch } from '../api/endpoints';
import { MaxGroupDescriptionLength, type Credentials, type EntryChange, type NewGroup } from '../types';
import { AuthForm } from './AuthForm';
import { EntryChangeForm } from './EntryChangeForm';
import { GroupForm } from './GroupForm';
import { ListingControls } from './ListingControls';
import { MemberForm } from './MemberForm';
import { SearchFilters } from './SearchFilters';
import type { ListingParams } from '../lib/listingParams';

describe('AuthForm', () => {
  it('logs in with the email trimmed and the password as typed, without a length check', async () => {
    const onSubmit = vi.fn<(c: Credentials) => void>();
    render(<AuthForm mode="login" onSubmit={onSubmit} />);
    const password = screen.getByLabelText('Password');
    // What password managers look for beside a current password.
    expect(screen.getByRole('textbox', { name: 'Email' })).toHaveAttribute('autocomplete', 'username');
    expect(password).toHaveAttribute('autocomplete', 'current-password');
    expect(password).not.toHaveAccessibleDescription();
    await userEvent.type(screen.getByRole('textbox', { name: 'Email' }), ' ann@example.com ');
    await userEvent.type(password, ' short ');
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }));
    expect(onSubmit).toHaveBeenCalledWith({ email: 'ann@example.com', password: ' short ' });
  });

  it('describes a new password, and checks its length before sending it', async () => {
    const onSubmit = vi.fn<(c: Credentials) => void>();
    render(<AuthForm mode="signup" onSubmit={onSubmit} />);
    const password = screen.getByLabelText('Password');
    expect(screen.getByRole('textbox', { name: 'Email' })).toHaveAttribute('autocomplete', 'email');
    expect(password).toHaveAttribute('autocomplete', 'new-password');
    expect(password).toHaveAccessibleDescription(expect.stringContaining('15 to 256 characters.'));
    await userEvent.type(screen.getByRole('textbox', { name: 'Email' }), 'ann@example.com');
    await userEvent.type(password, 'fourteen chars');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(password).toHaveAttribute('aria-invalid', 'true');
    expect(onSubmit).not.toHaveBeenCalled();
    // The message follows the password as it's retyped.
    await userEvent.type(password, '!');
    expect(password).not.toHaveAttribute('aria-invalid');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(onSubmit).toHaveBeenCalledWith({ email: 'ann@example.com', password: 'fourteen chars!' });
  });

  it('shows why the last attempt failed, and ignores submits while busy', async () => {
    const onSubmit = vi.fn<(c: Credentials) => void>();
    render(<AuthForm mode="login" onSubmit={onSubmit} submitting error="Email or password is incorrect." />);
    expect(screen.getByRole('alert')).toHaveTextContent('Email or password is incorrect.');
    await userEvent.type(screen.getByRole('textbox', { name: 'Email' }), 'ann@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'pw{Enter}');
    expect(screen.getByRole('button', { name: 'Logging in…' })).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe('GroupForm', () => {
  it('makes a binder by default', async () => {
    const onSubmit = vi.fn<(g: NewGroup) => void>();
    render(<GroupForm onSubmit={onSubmit} />);
    expect(screen.getByRole('combobox', { name: 'Kind' })).toHaveValue('binder');
    await userEvent.type(screen.getByRole('textbox', { name: 'Name' }), 'Trades');
    await userEvent.click(screen.getByRole('button', { name: 'Make group' }));
    expect(onSubmit).toHaveBeenCalledWith({ name: 'Trades', kind: 'binder', description: '' });
  });

  it("starts from the group being changed, and saves", async () => {
    const onSubmit = vi.fn<(g: NewGroup) => void>();
    const onCancel = vi.fn<() => void>();
    const g = customGroups[1];
    render(<GroupForm group={{ name: g.name, kind: g.kind, description: g.description }} onSubmit={onSubmit} onCancel={onCancel} />);
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue(g.name);
    expect(screen.getByRole('combobox', { name: 'Kind' })).toHaveValue('deck');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Kind' }), 'Box');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSubmit).toHaveBeenCalledWith({ name: g.name, kind: 'box', description: g.description });
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalled();
  });

  it('submits only its own fields, though given a whole group', async () => {
    const onSubmit = vi.fn<(g: NewGroup) => void>();
    render(<GroupForm group={customGroups[0]} onSubmit={onSubmit} />);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSubmit).toHaveBeenCalledWith({ name: customGroups[0].name, kind: customGroups[0].kind, description: customGroups[0].description });
  });

  it('refuses a description over the limit', async () => {
    const onSubmit = vi.fn<(g: NewGroup) => void>();
    render(<GroupForm group={{ name: 'Box', kind: 'box', description: 'x'.repeat(MaxGroupDescriptionLength + 1) }} onSubmit={onSubmit} />);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('textbox', { name: 'Description' })).toHaveAccessibleDescription(expect.stringContaining(`Use at most ${MaxGroupDescriptionLength} characters.`));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('shows why the last attempt failed', () => {
    render(<GroupForm onSubmit={() => {}} error="You already have a group with that name." />);
    expect(screen.getByRole('alert')).toHaveTextContent('You already have a group with that name.');
  });
});

describe('EntryChangeForm', () => {
  it('starts from the entry and sends only what changed', async () => {
    const onSubmit = vi.fn<(c: EntryChange) => void>();
    render(<EntryChangeForm entry={entries.germanDelver} onSubmit={onSubmit} />);
    expect(screen.getByRole('spinbutton', { name: 'Quantity' })).toHaveValue(2);
    expect(screen.getByRole('combobox', { name: 'Condition' })).toHaveValue('EX');
    expect(screen.getByRole('combobox', { name: 'Language' })).toHaveValue('de');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Language' }), 'English');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSubmit).toHaveBeenCalledWith({ language: 'en' });
  });

  it("offers the printing's finishes, and keeps the entry's own if the printing no longer lists it", () => {
    const { rerender } = render(<EntryChangeForm entry={entries.etchedFireIce} onSubmit={() => {}} />);
    const finishes = () => [...screen.getByRole('combobox', { name: 'Finish' }).querySelectorAll('option')].map((o) => o.value);
    expect(finishes()).toEqual(cards.fireIce.finishes);
    const oddEntry = makeEntry(9, { ...cards.lightningBolt, finishes: ['nonfoil'] }, { finish: 'foil' });
    rerender(<EntryChangeForm entry={oddEntry} onSubmit={() => {}} />);
    expect(finishes()).toEqual(['foil', 'nonfoil']);
    expect(screen.getByRole('combobox', { name: 'Finish' })).toHaveValue('foil');
  });

  it('sends a typed quantity as a whole number in range', async () => {
    const onSubmit = vi.fn<(c: EntryChange) => void>();
    render(<EntryChangeForm entry={entries.bolts} onSubmit={onSubmit} />);
    const quantity = screen.getByRole('spinbutton', { name: 'Quantity' });
    await userEvent.clear(quantity);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSubmit).toHaveBeenLastCalledWith({ quantity: 1 });
  });
});

describe('MemberForm', () => {
  const groups = customGroups;

  it('chooses a group and how many copies, starting from what the group holds', async () => {
    const onSubmit = vi.fn<(q: number) => void>();
    const onGroupChange = vi.fn<(id: number) => void>();
    const { rerender } = render(<MemberForm entry={entries.bolts} groups={groups} groupId={groups[0].id} current={null} onGroupChange={onGroupChange} onSubmit={onSubmit} />);
    const copies = screen.getByRole('spinbutton', { name: 'Copies in the group' });
    expect(copies).toHaveValue(1);
    expect(copies).toHaveAttribute('max', '4');
    expect(copies).toHaveAccessibleDescription('Up to 4 copies, all you have. It has none now.');
    expect(screen.getByRole('button', { name: 'Add to group' })).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Group' }), groups[1].name);
    expect(onGroupChange).toHaveBeenCalledWith(groups[1].id);
    // Unknown while the new group's copies load, then known.
    rerender(<MemberForm entry={entries.bolts} groups={groups} groupId={groups[1].id} current={undefined} onSubmit={onSubmit} />);
    expect(copies).toHaveAccessibleDescription('Up to 4 copies, all you have.');
    rerender(<MemberForm entry={entries.bolts} groups={groups} groupId={groups[1].id} current={3} onSubmit={onSubmit} />);
    expect(copies).toHaveValue(3);
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSubmit).toHaveBeenCalledWith(3);
  });

  it('keeps what was typed for a group until another is chosen', async () => {
    const { rerender } = render(<MemberForm entry={entries.bolts} groups={groups} groupId={groups[0].id} current={null} onSubmit={() => {}} />);
    const copies = screen.getByRole('spinbutton', { name: 'Copies in the group' });
    await userEvent.clear(copies);
    await userEvent.type(copies, '2');
    rerender(<MemberForm entry={entries.bolts} groups={groups} groupId={groups[0].id} current={null} onSubmit={() => {}} />);
    expect(copies).toHaveValue(2);
    rerender(<MemberForm entry={entries.bolts} groups={groups} groupId={groups[1].id} current={null} onSubmit={() => {}} />);
    expect(copies).toHaveValue(1);
  });

  it('offers no group choice when the group is already chosen', () => {
    render(<MemberForm entry={entries.bolts} groupId={groups[0].id} current={2} onSubmit={() => {}} />);
    expect(screen.queryByRole('combobox', { name: 'Group' })).not.toBeInTheDocument();
    expect(screen.getByRole('spinbutton', { name: 'Copies in the group' })).toHaveValue(2);
  });

  it("can't be submitted without a group", async () => {
    const onSubmit = vi.fn<(q: number) => void>();
    render(<MemberForm entry={entries.bolts} groups={[]} groupId={null} onSubmit={onSubmit} />);
    expect(screen.getByRole('button', { name: 'Add to group' })).toBeDisabled();
    await userEvent.type(screen.getByRole('spinbutton', { name: 'Copies in the group' }), '{Enter}');
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe('ListingControls', () => {
  it('reports each change with the rest kept', async () => {
    const onChange = vi.fn<(v: ListingParams) => void>();
    const value: ListingParams = { groupBy: 'color', sort: 'name', view: 'grid' };
    render(<ListingControls value={value} onChange={onChange} />);
    expect(screen.getByRole('combobox', { name: 'Group by' })).toHaveValue('color');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Group by' }), 'Mana value');
    expect(onChange).toHaveBeenLastCalledWith({ ...value, groupBy: 'cmc' });
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Sort by' }), 'Newest first');
    expect(onChange).toHaveBeenLastCalledWith({ ...value, sort: 'added' });
    await userEvent.click(screen.getByRole('radio', { name: 'List' }));
    expect(onChange).toHaveBeenLastCalledWith({ ...value, view: 'list' });
  });
});

describe('SearchFilters', () => {
  const setup = (value: CardSearch = EMPTY_SEARCH) => {
    const onChange = vi.fn<(s: CardSearch) => void>();
    render(<SearchFilters value={value} onChange={onChange} />);
    return onChange;
  };

  it('is a search landmark with the name first', () => {
    setup();
    expect(screen.getByRole('search')).toBeInTheDocument();
    expect(screen.getAllByRole('searchbox')[0]).toHaveAccessibleName('Card name');
  });

  it('reports typed text once typing pauses, and set codes in lower case', async () => {
    const onChange = setup();
    await userEvent.type(screen.getByRole('searchbox', { name: 'Set code' }), 'MH2{Enter}');
    expect(onChange).toHaveBeenLastCalledWith({ ...EMPTY_SEARCH, set: 'mh2' });
  });

  it('keeps colors in WUBRG order, and colourless on its own', async () => {
    const onChange = setup({ ...EMPTY_SEARCH, colors: 'G' });
    await userEvent.click(screen.getByRole('checkbox', { name: 'White' }));
    expect(onChange).toHaveBeenLastCalledWith({ ...EMPTY_SEARCH, colors: 'WG' });
    await userEvent.click(screen.getByRole('checkbox', { name: 'Green' }));
    expect(onChange).toHaveBeenLastCalledWith({ ...EMPTY_SEARCH, colors: '' });
    await userEvent.click(screen.getByRole('checkbox', { name: 'Colorless' }));
    expect(onChange).toHaveBeenLastCalledWith({ ...EMPTY_SEARCH, colors: 'C' });
  });

  it('shows colourless as chosen and the colors as not', () => {
    setup({ ...EMPTY_SEARCH, colors: 'C' });
    expect(screen.getByRole('checkbox', { name: 'Colorless' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Red' })).not.toBeChecked();
  });

  it('says when a set code cannot be one', () => {
    setup({ ...EMPTY_SEARCH, set: 'm-h' });
    expect(screen.getByRole('searchbox', { name: 'Set code' })).toHaveAccessibleDescription('A set code is letters and digits, like mh2.');
  });
});
