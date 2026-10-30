import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

let pool: pg.Pool | null = null;
let db: any = null;

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
  let lastData: any = null;

  const dummyChain: any = () => dummyChain;
  dummyChain.where = () => dummyChain;
  dummyChain.limit = () => dummyChain;
  dummyChain.offset = () => dummyChain;
  dummyChain.orderBy = () => dummyChain;
  dummyChain.returning = async () => [lastData];
  dummyChain.onConflictDoUpdate = () => dummyChain;
  dummyChain.then = (resolve: any) => Promise.resolve([lastData]).then(resolve);
  dummyChain.catch = (reject: any) => Promise.resolve([]).catch(reject);

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
              // Drizzle table objects usually have a [Table.Symbol.Name] or similar, 
              // but for this mock we'll try to get the name property.
              const tableName = table?._?.name || table?.name || "unknown";
              const items = store[tableName] || [];
              
              return {
                leftJoin: () => ({ 
                  where: (condition: any) => ({ 
                    limit: (n: number) => ({ 
                      then: (res: any) => res(items.slice(0, n)) 
                    }),
                    then: (res: any) => res(items) 
                  }) 
                }),
                where: (condition: any) => {
                  let filtered = items;
                  
                  const getValue = (c: any): any => {
                    if (!c) return null;
                    if (typeof c !== 'object') return c;
                    if ('value' in c) return c.value;
                    if (c.right && typeof c.right === 'object' && 'value' in c.right) return c.right.value;
                    if (c.right !== undefined) return c.right;
                    return null;
                  };

                  const targetValue = getValue(condition);
                  
                  if (targetValue) {
                    filtered = items.filter(item => 
                      item.email === targetValue || 
                      item.userId === targetValue ||
                      item.id === targetValue
                    );
                  }

                  // If still not filtered, try the string search fallback
                  if (filtered.length === items.length && items.length > 0) {
                    try {
                      const condStr = JSON.stringify(condition);
                      const foundItem = items.find(item => {
                        if (item.email && condStr.includes(item.email)) return true;
                        if (item.userId && condStr.includes(item.userId)) return true;
                        return false;
                      });
                      if (foundItem) filtered = [foundItem];
                    } catch (e) {}
                  }

                  return {
                    limit: (n: number) => ({
                      then: (res: any) => res(filtered.slice(0, n))
                    }),
                    then: (res: any) => res(filtered)
                  };
                },
                limit: (n: number) => ({
                   then: (res: any) => res(items.slice(0, n))
                }),
                then: (res: any) => res(items)
              };
            }
          };
        };
      }
      if (prop === "insert") {
        return (table: any) => {
          const tableName = table?._?.name || table?.name || "unknown";
          if (!store[tableName]) store[tableName] = [];
          return {
            values: (data: any) => {
              const records = Array.isArray(data) ? data : [data];
              const inserted: any[] = [];
              for (const record of records) {
                const newRecord = { 
                  ...record, 
                  id: record.id || Math.random().toString(36).substring(7),
                  createdAt: new Date(),
                  updatedAt: new Date(),
                  accountStatus: record.accountStatus || "active"
                };
                store[tableName].push(newRecord);
                inserted.push(newRecord);
                lastData = newRecord;
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
          const tableName = table?._?.name || table?.name || "unknown";
          const items = store[tableName] || [];
          return {
            set: (updateData: any) => ({
              where: (condition: any) => {
                // Find item to update
                try {
                  const condStr = JSON.stringify(condition);
                  const index = items.findIndex(item => {
                    if (item.userId && condStr.includes(item.userId)) return true;
                    return false;
                  });
                  if (index !== -1) {
                    items[index] = { ...items[index], ...updateData, updatedAt: new Date() };
                  }
                } catch (e) {}
                return {
                  then: (res: any) => res([updateData])
                };
              }
            })
          };
        };
      }
      if (prop === "delete") {
        return () => ({ where: () => ({ then: (res: any) => res([]) }) });
      }
      return async () => [];
    },
  });
}


export { pool, db };
export * from "./schema";

