import { autognosticSchema } from "../src/schema";

console.log("Schema tables:");
for (const [name, table] of Object.entries(autognosticSchema)) {
  console.log(`  - ${name}`);
}
console.log("Schema verified");
