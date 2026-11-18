import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { pathToFileURL } from "node:url";
import { paths } from "../env";
import * as schema from "./schema";

const client = createClient({ url: pathToFileURL(paths.db).href });

export const db = drizzle(client, { schema });
export type DB = typeof db;
export { schema };

export async function initDatabase() {
  await client.execute("PRAGMA journal_mode = WAL;");
  await client.execute("PRAGMA foreign_keys = ON;");
  await migrate(db, { migrationsFolder: paths.migrations });
}
