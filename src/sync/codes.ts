import { customAlphabet } from "nanoid";

// Human-friendly join codes: uppercase, no easily-confused characters
// (no 0/O, 1/I, etc.). 4 characters -> ~830k combinations, plenty for
// concurrent casual games.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const makeCode = customAlphabet(ALPHABET, 4);

export function newGameCode(): string {
  return makeCode();
}

export function normalizeCode(input: string): string {
  return input.trim().toUpperCase();
}
