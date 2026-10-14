using System.Diagnostics;
using System.Globalization;
using System.Text;
using System.Text.Json;
using Microsoft.Win32;
using FormsTimer = System.Windows.Forms.Timer;

namespace OsooDiagnosticTray;

internal static class Program
{
    [STAThread]
    private static int Main(string[] args)
    {
        if (args.Contains("--self-test", StringComparer.OrdinalIgnoreCase))
            return TrayApplicationContext.RunSelfTest();

        using var singleInstance = new Mutex(true, @"Local\OsooDiagnosticTray", out var isFirstInstance);
        if (!isFirstInstance) return 0;
        ApplicationConfiguration.Initialize();
        Application.Run(new TrayApplicationContext());
        return 0;
    }
}

internal sealed class TrayApplicationContext : ApplicationContext
{
    private const string StartupRegistryPath = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string StartupRegistryName = "OsooDiagnosticTray";
    private const string DiagnosticScriptRelativePath = "tools/diagnostic-archive/import-drive-diagnostics.cjs";
    private static readonly TimeZoneInfo KoreaTimeZone = TimeZoneInfo.FindSystemTimeZoneById("Korea Standard Time");
    private static readonly TimeSpan CollectionStart = new(9, 0, 0);
    private static readonly TimeSpan LastPollStartExclusive = new(18, 46, 0);
    private static readonly TimeSpan CollectionEnd = new(19, 0, 0);
    private static readonly TimeSpan PollInterval = TimeSpan.FromMinutes(15);
    private static readonly TimeSpan ProcessTimeout = TimeSpan.FromMinutes(10);

    private readonly NotifyIcon _notifyIcon;
    private readonly FormsTimer _timer;
    private readonly ToolStripMenuItem _statusItem;
    private readonly ToolStripMenuItem _startupItem;
    private readonly string _settingsPath;
    private readonly string _activityLogPath;
    private readonly string _archiveRoot;
    private readonly string _projectRoot;
    private readonly string _nodePath;
    private Process? _activeProcess;
    private DateTimeOffset? _nextPollAt;
    private bool _polling;
    private bool _closing;
    private bool _updatingStartupItem;
    private string _lastResult = "아직 수집을 실행하지 않았습니다.";

    internal TrayApplicationContext()
    {
        _archiveRoot = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            "Osoo_Handle_App",
            "diagnostic-analysis");
        _settingsPath = Path.Combine(_archiveRoot, "tray-settings.json");
        _activityLogPath = Path.Combine(_archiveRoot, "launcher.log");
        Directory.CreateDirectory(_archiveRoot);
        (_projectRoot, _nodePath) = LoadSettings();

        var menu = new ContextMenuStrip();
        _statusItem = new ToolStripMenuItem("시작 상태 확인 중…") { Enabled = false };
        var runNowItem = new ToolStripMenuItem("지금 진단로그 확인");
        runNowItem.Click += async (_, _) => await RunNowAsync();
        var reportItem = new ToolStripMenuItem("최근 분석 보고서 열기");
        reportItem.Click += (_, _) => OpenLatestReport();
        var detailsItem = new ToolStripMenuItem("최근 실행 결과");
        detailsItem.Click += (_, _) => MessageBox.Show(
            _lastResult,
            "진단로그 수집기",
            MessageBoxButtons.OK,
            MessageBoxIcon.Information);
        _startupItem = new ToolStripMenuItem("로그인 시·매일 09시 자동 시작")
        {
            CheckOnClick = true,
            Checked = IsStartupRegistered(),
        };
        _startupItem.CheckedChanged += (_, _) => UpdateStartupRegistration();
        var settingsItem = new ToolStripMenuItem("설정 파일 열기");
        settingsItem.Click += (_, _) => OpenSettingsFile();
        var exitItem = new ToolStripMenuItem("종료");
        exitItem.Click += async (_, _) => await RequestExitAsync();

        menu.Items.AddRange([
            _statusItem,
            new ToolStripSeparator(),
            runNowItem,
            reportItem,
            detailsItem,
            _startupItem,
            settingsItem,
            new ToolStripSeparator(),
            exitItem,
        ]);

        _notifyIcon = new NotifyIcon
        {
            Icon = SystemIcons.Application,
            Text = "진단로그 수집기: 시작 준비 중",
            ContextMenuStrip = menu,
            Visible = true,
        };
        _notifyIcon.DoubleClick += (_, _) => OpenLatestReport();

        if (!_startupItem.Checked)
        {
            try
            {
                SetStartupRegistration(true);
                _updatingStartupItem = true;
                _startupItem.Checked = true;
                _updatingStartupItem = false;
            }
            catch (Exception error)
            {
                _updatingStartupItem = false;
                _lastResult = $"자동 시작 등록 실패: {error.Message}";
            }
        }

        AppendActivity("INFO", "트레이 런처 시작");
        if (_startupItem.Checked)
        {
            try { RegisterDailySchedule(true); }
            catch (Exception error) { AppendActivity("WARN", $"매일 09시 예약 등록 실패: {error.Message}"); }
        }
        _timer = new FormsTimer { Interval = 15_000 };
        _timer.Tick += async (_, _) => await CheckScheduleAsync();
        _timer.Start();
        _ = CheckScheduleAsync();
    }

    protected override void ExitThreadCore()
    {
        if (_closing) return;
        _closing = true;
        _timer.Stop();
        _timer.Dispose();
        try
        {
            if (_activeProcess is { HasExited: false }) _activeProcess.Kill(entireProcessTree: true);
        }
        catch { /* best-effort process cleanup during shutdown */ }
        _notifyIcon.Visible = false;
        _notifyIcon.Dispose();
        base.ExitThreadCore();
    }

    private async Task CheckScheduleAsync()
    {
        if (_closing) return;
        var now = GetKoreaNow();
        var time = now.TimeOfDay;

        if (time >= CollectionEnd)
        {
            if (_polling)
            {
                SetStatus("진단 수집기: 운영시간 종료 처리 중");
                return;
            }
            AppendActivity("INFO", "운영시간 종료로 런처 종료");
            ExitThread();
            return;
        }
        if (_polling)
        {
            if (time >= LastPollStartExclusive) SetStatus("진단 수집기: 마지막 수집 마무리 중 · 19시 종료");
            return;
        }

        if (time < CollectionStart)
        {
            SetStatus("진단 수집기: 오전 9시 대기");
            return;
        }
        if (time >= LastPollStartExclusive)
        {
            SetStatus("진단 수집기: 오늘 확인 종료 · 19시 종료");
            return;
        }

        _nextPollAt ??= now;
        if (now < _nextPollAt.Value)
        {
            SetStatus($"진단 수집기: 다음 확인 {_nextPollAt.Value:HH:mm}");
            return;
        }

        _nextPollAt = NextScheduledPoll(now);
        await RunPollAsync(now);

        if (!_closing && GetKoreaNow().TimeOfDay >= CollectionEnd)
        {
            AppendActivity("INFO", "운영시간 종료로 런처 종료");
            ExitThread();
        }
    }

    private async Task RunNowAsync()
    {
        if (_polling) return;
        var now = GetKoreaNow();
        if (!IsWithinCollectionWindow(now))
        {
            MessageBox.Show(
                "진단로그 확인 시간은 오전 9시부터 오후 6시 45분까지입니다.",
                "운영시간 안내",
                MessageBoxButtons.OK,
                MessageBoxIcon.Information);
            return;
        }
        await RunPollAsync(now);
    }

    private async Task RunPollAsync(DateTimeOffset startedAt)
    {
        if (_polling || _closing) return;
        _polling = true;
        SetStatus("진단 수집기: Drive 확인 중");

        try
        {
            var closingTime = new DateTimeOffset(
                startedAt.Year,
                startedAt.Month,
                startedAt.Day,
                19,
                0,
                0,
                startedAt.Offset);
            var scriptPath = Path.Combine(_projectRoot, DiagnosticScriptRelativePath);
            if (!File.Exists(scriptPath))
                throw new FileNotFoundException("진단 수집 스크립트를 찾을 수 없습니다.", scriptPath);
            if (!File.Exists(_nodePath) && !string.Equals(_nodePath, "node.exe", StringComparison.OrdinalIgnoreCase))
                throw new FileNotFoundException("Node.js 실행 파일을 찾을 수 없습니다.", _nodePath);

            var startInfo = new ProcessStartInfo
            {
                FileName = _nodePath,
                WorkingDirectory = _projectRoot,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                StandardOutputEncoding = Encoding.UTF8,
                StandardErrorEncoding = Encoding.UTF8,
            };
            startInfo.ArgumentList.Add(scriptPath);
            startInfo.ArgumentList.Add("--year");
            startInfo.ArgumentList.Add(startedAt.Year.ToString(CultureInfo.InvariantCulture));
            startInfo.ArgumentList.Add("--month");
            startInfo.ArgumentList.Add(startedAt.Month.ToString("00", CultureInfo.InvariantCulture));
            startInfo.ArgumentList.Add("--exit-if-empty");

            using var process = new Process { StartInfo = startInfo };
            if (!process.Start()) throw new InvalidOperationException("Node.js 수집기를 시작하지 못했습니다.");
            _activeProcess = process;
            var stdoutTask = process.StandardOutput.ReadToEndAsync();
            var stderrTask = process.StandardError.ReadToEndAsync();
            var untilClose = closingTime - GetKoreaNow();
            if (untilClose <= TimeSpan.Zero)
            {
                try { process.Kill(entireProcessTree: true); } catch { /* already exited */ }
                throw new TimeoutException("오후 7시 운영시간 종료에 따라 수집을 중단했습니다. 남은 파일은 다음 실행에서 재시도됩니다.");
            }
            var timeoutLimit = untilClose < ProcessTimeout ? untilClose : ProcessTimeout;
            using var timeout = new CancellationTokenSource(timeoutLimit);
            try
            {
                await process.WaitForExitAsync(timeout.Token);
            }
            catch (OperationCanceledException)
            {
                try { process.Kill(entireProcessTree: true); } catch { /* already exited */ }
                if (GetKoreaNow().TimeOfDay >= CollectionEnd)
                    throw new TimeoutException("오후 7시 운영시간 종료에 따라 수집을 중단했습니다. 남은 파일은 다음 실행에서 재시도됩니다.");
                throw new TimeoutException("진단로그 수집이 10분 안에 끝나지 않아 중단했습니다.");
            }

            var stdout = await stdoutTask;
            var stderr = await stderrTask;
            if (process.ExitCode != 0)
            {
                var detail = FirstLine(stderr);
                throw new InvalidOperationException(
                    string.IsNullOrWhiteSpace(detail)
                        ? $"수집기 종료 코드 {process.ExitCode}"
                        : detail);
            }

            using var resultDocument = JsonDocument.Parse(stdout);
            var root = resultDocument.RootElement;
            var selected = ReadInt(root, "selectedFileCount");
            if (ReadBool(root, "skippedEmpty"))
            {
                _lastResult = $"{startedAt:yyyy-MM-dd HH:mm} 확인: 새 진단로그가 없습니다.";
                SetStatus($"진단 수집기: 새 로그 없음 · {startedAt:HH:mm}");
                AppendActivity("INFO", "새 진단로그 없음");
                return;
            }

            var inserted = ReadInt(root, "insertedEventCount");
            var deleted = ReadInt(root, "driveFilesDeleted");
            var reportPath = ReadString(root, "reportPath");
            _lastResult = $"확인 시각: {startedAt:yyyy-MM-dd HH:mm} KST\r\n" +
                          $"처리 파일: {selected}개\r\n저장 이벤트: {inserted}건\r\n" +
                          $"Drive 원본 삭제: {deleted}개\r\n보고서: {reportPath}";
            SetStatus($"진단 수집기: {selected}개 처리 · {startedAt:HH:mm}");
            AppendActivity("INFO", $"분석 완료 files={selected}, events={inserted}, deleted={deleted}");
            if (selected > 0)
            {
                _notifyIcon.BalloonTipTitle = "진단로그 분석 완료";
                _notifyIcon.BalloonTipText = $"{selected}개 파일, {inserted}건 저장 후 원본 {deleted}개를 정리했습니다.";
                _notifyIcon.ShowBalloonTip(5000);
            }
        }
        catch (Exception error)
        {
            _lastResult = $"확인 시각: {startedAt:yyyy-MM-dd HH:mm} KST\r\n오류: {error.Message}";
            SetStatus($"진단 수집기: 오류 · {startedAt:HH:mm}");
            AppendActivity("ERROR", FirstLine(error.Message));
            _notifyIcon.BalloonTipTitle = "진단로그 확인 실패";
            _notifyIcon.BalloonTipText = "트레이 메뉴의 ‘최근 실행 결과’에서 오류를 확인하세요.";
            _notifyIcon.ShowBalloonTip(7000);
        }
        finally
        {
            _activeProcess = null;
            _polling = false;
            if (!_closing && GetKoreaNow().TimeOfDay >= CollectionEnd)
            {
                AppendActivity("INFO", "운영시간 종료로 런처 종료");
                ExitThread();
            }
        }
    }

    private async Task RequestExitAsync()
    {
        if (_polling)
        {
            var answer = MessageBox.Show(
                "진단로그 수집이 진행 중입니다. 중단된 파일은 다음 실행에서 다시 처리됩니다. 지금 종료할까요?",
                "수집 중 종료",
                MessageBoxButtons.YesNo,
                MessageBoxIcon.Warning);
            if (answer != DialogResult.Yes) return;

            try
            {
                if (_activeProcess is { HasExited: false }) _activeProcess.Kill(entireProcessTree: true);
            }
            catch { /* poll task reports process termination */ }
            while (_polling) await Task.Delay(100);
        }
        ExitThread();
    }

    private void SetStatus(string text)
    {
        _statusItem.Text = text;
        _notifyIcon.Text = text.Length <= 63 ? text : text[..63];
    }

    private void UpdateStartupRegistration()
    {
        if (_updatingStartupItem) return;
        try
        {
            SetStartupRegistration(_startupItem.Checked);
            AppendActivity("INFO", _startupItem.Checked ? "Windows 자동 시작 사용" : "Windows 자동 시작 해제");
        }
        catch (Exception error)
        {
            MessageBox.Show(
                $"Windows 자동 시작 설정을 변경하지 못했습니다.\r\n{error.Message}",
                "설정 변경 실패",
                MessageBoxButtons.OK,
                MessageBoxIcon.Warning);
            _updatingStartupItem = true;
            try { _startupItem.Checked = IsStartupRegistered(); }
            finally { _updatingStartupItem = false; }
        }
    }

    private void OpenLatestReport()
    {
        var now = GetKoreaNow();
        var reportDirectory = Path.Combine(_archiveRoot, now.Year.ToString(CultureInfo.InvariantCulture), now.Month.ToString("00", CultureInfo.InvariantCulture));
        var latest = Directory.Exists(reportDirectory)
            ? Directory.GetFiles(reportDirectory, "diagnostics-*.json").OrderByDescending(File.GetLastWriteTimeUtc).FirstOrDefault()
            : null;
        if (latest is null)
        {
            MessageBox.Show("아직 분석 보고서가 없습니다.", "보고서 없음", MessageBoxButtons.OK, MessageBoxIcon.Information);
            return;
        }
        Process.Start(new ProcessStartInfo(latest) { UseShellExecute = true });
    }

    private void OpenSettingsFile()
    {
        try
        {
            if (!File.Exists(_settingsPath)) SaveSettings(_projectRoot, _nodePath);
            Process.Start(new ProcessStartInfo("notepad.exe", $"\"{_settingsPath}\"") { UseShellExecute = false });
        }
        catch (Exception error)
        {
            MessageBox.Show(error.Message, "설정 파일 열기 실패", MessageBoxButtons.OK, MessageBoxIcon.Warning);
        }
    }

    private (string ProjectRoot, string NodePath) LoadSettings()
    {
        var projectRoot = FindProjectRoot();
        var nodePath = FindNodePath("");
        if (File.Exists(_settingsPath))
        {
            try
            {
                var settings = JsonSerializer.Deserialize<LauncherSettings>(File.ReadAllText(_settingsPath, Encoding.UTF8));
                if (!string.IsNullOrWhiteSpace(settings?.ProjectRoot)) projectRoot = settings.ProjectRoot;
                if (!string.IsNullOrWhiteSpace(settings?.NodePath)) nodePath = FindNodePath(settings.NodePath);
            }
            catch (JsonException) { /* use discovered defaults if local settings are malformed */ }
        }
        SaveSettings(projectRoot, nodePath);
        return (projectRoot, nodePath);
    }

    private void SaveSettings(string projectRoot, string nodePath)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(_settingsPath)!);
        var settings = new LauncherSettings { ProjectRoot = projectRoot, NodePath = nodePath };
        File.WriteAllText(_settingsPath, JsonSerializer.Serialize(settings, new JsonSerializerOptions { WriteIndented = true }), new UTF8Encoding(false));
    }

    private static string FindProjectRoot()
    {
        var current = new DirectoryInfo(AppContext.BaseDirectory);
        while (current is not null)
        {
            if (File.Exists(Path.Combine(current.FullName, "package.json")) &&
                File.Exists(Path.Combine(current.FullName, DiagnosticScriptRelativePath)))
                return current.FullName;
            current = current.Parent;
        }
        var configured = Environment.GetEnvironmentVariable("OSOO_DIAGNOSTIC_PROJECT_ROOT");
        return string.IsNullOrWhiteSpace(configured) ? @"E:\Wastewater Treatment Plant" : configured;
    }

    private static string FindNodePath(string configured)
    {
        if (!string.IsNullOrWhiteSpace(configured) && File.Exists(configured)) return configured;
        var fromEnvironment = Environment.GetEnvironmentVariable("OSOO_DIAGNOSTIC_NODE_PATH");
        if (!string.IsNullOrWhiteSpace(fromEnvironment) && File.Exists(fromEnvironment)) return fromEnvironment;
        foreach (var directory in (Environment.GetEnvironmentVariable("PATH") ?? "").Split(
                     Path.PathSeparator,
                     StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            var candidate = Path.Combine(directory.Trim('"'), "node.exe");
            if (File.Exists(candidate)) return candidate;
        }
        var standard = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "nodejs", "node.exe");
        return File.Exists(standard) ? standard : "node.exe";
    }

    private static DateTimeOffset GetKoreaNow() => TimeZoneInfo.ConvertTime(DateTimeOffset.UtcNow, KoreaTimeZone);

    private static DateTimeOffset NextScheduledPoll(DateTimeOffset now)
    {
        var start = new DateTimeOffset(now.Year, now.Month, now.Day, 9, 0, 0, now.Offset);
        var elapsed = now - start;
        var nextIndex = (long)Math.Floor(elapsed.TotalMinutes / PollInterval.TotalMinutes) + 1;
        return start.AddTicks(PollInterval.Ticks * nextIndex);
    }

    private static bool IsWithinCollectionWindow(DateTimeOffset koreaTime) =>
        koreaTime.TimeOfDay >= CollectionStart && koreaTime.TimeOfDay < LastPollStartExclusive;

    private static bool IsStartupRegistered()
    {
        using var key = Registry.CurrentUser.OpenSubKey(StartupRegistryPath, writable: false);
        return key?.GetValue(StartupRegistryName) is string;
    }

    private static void SetStartupRegistration(bool enabled)
    {
        RegisterDailySchedule(enabled);
        using var key = Registry.CurrentUser.CreateSubKey(StartupRegistryPath, writable: true)
            ?? throw new InvalidOperationException("현재 사용자 자동 시작 레지스트리를 열 수 없습니다.");
        if (enabled)
        {
            key.SetValue(
                StartupRegistryName,
                $"\"{Application.ExecutablePath}\" --background",
                RegistryValueKind.String);
        }
        else
        {
            key.DeleteValue(StartupRegistryName, throwOnMissingValue: false);
        }
    }

    private static void RegisterDailySchedule(bool enabled)
    {
        var script = Path.Combine(FindProjectRoot(), "tools", "diagnostic-archive", "launcher", "register-schedule.ps1");
        var start = new ProcessStartInfo("powershell.exe")
        {
            UseShellExecute = false, CreateNoWindow = true,
            RedirectStandardOutput = true, RedirectStandardError = true,
        };
        foreach (var argument in new[] { "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script, "-ExecutablePath", Application.ExecutablePath })
            start.ArgumentList.Add(argument);
        if (!enabled) start.ArgumentList.Add("-Disable");
        using var process = Process.Start(start) ?? throw new InvalidOperationException("예약 등록 프로세스를 시작하지 못했습니다.");
        var output = process.StandardOutput.ReadToEndAsync();
        var error = process.StandardError.ReadToEndAsync();
        if (!process.WaitForExit(20000))
        {
            process.Kill(entireProcessTree: true);
            throw new TimeoutException("자동 시작 예약 등록 시간이 초과되었습니다.");
        }
        if (process.ExitCode != 0) throw new InvalidOperationException(FirstLine(error.GetAwaiter().GetResult()));
        output.GetAwaiter().GetResult();
    }

    private void AppendActivity(string level, string message)
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(_activityLogPath)!);
            var info = new FileInfo(_activityLogPath);
            if (info.Exists && DateTime.UtcNow - info.LastWriteTimeUtc > TimeSpan.FromDays(30))
                File.Delete(_activityLogPath);
            else if (info.Exists && info.Length > 512 * 1024)
                File.WriteAllLines(_activityLogPath, File.ReadAllLines(_activityLogPath, Encoding.UTF8).TakeLast(1500), new UTF8Encoding(false));

            var sanitized = message.Replace('\r', ' ').Replace('\n', ' ').Trim();
            File.AppendAllText(
                _activityLogPath,
                $"{GetKoreaNow():yyyy-MM-dd HH:mm:ss} KST | {level} | {sanitized}{Environment.NewLine}",
                new UTF8Encoding(false));
        }
        catch { /* optional activity history must not interrupt collection */ }
    }

    private static int ReadInt(JsonElement root, string property) =>
        root.TryGetProperty(property, out var value) && value.TryGetInt32(out var number) ? number : 0;

    private static bool ReadBool(JsonElement root, string property) =>
        root.TryGetProperty(property, out var value) && value.ValueKind == JsonValueKind.True;

    private static string ReadString(JsonElement root, string property) =>
        root.TryGetProperty(property, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString() ?? ""
            : "";

    private static string FirstLine(string text)
    {
        var line = text.Split(['\r', '\n'], StringSplitOptions.RemoveEmptyEntries).FirstOrDefault()?.Trim() ?? "";
        return line.Length <= 500 ? line : line[..500];
    }

    internal static int RunSelfTest()
    {
        var offset = TimeSpan.FromHours(9);
        var windowCases = new[]
        {
            (new DateTimeOffset(2026, 10, 7, 8, 59, 59, offset), false),
            (new DateTimeOffset(2026, 10, 7, 9, 0, 0, offset), true),
            (new DateTimeOffset(2026, 10, 7, 18, 45, 59, offset), true),
            (new DateTimeOffset(2026, 10, 7, 18, 46, 0, offset), false),
            (new DateTimeOffset(2026, 10, 7, 19, 0, 0, offset), false),
        };
        foreach (var (time, expected) in windowCases)
        {
            if (IsWithinCollectionWindow(time) != expected)
            {
                Console.Error.WriteLine($"FAIL: operating window at {time:HH:mm:ss}");
                return 1;
            }
        }

        var scheduleCases = new[]
        {
            (new DateTimeOffset(2026, 10, 7, 9, 0, 0, offset), new DateTimeOffset(2026, 10, 7, 9, 15, 0, offset)),
            (new DateTimeOffset(2026, 10, 7, 10, 7, 0, offset), new DateTimeOffset(2026, 10, 7, 10, 15, 0, offset)),
            (new DateTimeOffset(2026, 10, 7, 18, 30, 0, offset), new DateTimeOffset(2026, 10, 7, 18, 45, 0, offset)),
            (new DateTimeOffset(2026, 10, 7, 18, 50, 0, offset), new DateTimeOffset(2026, 10, 7, 19, 0, 0, offset)),
        };
        foreach (var (time, expected) in scheduleCases)
        {
            if (NextScheduledPoll(time) != expected)
            {
                Console.Error.WriteLine($"FAIL: next poll after {time:HH:mm}");
                return 1;
            }
        }

        Console.WriteLine("PASS: KST collection starts 09:00–18:45; 19:00 shutdown and 15-minute cadence");
        return 0;
    }

    private sealed class LauncherSettings
    {
        public string ProjectRoot { get; set; } = "";
        public string NodePath { get; set; } = "";
    }
}
