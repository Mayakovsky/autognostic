import { autognosticPlugin } from "../src/index";

console.log("Registered Actions:");
autognosticPlugin.actions?.forEach((action, i) => {
  console.log(`  ${i + 1}. ${action.name}`);
  console.log(`     Description: ${action.description?.slice(0, 60)}...`);
});

const expectedActions = [
  "ADD_URL_TO_KNOWLEDGE",
  "MIRROR_SOURCE_TO_KNOWLEDGE",
  "LIST_AUTOGNOSTIC_SOURCES",
  "LIST_KNOWLEDGE_DOCUMENTS",
  "GET_EXACT_QUOTE",
  "REMOVE_AUTOGNOSTIC_SOURCE",
  "REMOVE_KNOWLEDGE_DOCUMENT",
  "SET_AUTOGNOSTIC_SIZE_POLICY",
  "SET_VERSION_TRACKING",
  "REFRESH_KNOWLEDGE_SOURCE",
];

const registeredNames = autognosticPlugin.actions?.map(a => a.name) || [];
const missing = expectedActions.filter(e => !registeredNames.includes(e));

if (missing.length > 0) {
  console.error("Missing actions:", missing);
  process.exit(1);
}

console.log("All expected actions registered");
