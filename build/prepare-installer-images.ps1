# Format conversion only. The source artwork is generated with imagegen.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$assetDir = Join-Path $PSScriptRoot 'installer'
$source = [System.Drawing.Image]::FromFile((Join-Path $assetDir 'desk-original.png'))
function Save-InstallerBitmap($name, $width, $height, $crop) {
    $bitmap = New-Object System.Drawing.Bitmap($width, $height, ([System.Drawing.Imaging.PixelFormat]::Format24bppRgb))
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.DrawImage($source, (New-Object System.Drawing.RectangleF(0, 0, $width, $height)), $crop, [System.Drawing.GraphicsUnit]::Pixel)
    $bitmap.Save((Join-Path $assetDir $name), [System.Drawing.Imaging.ImageFormat]::Bmp)
    $graphics.Dispose()
    $bitmap.Dispose()
}
try {
    # 2x NSIS sidebar and header sizes retain detail at 150–200% display scaling.
    $cropWidth = [single]($source.Height * 164 / 314)
    Save-InstallerBitmap 'sidebar.bmp' 328 628 (New-Object System.Drawing.RectangleF((($source.Width - $cropWidth) / 2), 0, $cropWidth, $source.Height))
    Save-InstallerBitmap 'header.bmp' 300 114 (New-Object System.Drawing.RectangleF(30, 570, 964, 366.32))
} finally {
    $source.Dispose()
}
