[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$InputPath,
  [Parameter(Mandatory = $true)][string]$EvidenceOutputPath,
  [Parameter(Mandatory = $true)][string]$ManifestPath,
  [ValidateSet('production','disposable','staging')][string]$ExpectedEnvironment = 'production'
)
$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $InputPath -PathType Leaf)) { throw "Input evidence does not exist: $InputPath" }
if (-not (Test-Path -LiteralPath $ManifestPath -PathType Leaf)) { throw "Migration manifest does not exist: $ManifestPath" }
$node = Get-Command node -ErrorAction Stop
$script = Join-Path $PSScriptRoot 'cutover-controls.mjs'
& $node.Source $script preflight $InputPath $EvidenceOutputPath $ExpectedEnvironment $ManifestPath
exit $LASTEXITCODE
