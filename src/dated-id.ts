const maximumSlugLength = 48;

function localDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function slugify(title: string): string {
  const words = title
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 0);

  let slug = "";
  for (const word of words) {
    const candidate = slug === "" ? word : `${slug}-${word}`;
    if (candidate.length > maximumSlugLength) {
      break;
    }
    slug = candidate;
  }

  return slug === "" ? "note" : slug;
}

/**
 * Creates an id, for a note or a short folder, from the local date and a slug of the title, such as
 * 2026-10-17-anchor-scroll. A number is added when the id is already taken.
 */
export function createDatedId(title: string, date: Date, existingIds: string[]): string {
  const baseId = `${localDate(date)}-${slugify(title)}`;
  const taken = new Set(existingIds);

  let id = baseId;
  let suffix = 2;
  while (taken.has(id)) {
    id = `${baseId}-${suffix}`;
    suffix += 1;
  }
  return id;
}
