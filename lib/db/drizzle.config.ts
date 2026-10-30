import { defineConfig } from "drizzle-kit";
import path from "path";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

const schemaFiles = path
  .resolve(__dirname, "src/schema/!(index).ts")
  .replace(/\\/g, "/");

export default defineConfig({
  schema: schemaFiles,
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
