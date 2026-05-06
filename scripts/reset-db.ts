import fs from "node:fs";
import { config } from "../src/server/config.js";

if (fs.existsSync(config.dbPath)) {
  fs.unlinkSync(config.dbPath);
  console.log(`removed ${config.dbPath}`);
} else {
  console.log(`no DB at ${config.dbPath}`);
}
