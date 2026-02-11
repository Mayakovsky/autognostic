import { PGlite } from "@electric-sql/pglite";
import path from "path";

const db = new PGlite(path.resolve(".eliza/.elizadb"));
const r = await db.query("DELETE FROM memories;");
console.log("Deleted memories. Affected rows:", r.affectedRows ?? "unknown");
const check = await db.query("SELECT COUNT(*) as cnt FROM memories;");
console.log("Remaining:", (check.rows[0] as any).cnt);
await db.close();
