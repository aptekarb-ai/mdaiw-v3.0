// Feature 14 V2 — Phase A. Regenerates the two committed cross-language
// capability artifacts under shared/ from the live TypeScript registry.
// Run via `npm run generate:module-capabilities` (frontend/package.json),
// executed by `tsx` (dev-only — see package.json's devDependencies; zero
// production/runtime dependency, per the approved Phase A decision).
//
// This script is NOT the drift check — it is what you run when the
// drift check (moduleCapabilities.test.ts / emailClientCapabilities.test.ts
// on the frontend side, and the corresponding backend test) tells you the
// committed JSON is stale. CI is expected to run the tests, not this
// script, so a forgotten regeneration fails loudly instead of silently
// shipping stale AI-capability metadata.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildModuleCapabilityManifest } from '../src/emailbuilder/moduleCapabilities';
import { buildEmailClientCapabilityManifest } from '../src/emailbuilder/emailClientCapabilities';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sharedDir = path.resolve(__dirname, '..', '..', 'shared');

function writeJson(fileName: string, data: unknown): void {
  const filePath = path.join(sharedDir, fileName);
  // Trailing newline — matches the repo's other generated/text-file
  // convention and avoids a spurious "no newline at end of file" diff.
  writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf-8');
  // eslint-disable-next-line no-console -- this is a CLI tool, not application code
  console.log(`Wrote ${filePath}`);
}

writeJson('module-capabilities.generated.json', buildModuleCapabilityManifest());
writeJson('email-clients.generated.json', buildEmailClientCapabilityManifest());
