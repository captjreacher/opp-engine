[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$InputPath,
  [Parameter(Mandatory = $true)][string]$EvidenceOutputPath
)
$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $InputPath -PathType Leaf)) { throw "Verification evidence does not exist: $InputPath" }
$node = Get-Command node -ErrorAction Stop
$script = Join-Path $PSScriptRoot 'cutover-controls.mjs'
& $node.Source $script verify $InputPath $EvidenceOutputPath
exit $LASTEXITCODE
