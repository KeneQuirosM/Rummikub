import { tileOf } from '../src/tiles.js';
export const R = (n: number, copy = 0) => tileOf(0, n, copy);
export const B = (n: number, copy = 0) => tileOf(1, n, copy);
export const O = (n: number, copy = 0) => tileOf(2, n, copy);
export const K = (n: number, copy = 0) => tileOf(3, n, copy);
export const J1 = 104;
export const J2 = 105;
