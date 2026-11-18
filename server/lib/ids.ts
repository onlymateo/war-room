import { customAlphabet } from "nanoid";

const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
const gen = customAlphabet(alphabet, 14);

export const newId = (prefix: string) => `${prefix}_${gen()}`;
export const now = () => Date.now();
