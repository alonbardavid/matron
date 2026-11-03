/** Preview names: lowercase letters, digits and dashes, starting with a letter, short. */
const MAX_SLUG = 40;

/**
 * The slug a branch is known by, from the planner's short name for the
 * change (or the request's title when there is none): "shopping list"
 * becomes "shopping-list".
 */
export function branchSlug(name: string): string {
  let slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG)
    .replace(/-+$/, "");
  if (!/^[a-z]/.test(slug)) slug = slug ? `change-${slug}` : "change";
  return slug;
}

/** The first slug in `slug`, `slug-2`, `slug-3`, ... that no branch has had. */
export function uniqueSlug(slug: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  if (!used.has(slug)) return slug;
  for (let n = 2; ; n += 1) {
    const candidate = `${slug}-${n}`;
    if (!used.has(candidate)) return candidate;
  }
}

/**
 * The names a branch is known by. All three share the slug so a person can
 * match a Preview, a git branch and a D1 database to each other by eye.
 * The database keeps the production database's name in front, since every
 * database in the account shares one namespace.
 */
export function branchNames(
  slug: string,
  productionDatabaseName: string,
): { branch: string; preview: string; database: string } {
  return {
    branch: slug,
    preview: slug,
    database: `${productionDatabaseName}-${slug}`,
  };
}
