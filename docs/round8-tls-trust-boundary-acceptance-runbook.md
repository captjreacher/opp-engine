# Round 8 TLS trust-boundary acceptance runbook

This runbook is local and disposable only. It does not use production credentials, production endpoints, or production data. The production acceptance decision must be made by the controlled collector in `scripts/round8/authoritative-evidence.mjs`; a JSON replay is evidence for inspection only and cannot confer fresh production authority.

## Required tooling

- Node.js and npm dependencies from the candidate worktree.
- Docker Desktop with the `postgres:17` image available.
- `openssl` for disposable certificate fixtures.
- `psql`; when it is not installed on the host, use the client inside the disposable PostgreSQL container with `docker exec`.

Do not install system-wide software as part of this runbook. Existing local Docker containers may be reused only when their database and credentials are explicitly disposable and isolated.

## Certificate fixtures

Create a temporary directory outside the repository and generate a disposable CA, a server certificate whose SAN is the intended hostname, and a deliberately mismatched certificate. Keep the private key only in that temporary directory and remove the directory during cleanup.

```powershell
$tlsRun = Join-Path ([System.IO.Path]::GetTempPath()) ('opp-round8-tls-' + [guid]::NewGuid())
New-Item -ItemType Directory -Path $tlsRun | Out-Null
openssl req -x509 -newkey rsa:2048 -nodes -keyout "$tlsRun\ca.key" -out "$tlsRun\ca.crt" -days 1 -subj "/CN=Round8 Disposable CA"
openssl req -newkey rsa:2048 -nodes -keyout "$tlsRun\server.key" -out "$tlsRun\server.csr" -subj "/CN=round8-db"
Set-Content -Path "$tlsRun\server.ext" -Value 'subjectAltName=DNS:round8-db'
openssl x509 -req -in "$tlsRun\server.csr" -CA "$tlsRun\ca.crt" -CAkey "$tlsRun\ca.key" -CAcreateserial -out "$tlsRun\server.crt" -days 1 -extfile "$tlsRun\server.ext"
```

Configure a disposable `postgres:17` container with `ssl=on`, the generated server certificate/key, and a database hostname of `round8-db`. Set `PGSSLROOTCERT` to the generated CA certificate and connect with `PGSSLMODE=verify-full`.

## Required adversarial cases

Run the production-mode entry point and assert failure for each case: the original self-attested evidence; plausible approved trust-source names; evidence mutated after collection; stale or replayed evidence; another database or candidate; an untrusted certificate chain; a hostname mismatch; weakened SSL configuration; conflicting connection overrides; and a successful TLS probe followed by observation through a different unverified connection.

The last case must fail because the verified connection and database observations are one controlled execution path, not two independently supplied records.

## Required positive case

Using the disposable database and matching CA/SAN certificate, run the actual production collector with non-secret configuration only:

```powershell
$env:PGSSLROOTCERT = "$tlsRun\ca.crt"
$env:PGSSLMODE = 'verify-full'
$env:ROUND8_EXPECTED_PROJECT_REF = 'disposable-round8-project'
$env:ROUND8_EXPECTED_DATABASE_ID = 'disposable-round8-database'
$env:ROUND8_CANDIDATE_SHA = ('0' * 64)
$env:ROUND8_MANIFEST_PATH = (Resolve-Path 'scripts/round8/approved-migration-manifest.json')
node scripts/round8/authoritative-evidence.mjs production "$tlsRun\production-result.json"
```

The collector must verify database identity and observations through the controlled connection and return success only in memory. JSON serialization removes the module-private collector marker, so offline production verification must fail.

## PostgreSQL regression suites

Reuse the existing disposable PostgreSQL 17 setup used by the repository release gate. Set only disposable database variables and run:

```powershell
$env:OPP_RELEASE_DATABASE = 'opp_release_test_round8'
$env:OPP_TEST_DATABASE = 'opp_company_test_round8'
$env:OPP_OUTREACH_DATABASE = 'opp_outreach_test_round8'
$env:OPP_TEST_PGPORT = '5432'
$env:OPP_TEST_PSQL = 'docker'
$env:OPP_TEST_PSQL_PREFIX_JSON = '["exec","-i","-e","PGPASSWORD=<disposable-password>","<named-round8-disposable-container>","psql"]'
npx vitest run src/lib/release-migrations.integration.test.ts src/lib/outreach-reconciliation.integration.test.ts src/lib/company-membership.integration.test.ts
```

If host `psql` is unavailable, use a disposable client container or explicit wrapper executable; do not treat skipped suites as passing.

## Cleanup

Stop and remove only the named disposable container and database, then remove the temporary certificate directory:

```powershell
docker rm -f <named-round8-disposable-container>
Remove-Item -LiteralPath $tlsRun -Recurse -Force
```

Verify that no production environment variables or credentials were written to the repository or shell profile.

## Reproducible release artifact packaging

The approved SHA-256 values describe physical migration bytes in the preserved governed candidate worktree. The repository has `core.autocrlf=true`, so immutable Git blobs and materialized worktree files may have different line endings. Do not normalize bytes in the collector and do not pipe `git archive` through a text-mode PowerShell pipeline.

Stage an external disposable package by copying the raw bytes from `C:\DEV_LOCAL\opp-engine-round8-cutover\supabase\migrations` and the approved manifest, then verify every entry before invoking the collector. A binary-safe Node command is suitable for this staging step:

```powershell
node --input-type=module -e "import fs from 'node:fs'; import path from 'node:path'; const src='C:/DEV_LOCAL/opp-engine-round8-cutover'; const dst=process.argv[1]; const m=JSON.parse(fs.readFileSync('C:/DEV_LOCAL/opp-engine-round8-verifier-phase-remediation/scripts/round8/approved-migration-manifest.json','utf8')); for(const e of m.approvedOppsEngineSequence){const rel='supabase/migrations/'+e.file; const out=path.join(dst,rel); fs.mkdirSync(path.dirname(out),{recursive:true}); fs.copyFileSync(path.join(src,rel),out)} fs.mkdirSync(path.join(dst,'scripts/round8'),{recursive:true}); fs.copyFileSync('C:/DEV_LOCAL/opp-engine-round8-verifier-phase-remediation/scripts/round8/approved-migration-manifest.json',path.join(dst,'scripts/round8/approved-migration-manifest.json'))" C:\path\to\disposable-release-root
```

Run the collector with `ROUND8_MANIFEST_PATH` pointing to the staged `scripts/round8/approved-migration-manifest.json`. Require zero manifest hash mismatches before acceptance. The collector continues to hash raw file descriptors and enforce physical containment; packaging, not verification, accounts for the line-ending representation.
