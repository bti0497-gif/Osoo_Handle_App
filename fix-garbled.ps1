$files = @(
  "server\routes\medicineInRoutes.cjs",
  "server\routes\sludgePhotoRoutes.cjs",
  "server\routes\settingsRoutes.cjs",
  "server\routes\uploadRoutes.cjs",
  "server\services\localPhotoNormalizationService.cjs",
  "server\services\qntechWaterPhotoImportService.cjs",
  "server\services\dailyLogPreviewService.cjs"
)

foreach ($f in $files) {
  $content = [System.IO.File]::ReadAllText($f, [System.Text.Encoding]::UTF8)
  $before = $content

  $content = $content.Replace("'?ъ쭊愿由?, ", "'사진관리', ")
  $content = $content.Replace("'?ъ쭊愿由?'", "'사진관리'")
  $content = $content.Replace('"?ъ쭊愿由?"', '"사진관리"')
  $content = $content.Replace("'?섏쭏遺꾩꽍'", "'수질분석'")
  $content = $content.Replace("'?쏀뭹?낃퀬'", "'약품입고'")
  $content = $content.Replace("'?щ윭吏'", "'슬러지'")
  $content = $content.Replace("'?곗씠?遺덈윭?ㅺ린'", "'데이타불러오기'")
  $content = $content.Replace("?쏀뭹?낃퀬?쇱?_", "약품입고일지_")
  $content = $content.Replace("'?뚯씪??李얠쓣 ???놁뒿?덈떎.'", "'파일을 찾을 수 없습니다.'")
  $content = $content.Replace("'?섎せ???붿껌?낅땲??'", "'잘못된 요청입니다.'")

  if ($content -ne $before) {
    [System.IO.File]::WriteAllText($f, $content, [System.Text.Encoding]::UTF8)
    Write-Host "FIXED: $f"
  } else {
    Write-Host "OK   : $f"
  }
}
