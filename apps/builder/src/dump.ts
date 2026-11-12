/**
 * Puts the rows of a database export in an order they can be written in: a
 * table's rows after the rows of every table it refers to. An export lists
 * tables in the order they were made, which a column added later, referring
 * to a table made later still, turns around. Pure text in, text out.
 */
export function orderRowsByReferences(schemaSql: string, dataSql: string): string {
  const order = tablesParentsFirst(schemaSql);
  const rank = new Map(order.map((table, index) => [table, index]));
  const head: string[] = [];
  const rows = new Map<string, string[]>();
  for (const line of dataSql.split("\n")) {
    const table = /^INSERT INTO ["`]?(\w+)["`]?/i.exec(line)?.[1];
    if (!table) {
      // Whatever is not a row (the export's own settings) stays in front.
      if (line.trim()) head.push(line);
      continue;
    }
    const list = rows.get(table) ?? [];
    list.push(line);
    rows.set(table, list);
  }
  const tables = [...rows.keys()].sort(
    (a, b) => (rank.get(a) ?? order.length) - (rank.get(b) ?? order.length),
  );
  return [...head, ...tables.flatMap((table) => rows.get(table)!), ""].join("\n");
}

/** The tables a schema makes, each after the tables it refers to; ones that refer to each other keep their order. */
export function tablesParentsFirst(schemaSql: string): string[] {
  const refs = new Map<string, string[]>();
  for (const statement of schemaSql.split(/^(?=CREATE )/m)) {
    const name = /^CREATE TABLE (?:IF NOT EXISTS )?["`]?(\w+)["`]?/i.exec(statement)?.[1];
    if (!name) continue;
    refs.set(
      name,
      [...statement.matchAll(/\bREFERENCES\s+["`]?(\w+)["`]?/gi)].map((m) => m[1]!),
    );
  }
  const ordered: string[] = [];
  const seen = new Set<string>();
  const visit = (table: string) => {
    if (seen.has(table)) return;
    seen.add(table);
    for (const parent of refs.get(table) ?? []) {
      if (parent !== table && refs.has(parent)) visit(parent);
    }
    ordered.push(table);
  };
  for (const table of refs.keys()) visit(table);
  return ordered;
}
