$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

Add-Type -AssemblyName System.Runtime.WindowsRuntime

$null = [Windows.Devices.Geolocation.Geolocator, Windows.Devices.Geolocation, ContentType = WindowsRuntime]
$null = [Windows.Devices.Geolocation.Geoposition, Windows.Devices.Geolocation, ContentType = WindowsRuntime]

function Convert-WinRtAsyncOperationToTask {
    param(
        [Parameter(Mandatory = $true)]
        $AsyncOperation,

        [Parameter(Mandatory = $true)]
        [Type]$ResultType
    )

    $asTaskMethod = [System.WindowsRuntimeSystemExtensions].GetMethods() |
        Where-Object {
            $_.Name -eq 'AsTask' -and
            $_.IsGenericMethod -and
            $_.GetParameters().Count -eq 1
        } |
        Select-Object -First 1

    if (-not $asTaskMethod) {
        throw 'Windows Runtime 비동기 위치 요청을 처리할 수 없습니다.'
    }

    $genericMethod = $asTaskMethod.MakeGenericMethod($ResultType)
    return $genericMethod.Invoke($null, @($AsyncOperation))
}

$geolocator = [Windows.Devices.Geolocation.Geolocator]::new()
$geolocator.DesiredAccuracy = [Windows.Devices.Geolocation.PositionAccuracy]::High
$geolocator.ReportInterval = 0

$operation = $geolocator.GetGeopositionAsync()
$task = Convert-WinRtAsyncOperationToTask `
    -AsyncOperation $operation `
    -ResultType ([Windows.Devices.Geolocation.Geoposition])

if (-not $task.Wait(15000)) {
    throw 'Windows 위치 확인 시간이 초과되었습니다.'
}

$position = $task.Result
$coordinate = $position.Coordinate
$point = $coordinate.Point.Position

$latitude = [double]$point.Latitude
$longitude = [double]$point.Longitude
$accuracy = [double]$coordinate.Accuracy

Write-Output ('{0},{1},{2}' -f $latitude, $longitude, $accuracy)
