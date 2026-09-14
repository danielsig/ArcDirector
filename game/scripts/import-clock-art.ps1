param(
	[Parameter(Mandatory = $true)][string]$Kind,
	[Parameter(Mandatory = $true)][string]$Stage,
	[switch]$IdleOnly,
	[switch]$TakeOnly
)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
Push-Location $PSScriptRoot
try {
	$folder = & node --input-type=module -e "import { folderForKind } from './characters.mjs'; process.stdout.write(folderForKind(process.argv.at(-1)))" -- $Kind
} finally {
	Pop-Location
}
if (-not $folder) {
	throw "no character folder for kind $Kind"
}
$destDir = Join-Path $root "public\characters\$folder"
$idle06 = Join-Path $destDir 'idle_06.png'
if (-not (Test-Path $idle06)) {
	throw "missing $idle06"
}

Add-Type -Path (Join-Path $PSScriptRoot 'ImportClockArt.cs') -ReferencedAssemblies System.Drawing
Add-Type -Path (Join-Path $PSScriptRoot 'BakeSpriteMaps.cs') -ReferencedAssemblies System.Drawing

Add-Type -AssemblyName System.Drawing
$probe = [System.Drawing.Image]::FromFile($idle06)
$cw = $probe.Width
$ch = $probe.Height
$probe.Dispose()

function Import-One([string]$Name, [string]$DestName) {
	$src = Join-Path $Stage $Name
	if (-not (Test-Path $src)) {
		throw "missing $src"
	}
	$dest = Join-Path $destDir $DestName
	[ImportClockArt]::ImportAlbedo($src, $dest, $cw, $ch)
	[BakeSpriteMaps]::BakeOne($dest)
}

if (-not $TakeOnly) {
	Import-One "npc_${Kind}_idle_01.png" 'idle_01.png'
	Import-One "npc_${Kind}_idle_03.png" 'idle_03.png'
	Import-One "npc_${Kind}_idle_05.png" 'idle_05.png'
}

if (-not $IdleOnly) {
	$strip = Join-Path $Stage "npc_${Kind}_take_strip.png"
	if (Test-Path $strip) {
		[ImportClockArt]::SliceStrip($strip, $destDir, 'take_06', 8, $cw, $ch)
		0..7 | ForEach-Object {
			[BakeSpriteMaps]::BakeOne((Join-Path $destDir "take_06_$_.png"))
		}
	}
	else {
		0..7 | ForEach-Object {
			Import-One "npc_${Kind}_take_06_$_.png" "take_06_$_.png"
		}
	}
}

Write-Host "imported $Kind onto ${cw}x${ch}"
