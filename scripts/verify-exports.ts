/**
 * Verify all public exports are accessible
 */
import {
  autognosticPlugin,
  removeFromKnowledge,
  removeDocumentByUrl,
  getScheduledSyncService,
  getExactQuote,
  getLineContent,
  getFullDocument,
  ScientificPaperDetector,
  getScientificPaperDetector,
  ScientificPaperHandler,
  createScientificPaperHandler,
  DatabaseSeeder,
} from "../src/index";

console.log("Plugin name:", autognosticPlugin.name);
console.log("Plugin actions:", autognosticPlugin.actions?.length);
console.log("Plugin services:", autognosticPlugin.services?.length);
console.log("Plugin providers:", autognosticPlugin.providers?.length);
console.log("All exports verified");
