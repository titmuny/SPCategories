$sourcePath = Join-Path $PSScriptRoot '..\index.html'
$sourcePath = [System.IO.Path]::GetFullPath($sourcePath)

$lines = Get-Content -Path $sourcePath
$html = [string]::Join([Environment]::NewLine, $lines)

$categories = [regex]::Matches($html, '<img src="([^"/]+?)/[^"]+"') |
    ForEach-Object { $_.Groups[1].Value } |
    Sort-Object -Unique

$categoryToLabel = @{}
$buttonMatches = [regex]::Matches(
    $html,
    '<button class="btn btn-outline-primary rounded-pill m-2 category-filter flex-shrink-0(?: active)?" data-category="([^"]+)">([^<]+)</button>'
)

foreach ($match in $buttonMatches) {
    $categoryKey = $match.Groups[1].Value.Trim()
    $labelValue = $match.Groups[2].Value.Trim()

    if ($categoryKey -and $categoryKey -ne 'All' -and -not $categoryToLabel.ContainsKey($categoryKey)) {
        $categoryToLabel[$categoryKey] = $labelValue
    }
}

$categorySet = [System.Collections.Generic.HashSet[string]]::new(
    [System.StringComparer]::Ordinal
)

foreach ($category in $categories) {
    [void]$categorySet.Add($category)
}

$categoryMarkers = @()

for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match '^\s*<!--\s*(.+?)\s*-->\s*$') {
        $commentValue = $Matches[1]

        if ($categorySet.Contains($commentValue)) {
            $categoryMarkers += [pscustomobject]@{
                Category = $commentValue
                LineIndex = $i
            }
        }
    }
}

$finishedIndex = -1

for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match '<!-- Finished 27/09/2025 -->') {
        $finishedIndex = $i
        break
    }
}

if ($categoryMarkers.Count -eq 0 -or $finishedIndex -lt 0) {
    throw 'Could not locate category section boundaries in index.html'
}

$firstCategoryIndex = $categoryMarkers[0].LineIndex
$prefixLines = if ($firstCategoryIndex -gt 0) { $lines[0..($firstCategoryIndex - 1)] } else { @() }
$suffixLines = $lines[$finishedIndex..($lines.Count - 1)]
$contentWrapperClosingLines = @(
    '        </div>',
    '    </div>'
)

for ($markerIndex = 0; $markerIndex -lt $categoryMarkers.Count; $markerIndex++) {
    $marker = $categoryMarkers[$markerIndex]
    $sectionStart = $marker.LineIndex

    if ($markerIndex -lt $categoryMarkers.Count - 1) {
        $sectionEnd = $categoryMarkers[$markerIndex + 1].LineIndex - 1
    } else {
        $sectionEnd = $finishedIndex - 1
    }

    $categoryLines = $lines[$sectionStart..$sectionEnd]
    $pageLines = @($prefixLines + $categoryLines + $contentWrapperClosingLines + $suffixLines)
    $pageHtml = [string]::Join([Environment]::NewLine, $pageLines)
    $fileBaseName = if ($categoryToLabel.ContainsKey($marker.Category)) { $categoryToLabel[$marker.Category] } else { $marker.Category }
    $fileName = "$fileBaseName.html"
    $pageHtml = $pageHtml -replace '<title>SP</title>', "<title>SP - $fileBaseName</title>"

    $defaultCategoryScript = @"
    <script>
        window.DEFAULT_CATEGORY = '$($marker.Category)';
    </script>

"@

    $pageHtml = $pageHtml -replace '</head>', ($defaultCategoryScript + '</head>')

    $outputPath = Join-Path (Split-Path $sourcePath -Parent) $fileName
    Set-Content -Path $outputPath -Value $pageHtml -Encoding UTF8
}
