import { MaxQuantity } from '../types';

/** Most copies one collection entry can hold: the server's limit, from the contract. */
export const MAX_QUANTITY = MaxQuantity;

/** Parses a typed quantity: a whole number from 1 to MAX_QUANTITY; anything empty or invalid counts as 1. */
export function parseQuantity(input: string): number {
  const n = Math.floor(Number(input));
  return Number.isFinite(n) && n >= 1 ? Math.min(n, MAX_QUANTITY) : 1;
}
