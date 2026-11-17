import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';

const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const detectors = [
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  /\bsb_secret_[A-Za-z0-9_-]{12,}\b/g,
  /\bSUPABASE_(?:SERVICE_ROLE|SECRET|ANON)_KEY\s*[:=]\s*(?!["']?(?:import\.meta\.env|process\.env|Deno\.env\.get|<|service-role-key|local-test-key|test-key|fixture-only))["']?[^\s"'`#][^\s"'`]*["']?/g,
];

const findings = [];
for (const file of tracked) {
  let stat;
  try { stat = statSync(file); } catch { continue; }
  if (!stat.isFile() || stat.size > 1_000_000) continue;
  readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, index) => {
    if (detectors.some((detector) => detector.test(line))) findings.push(`${file}:${index + 1}`);
    detectors.forEach((detector) => { detector.lastIndex = 0; });
  });
}

if (findings.length) {
  console.error('Potential credential material detected at:');
  findings.forEach((finding) => console.error(finding));
  process.exit(1);
}
console.log(`Secret scan passed: ${tracked.length} tracked files inspected.`);
