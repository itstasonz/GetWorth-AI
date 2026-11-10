# ══════════════════════════════════════════════════════════════════════════════
# LISTING THUMBNAILS — one-off maintenance for legacy listings whose photographs are base64 in listings.images
# (migration 20261111120000). Windows PowerShell 5.1, built-in .NET imaging only: no package, no network.
#
#   powershell -NoProfile -File scripts/listing-thumbnails.ps1 -In rows.json -Out thumbs.json [-MaxSide 480] [-Quality 72]
#
# In:  JSON array of { "id": "<uuid>", "img": "data:image/...;base64,..." } (the first photograph of each listing).
# Out: JSON array of { "id": "<uuid>", "thumb": "data:image/jpeg;base64,...", "w": n, "h": n, "bytes": n }, or
#      { "id": ..., "error": "..." } for a photograph that cannot be decoded. The source photographs are not changed.
# The orientation recorded by the camera (EXIF 0x0112) is applied, so a thumbnail stands the way the photo displays.
# ══════════════════════════════════════════════════════════════════════════════
param(
  [Parameter(Mandatory = $true)][string]$In,
  [Parameter(Mandatory = $true)][string]$Out,
  [int]$MaxSide = 480,
  [int]$Quality = 72
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$rows = Get-Content -Raw -Encoding UTF8 $In | ConvertFrom-Json
$codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
$params = New-Object System.Drawing.Imaging.EncoderParameters 1
$params.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality), ([long]$Quality)

$result = foreach ($row in $rows) {
  try {
    $comma = $row.img.IndexOf(',')
    if (-not $row.img.StartsWith('data:image/') -or $comma -lt 0) { throw 'not an image data URI' }
    $bytes = [Convert]::FromBase64String($row.img.Substring($comma + 1))
    $ms = New-Object System.IO.MemoryStream (, $bytes)
    $src = [System.Drawing.Image]::FromStream($ms)
    if ($src.PropertyIdList -contains 0x0112) {
      switch ([int]$src.GetPropertyItem(0x0112).Value[0]) {
        3 { $src.RotateFlip([System.Drawing.RotateFlipType]::Rotate180FlipNone) }
        6 { $src.RotateFlip([System.Drawing.RotateFlipType]::Rotate90FlipNone) }
        8 { $src.RotateFlip([System.Drawing.RotateFlipType]::Rotate270FlipNone) }
      }
    }
    $scale = [Math]::Min(1.0, $MaxSide / [Math]::Max($src.Width, $src.Height))
    $w = [Math]::Max(1, [int][Math]::Round($src.Width * $scale))
    $h = [Math]::Max(1, [int][Math]::Round($src.Height * $scale))
    $dst = New-Object System.Drawing.Bitmap $w, $h
    $g = [System.Drawing.Graphics]::FromImage($dst)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.Clear([System.Drawing.Color]::White)
    $g.DrawImage($src, 0, 0, $w, $h)
    $outMs = New-Object System.IO.MemoryStream
    $dst.Save($outMs, $codec, $params)
    $b64 = [Convert]::ToBase64String($outMs.ToArray())
    $g.Dispose(); $dst.Dispose(); $src.Dispose(); $ms.Dispose(); $outMs.Dispose()
    [pscustomobject]@{ id = $row.id; thumb = "data:image/jpeg;base64,$b64"; w = $w; h = $h; bytes = $b64.Length }
  } catch {
    [pscustomobject]@{ id = $row.id; error = $_.Exception.Message }
  }
}
ConvertTo-Json -InputObject @($result) -Depth 3 -Compress | Out-File -Encoding utf8 $Out
