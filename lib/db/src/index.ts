import { randomUUID } from "node:crypto";
import { getTableColumns, getTableName } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

let pool: pg.Pool | null = null;
let db: NodePgDatabase<typeof schema> | null = null;

if (process.env.DATABASE_URL) {
  try {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    db = drizzle(pool, { schema });
  } catch (err) {
    console.warn("[AI Studio] Database connection error:", err);
  }
}

if (!db) {
  console.warn("[AI Studio] Database not connected — using in-memory mock");
  
  const store: Record<string, any[]> = {};
  const defaultValues: Record<string, Record<string, unknown>> = {
    sharewa_user_profiles: {
      fullName: "Pengguna baru",
      preferredCurrency: "IDR",
      language: "id",
      accountStatus: "active",
    },
    sharewa_contacts: { consentStatus: "opted_in" },
    sharewa_whatsapp_sessions: { status: "disconnected" },
    sharewa_messages: { status: "queued" },
    sharewa_withdrawals: { status: "pending" },
  };

  const tableName = (table: any): string => getTableName(table);
  const columnKey = (column: any): string => Object.entries(getTableColumns(column.table))
    .find(([, candidate]) => candidate === column)?.[0] ?? column.name;
  const isColumn = (value: any) => Boolean(value?.table && typeof value.name === "string");
  const valueFor = (column: any, row: Record<string, any>) => row[tableName(column.table)]?.[columnKey(column)];
  const expressionValue = (expression: any, row: Record<string, any>) => {
    const column = isColumn(expression) ? expression : expression?.queryChunks?.find(isColumn);
    const value = column ? valueFor(column, row) : null;
    if (value != null) return value;
    return expression?.queryChunks?.some((chunk: any) =>
      chunk?.constructor?.name === "StringChunk" && chunk.value.join("").includes("disconnected"),
    ) ? "disconnected" : value;
  };
  const projectReturning = (row: any, fields: any, table: any) => {
    if (!fields) return row;
    return Object.fromEntries(Object.entries(fields).map(([key, column]: [string, any]) => [
      key,
      tableName(column.table) === tableName(table) ? row[columnKey(column)] : null,
    ]));
  };
  const matchCondition = (condition: any, row: Record<string, any>): boolean => {
    const chunks = condition?.queryChunks;
    if (!Array.isArray(chunks)) return true;

    const nested = chunks.filter((chunk: any) => Array.isArray(chunk?.queryChunks));
    if (nested.length) {
      const operator = chunks.map((chunk: any) => chunk?.value?.join?.("") ?? "").join("").toLowerCase();
      const results = nested.map((chunk: any) => matchCondition(chunk, row));
      return operator.includes(" or ") ? results.some(Boolean) : results.every(Boolean);
    }

    const columns = chunks.filter(isColumn);
    if (!columns.length) return true;
    const expression = chunks.map((chunk: any) => chunk?.value?.join?.("") ?? "").join("").toLowerCase();
    const actual = valueFor(columns[0], row);
    if (expression.includes("ilike")) {
      const pattern = chunks.find((chunk: any) => chunk?.constructor?.name === "String");
      if (!pattern) return false;
      const escaped = String(pattern).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        .replaceAll("%", ".*").replaceAll("_", ".");
      return new RegExp(`^${escaped}$`, "i").test(String(actual ?? ""));
    }
    if (columns.length > 1) return actual === valueFor(columns[1], row);
    const param = chunks.find((chunk: any) => chunk?.constructor?.name === "Param");
    if (expression.includes(" is null")) return actual == null;
    if (expression.includes(" is not null")) return actual != null;
    if (!param) return true;
    if (expression.includes(" = ")) return actual === param.value;
    if (expression.includes(" <> ") || expression.includes(" != ")) return actual !== param.value;
    if (expression.includes(" >= ") || expression.includes(" > ") || expression.includes(" <= ") || expression.includes(" < ")) {
      if (actual == null) return false;
      const left = actual instanceof Date || param.value instanceof Date
        ? new Date(actual).getTime()
        : actual;
      const right = actual instanceof Date || param.value instanceof Date
        ? new Date(param.value).getTime()
        : param.value;
      if (expression.includes(" >= ")) return left >= right;
      if (expression.includes(" > ")) return left > right;
      if (expression.includes(" <= ")) return left <= right;
      return left < right;
    }
    return true;
  };
  const rowMatches = (row: Record<string, any>, condition: any) => matchCondition(condition, row);

  db = new Proxy({}, {
    get: (_, prop) => {
      if (prop === "query") {
        return new Proxy({}, { 
          get: () => ({
            findMany: async () => [],
            findFirst: async () => null,
          }) 
        });
      }
      if (prop === "transaction") {
        return async (cb: (tx: any) => Promise<any>) => cb(db);
      }
      if (prop === "execute") {
        return async () => ({ rows: [] });
      }
      if (prop === "select") {
        return (fields?: any) => {
          return {
            from: (table: any) => {
              const fromName = tableName(table);
              const joins: { table: any; condition: any; type: "inner" | "left" }[] = [];
              let whereCondition: any;
              let groupColumns: any[] = [];
              let orderColumns: any[] = [];
              let rowLimit = Number.POSITIVE_INFINITY;
              let rowOffset = 0;
              const execute = () => {
                let rows: Record<string, any>[] = (store[fromName] || []).map((row) => ({ [fromName]: row }));
                for (const join of joins) {
                  const name = tableName(join.table);
                  const joined: Record<string, any>[] = [];
                  for (const row of rows) {
                    const matches = (store[name] || [])
                      .map((candidate) => ({ ...row, [name]: candidate }))
                      .filter((candidate) => rowMatches(candidate, join.condition));
                    if (matches.length) joined.push(...matches);
                    else if (join.type === "left") joined.push({ ...row, [name]: null });
                  }
                  rows = joined;
                }
                rows = rows.filter((row) => rowMatches(row, whereCondition));

                if (groupColumns.length) {
                  const groups = new Map<string, Record<string, any>[]>();
                  for (const row of rows) {
                    const key = JSON.stringify(groupColumns.map((column) => expressionValue(column, row)));
                    groups.set(key, [...(groups.get(key) ?? []), row]);
                  }
                  rows = [...groups.values()].map((group) => group[0]);
                  (rows as any).groupCounts = [...groups.values()].map((group) => group.length);
                }
                if (orderColumns.length) {
                  rows.sort((a, b) => {
                    for (const order of orderColumns) {
                      const column = order?.queryChunks?.find(isColumn);
                      if (!column) continue;
                      const direction = order.queryChunks.some((chunk: any) => chunk?.value?.join?.("").includes(" desc")) ? -1 : 1;
                      const left = valueFor(column, a);
                      const right = valueFor(column, b);
                      if (left < right) return -1 * direction;
                      if (left > right) return direction;
                    }
                    return 0;
                  });
                }
                const counts: number[] = (rows as any).groupCounts ?? [];
                const projected = rows.map((row, index) => {
                  if (!fields) return row[fromName];
                  return Object.fromEntries(Object.entries(fields).map(([key, column]: [string, any]) => {
                    if (column?.queryChunks?.some((chunk: any) => chunk?.value?.join?.("").toLowerCase().includes("count(*)"))) {
                      return [key, groupColumns.length ? counts[index] : rows.length];
                    }
                    const sourceColumn = isColumn(column) ? column : column?.queryChunks?.find(isColumn);
                    if (!sourceColumn) return [key, null];
                    let value = valueFor(sourceColumn, row);
                    if (value == null && column?.queryChunks?.some((chunk: any) => chunk?.value?.join?.("").toLowerCase().includes("coalesce("))) {
                      const fallback = column.queryChunks.find((chunk: any) => chunk?.constructor?.name === "StringChunk" && chunk.value.join("").includes("disconnected"));
                      if (fallback) value = "disconnected";
                    }
                    return [key, value ?? null];
                  }));
                });
                return projected.slice(rowOffset, rowOffset + rowLimit);
              };
              const query: any = {
                where: (condition: any) => {
                  whereCondition = condition;
                  return query;
                },
                leftJoin: (otherTable: any, condition: any) => {
                  joins.push({ table: otherTable, condition, type: "left" });
                  return query;
                },
                innerJoin: (otherTable: any, condition: any) => {
                  joins.push({ table: otherTable, condition, type: "inner" });
                  return query;
                },
                groupBy: (...columns: any[]) => {
                  groupColumns = columns;
                  return query;
                },
                orderBy: (...columns: any[]) => {
                  orderColumns = columns;
                  return query;
                },
                limit: (count: number) => {
                  rowLimit = count;
                  return query;
                },
                offset: (count: number) => {
                  rowOffset = count;
                  return query;
                },
                then: (resolve: any, reject: any) => Promise.resolve(execute()).then(resolve, reject),
              };
              return query;
            }
          };
        };
      }
      if (prop === "insert") {
        return (table: any) => {
          const name = tableName(table);
          if (!store[name]) store[name] = [];
          return {
            values: (data: any) => {
              const records = Array.isArray(data) ? data : [data];
              const inserted: any[] = [];
              for (const record of records) {
                const newRecord = { 
                  ...defaultValues[name],
                  ...record, 
                  id: record.id || randomUUID(),
                  createdAt: record.createdAt ?? new Date(),
                  updatedAt: record.updatedAt ?? new Date(),
                };
                store[name].push(newRecord);
                inserted.push(newRecord);
              }
              return {
                returning: (fields?: any) => ({
                  then: (res: any) => res(inserted)
                }),
                then: (res: any) => res(inserted)
              };
            }
          };
        };
      }
      if (prop === "update") {
        return (table: any) => {
          const name = tableName(table);
          const items = store[name] || [];
          return {
            set: (updateData: any) => ({
              where: (condition: any) => {
                const updated = items.filter((item) => rowMatches({ [name]: item }, condition))
                  .map((item) => Object.assign(item, updateData));
                const query: any = {
                  returning: (fields?: any) => Promise.resolve(updated.map((row) => projectReturning(row, fields, table))),
                  then: (resolve: any, reject: any) => Promise.resolve(updated).then(resolve, reject),
                };
                return query;
              }
            })
          };
        };
      }
      if (prop === "delete") {
        return (table: any) => ({
          where: (condition: any) => {
            const name = tableName(table);
            const items = store[name] || [];
            const removed = items.filter((item) => rowMatches({ [name]: item }, condition));
            store[name] = items.filter((item) => !rowMatches({ [name]: item }, condition));
            const query: any = {
              returning: (fields?: any) => Promise.resolve(removed.map((row) => projectReturning(row, fields, table))),
              then: (resolve: any, reject: any) => Promise.resolve(removed).then(resolve, reject),
            };
            return query;
          },
        });
      }
      return async () => [];
    },
  }) as NodePgDatabase<typeof schema>;
}

if (!db) throw new Error("Database initialization failed.");
const database: NodePgDatabase<typeof schema> = db;

export { pool, database as db };
export * from "./schema";
