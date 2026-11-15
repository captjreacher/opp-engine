[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$EvidenceOutputPath
)
$ErrorActionPreference = 'Stop'
$node = Get-Command node -ErrorAction Stop
$script = Join-Path $PSScriptRoot 'authoritative-evidence.mjs'
& $node.Source $script production $EvidenceOutputPath
exit $LASTEXITCODE
