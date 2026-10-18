// Kept apart from the Zod schema, so the browser pages can use it without Zod.

/** The three layouts a segment can use. */
export const layoutNames = ["split", "face", "circle"] as const;

export type Layout = (typeof layoutNames)[number];

export function isLayout(value: string): value is Layout {
  return (layoutNames as readonly string[]).includes(value);
}
