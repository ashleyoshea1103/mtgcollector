// One function per API endpoint (README "API"), typed by the contract in ../types.ts.
import type {
  Card,
  CardCopies,
  CardNames,
  CardPage,
  CollectionEntry,
  CollectionGroups,
  CollectionStats,
  Credentials,
  CustomGroup,
  CustomGroupList,
  EntryChange,
  EntryPage,
  GroupBy,
  GroupChange,
  GroupMember,
  GroupMemberPage,
  NewEntry,
  NewGroup,
  Rarity,
  SortBy,
  User,
} from '../types';
import { ApiError, request, segment, send } from './client';

/** What a card search asks for (GET /api/cards/search). Empty fields are left out. */
export interface CardSearch {
  /** Words the name contains. */
  q: string;
  /** A set code, e.g. "mh2". */
  set: string;
  /** Words the type line contains. */
  type: string;
  rarity: Rarity | '';
  /** Letters from WUBRG the card must all be, or "C" for colourless. */
  colors: string;
  /** Include tokens, emblems and other non-game cards. */
  extras: boolean;
}

/** Which page of a listing's entries (or a group's members) to fetch. */
export interface ListingPage {
  groupBy: GroupBy;
  key: string;
  sort: SortBy;
  /** The previous page's next_cursor; null for the first page. */
  cursor: string | null;
}

const listingQuery = ({ groupBy, key, sort, cursor }: ListingPage) => ({ group_by: groupBy, key, sort, cursor });

/** The signed-in user, or null when nobody is signed in. */
export async function me(signal?: AbortSignal): Promise<User | null> {
  try {
    return await request<User>('GET', '/api/auth/me', { signal });
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return null;
    throw err;
  }
}

export const login = (c: Credentials) => request<User>('POST', '/api/auth/login', { body: c });
export const signup = (c: Credentials) => request<User>('POST', '/api/auth/signup', { body: c });
export const logout = () => request<void>('POST', '/api/auth/logout');

export const searchCards = (s: CardSearch, page: number, signal?: AbortSignal) =>
  request<CardPage>('GET', '/api/cards/search', {
    query: { q: s.q.trim(), set: s.set.trim(), type: s.type.trim(), rarity: s.rarity, colors: s.colors, extras: s.extras || undefined, page },
    signal,
  });
export const autocomplete = (q: string, signal?: AbortSignal) => request<CardNames>('GET', '/api/cards/autocomplete', { query: { q }, signal });
export const card = (id: string, signal?: AbortSignal) => request<Card>('GET', `/api/cards/${segment(id)}`, { signal });
export const printings = (id: string, page: number, signal?: AbortSignal) =>
  request<CardPage>('GET', `/api/cards/${segment(id)}/printings`, { query: { page }, signal });

export const collectionGroups = (groupBy: GroupBy, signal?: AbortSignal) =>
  request<CollectionGroups>('GET', '/api/collection/groups', { query: { group_by: groupBy }, signal });
export const collectionEntries = (p: ListingPage, signal?: AbortSignal) =>
  request<EntryPage>('GET', '/api/collection/entries', { query: listingQuery(p), signal });
export const collectionStats = (signal?: AbortSignal) => request<CollectionStats>('GET', '/api/collection/stats', { signal });
export const cardCopies = (cardId: string, signal?: AbortSignal) =>
  request<CardCopies>('GET', `/api/collection/cards/${segment(cardId)}`, { signal });

/** Adds copies; created is false when they went into an entry the user already had. */
export async function addEntry(e: NewEntry): Promise<{ entry: CollectionEntry; created: boolean }> {
  const { status, body } = await send<CollectionEntry>('POST', '/api/collection/entries', { body: e });
  return { entry: body, created: status === 201 };
}
export const changeEntry = (id: number, change: EntryChange) =>
  request<CollectionEntry>('PATCH', `/api/collection/entries/${segment(id)}`, { body: change });
export const deleteEntry = (id: number) => request<void>('DELETE', `/api/collection/entries/${segment(id)}`);

export const customGroups = (signal?: AbortSignal) => request<CustomGroupList>('GET', '/api/groups', { signal });
export const createGroup = (g: NewGroup) => request<CustomGroup>('POST', '/api/groups', { body: g });
export const customGroup = (id: number, signal?: AbortSignal) => request<CustomGroup>('GET', `/api/groups/${segment(id)}`, { signal });
export const changeGroup = (id: number, change: GroupChange) => request<CustomGroup>('PATCH', `/api/groups/${segment(id)}`, { body: change });
export const deleteGroup = (id: number) => request<void>('DELETE', `/api/groups/${segment(id)}`);
export const groupGroups = (id: number, groupBy: GroupBy, signal?: AbortSignal) =>
  request<CollectionGroups>('GET', `/api/groups/${segment(id)}/groups`, { query: { group_by: groupBy }, signal });
export const groupMembers = (id: number, p: ListingPage, signal?: AbortSignal) =>
  request<GroupMemberPage>('GET', `/api/groups/${segment(id)}/members`, { query: listingQuery(p), signal });

/** One entry's copies in a group, or null when it isn't in the group. */
export async function groupMember(groupId: number, entryId: number, signal?: AbortSignal): Promise<GroupMember | null> {
  try {
    return await request<GroupMember>('GET', `/api/groups/${segment(groupId)}/members/${segment(entryId)}`, { signal });
  } catch (err) {
    // A 404 also comes from a group deleted meanwhile; then putting copies in it says so.
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}
/** Puts quantity copies of an entry in a group; created is false when it was already there. */
export async function setGroupMember(groupId: number, entryId: number, quantity: number): Promise<{ member: GroupMember; created: boolean }> {
  const { status, body } = await send<GroupMember>('PUT', `/api/groups/${segment(groupId)}/members/${segment(entryId)}`, { body: { quantity } });
  return { member: body, created: status === 201 };
}
export const removeGroupMember = (groupId: number, entryId: number) =>
  request<void>('DELETE', `/api/groups/${segment(groupId)}/members/${segment(entryId)}`);
