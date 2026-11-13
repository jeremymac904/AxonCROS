// Original geometric placeholder for the sanitized source edition. MIT.
export interface ShapeDef { viewBox: string; d: string; outline: string }
const circle = 'M16 3a13 13 0 1 0 0 26a13 13 0 1 0 0-26';
export const SHAPES: Record<string, ShapeDef> = { blob: {viewBox: '0 0 32 32', d: circle, outline: circle} };
