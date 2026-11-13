# Installs huntaway into Herdr App (~/.config/herdr-app) from this clone.
#   .\install.ps1           the huntaway layout and its mods, the same as the README's steps
#   .\install.ps1 -Custom   also huntaway-custom (my own setup): the layout with other people's
#                           mods, fetched at the commits huntaway-custom/mods.json pins
param([switch]$Custom)
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [Text.Encoding]::UTF8

$repo = $PSScriptRoot
$herdr = Join-Path $HOME ".config\herdr-app"
foreach ($d in "mods", "layouts") { New-Item -ItemType Directory -Force (Join-Path $herdr $d) | Out-Null }

function Check([string]$name) {
  & herdr-app check (Join-Path $herdr "mods\$name") | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "herdr-app check failed: $name" }
}
# Not named "git": a function of that name would call itself.
function Invoke-Git {
  & git.exe @args
  if ($LASTEXITCODE -ne 0) { throw "git $($args -join ' ') failed" }
}

# The layout and its own mods.
Copy-Item -Recurse -Force (Join-Path $repo "huntaway\mods\*") (Join-Path $herdr "mods")
Copy-Item -Force (Join-Path $repo "huntaway\layouts\*") (Join-Path $herdr "layouts")
Get-ChildItem (Join-Path $repo "huntaway\mods") -Directory | ForEach-Object { Check $_.Name }
$layout = "huntaway"

if ($Custom) {
  # Other people's mods aren't kept in this repository: each is fetched from its own at the
  # pinned commit, so its licence and code stay its author's.
  $list = Get-Content -Raw -Encoding UTF8 (Join-Path $repo "huntaway-custom\mods.json") | ConvertFrom-Json
  $cache = Join-Path $env:TEMP "herdr-huntaway-custom"
  foreach ($m in @($list.mods)) {
    if ($m.name -like "huntaway*") { throw "$($m.name): names starting with huntaway are this repository's own" }
    $src = Join-Path $cache ($m.repo -replace '[^\w.-]', '_')
    if (-not (Test-Path (Join-Path $src ".git"))) { Invoke-Git clone --quiet --no-checkout $m.repo $src }
    Invoke-Git -C $src fetch --quiet origin $m.commit
    Invoke-Git -C $src checkout --quiet --force $m.commit
    $to = Join-Path $herdr "mods\$($m.name)"
    if (Test-Path $to) { Remove-Item -Recurse -Force $to }
    Copy-Item -Recurse (Join-Path $src $m.path) $to
    Check $m.name
    Write-Output "added $($m.name) at $($m.commit.Substring(0, 7))"
  }
  Copy-Item -Force (Join-Path $repo "huntaway-custom\layouts\*") (Join-Path $herdr "layouts")
  $layout = "huntaway-custom"
}

& herdr-app do layout.switch --name $layout | Out-Null
Write-Output "installed and switched to $layout"
