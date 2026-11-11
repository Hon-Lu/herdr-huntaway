# The layout (huntaway/) is the source: this copies the mods that are also shared on their own
# into their folders, so each folder installs by itself. Run it after changing one of them.
$root = $PSScriptRoot
foreach ($mod in 'huntaway-files', 'huntaway-newspace') {
  $src = Join-Path $root "huntaway/mods/$mod"
  $dst = Join-Path $root "$mod/mods/$mod"
  if (Test-Path $dst) { Remove-Item -Recurse -Force $dst }
  New-Item -ItemType Directory -Force (Split-Path $dst) | Out-Null
  Copy-Item -Recurse $src $dst
  Write-Output "synced $mod"
}
