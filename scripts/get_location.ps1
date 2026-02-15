# Windows Location Service - WinRT Geolocator
# PowerShell 5.1+ compatible approach

try {
    # Load WinRT assemblies
    Add-Type -AssemblyName System.Runtime.WindowsRuntime

    # Helper to await WinRT async operations in PowerShell
    $asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | 
        Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]

    Function Await($WinRtTask, $ResultType) {
        $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
        $netTask = $asTask.Invoke($null, @($WinRtTask))
        $netTask.Wait(-1) | Out-Null
        $netTask.Result
    }

    # Load Geolocator type
    [Windows.Devices.Geolocation.Geolocator, Windows.Devices.Geolocation, ContentType = WindowsRuntime] | Out-Null

    $gl = New-Object Windows.Devices.Geolocation.Geolocator
    $gl.DesiredAccuracy = [Windows.Devices.Geolocation.PositionAccuracy]::High

    # Get position
    $pos = Await ($gl.GetGeopositionAsync()) ([Windows.Devices.Geolocation.Geoposition])

    $lat = $pos.Coordinate.Point.Position.Latitude
    $lng = $pos.Coordinate.Point.Position.Longitude
    $acc = $pos.Coordinate.Accuracy

    Write-Output "$lat,$lng,$acc"
}
catch {
    Write-Error $_.Exception.Message
    exit 1
}
