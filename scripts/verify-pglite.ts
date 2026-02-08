import { PGlite } from "@electric-sql/pglite";

async function testPGlite() {
  const db = new PGlite("./test-data/verify.db");

  await db.exec(`
    CREATE TABLE IF NOT EXISTS test_table (
      id SERIAL PRIMARY KEY,
      name TEXT
    );
  `);

  await db.exec(`INSERT INTO test_table (name) VALUES ('test');`);

  const result = await db.query(`SELECT * FROM test_table;`);
  console.log("PGlite test result:", result.rows);

  // Cleanup
  await db.close();
  console.log("PGlite verification passed");
}

testPGlite().catch(console.error);
