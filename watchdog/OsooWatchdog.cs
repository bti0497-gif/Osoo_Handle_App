using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Runtime.Serialization;
using System.Runtime.Serialization.Json;
using System.Net.Sockets;
using System.Text;
using System.Threading;

[assembly: System.Reflection.AssemblyTitle("Osoo Handle App Watchdog")]
[assembly: System.Reflection.AssemblyDescription("Background watchdog for Osoo Handle App")]
[assembly: System.Reflection.AssemblyCompany("Osoo")]
[assembly: System.Reflection.AssemblyProduct("Osoo Handle App Watchdog")]
[assembly: System.Reflection.AssemblyVersion("1.0.4.0")]
[assembly: System.Reflection.AssemblyFileVersion("1.0.4.0")]

namespace OsooWatchdog
{
    [DataContract]
    internal sealed class MaintenanceState
    {
        [DataMember(Name = "reason")] public string Reason;
        [DataMember(Name = "expiresAt")] public string ExpiresAt;
    }

    [DataContract]
    internal sealed class AppHeartbeat
    {
        [DataMember(Name = "appStartedAt")] public string AppStartedAt;
        [DataMember(Name = "checkedAt")] public string CheckedAt;
        [DataMember(Name = "serverReady")] public bool ServerReady;
        [DataMember(Name = "serverPort")] public int ServerPort;
    }

    [DataContract]
    internal sealed class EmergencyRecoveryRequest
    {
        [DataMember(Name = "requestId")] public string RequestId;
        [DataMember(Name = "requestedAt")] public string RequestedAt;
        [DataMember(Name = "expiresAt")] public string ExpiresAt;
        [DataMember(Name = "reason")] public string Reason;
    }

    internal sealed class Options
    {
        public bool Once;
        public bool DryRun;
        public bool NoDelay;
        public bool SimulateAbsent;
        public int IntervalSeconds = 5;
        public int MissingGraceSeconds = 10;
        public string AppPath;
        public string RuntimePath;
    }

    internal static class Program
    {
        private const string MutexName = "Local\\OsooHandleAppWatchdog-1.0";
        private const int MaxRestarts = 3;
        private const int DedicatedServerPort = 18731;
        private const int ServerHealthFailureLimit = 3;
        private static readonly TimeSpan RestartWindow = TimeSpan.FromMinutes(10);
        private static readonly TimeSpan Cooldown = TimeSpan.FromMinutes(30);
        private static readonly TimeSpan ServerStartupGrace = TimeSpan.FromMinutes(2);
        // Electron already restarts its embedded server. Do not compete with
        // that recovery while the app continues to publish a fresh heartbeat.
        private static readonly TimeSpan LiveAppServerRecoveryGrace = TimeSpan.FromMinutes(2);
        private static readonly Queue<DateTime> RestartTimes = new Queue<DateTime>();
        private static DateTime cooldownUntil = DateTime.MinValue;
        private static string lastRepeatedLogKey;
        private static DateTime lastRepeatedLogAt = DateTime.MinValue;
        private static string lastStatusKey;
        private static DateTime lastStatusAt = DateTime.MinValue;
        private static int serverHealthFailures;
        private static DateTime serverUnavailableSince = DateTime.MinValue;
        private static Options options;
        private static string runtimeDirectory;
        private static string logPath;

        [STAThread]
        private static int Main(string[] args)
        {
            options = ParseOptions(args);
            runtimeDirectory = !String.IsNullOrWhiteSpace(options.RuntimePath)
                ? Path.GetFullPath(options.RuntimePath)
                : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Osoo_Handle_App", "runtime");
            Directory.CreateDirectory(runtimeDirectory);
            logPath = Path.Combine(runtimeDirectory, "watchdog.log");

            bool createdNew;
            using (var mutex = new Mutex(true, MutexName, out createdNew))
            {
                if (!createdNew)
                {
                    Log("duplicate-instance", "ignored", null);
                    return 2;
                }

                Log("watchdog-start", "ok", "version=1.0.4; dryRun=" + options.DryRun.ToString(CultureInfo.InvariantCulture));
                do
                {
                    try { CheckOnce(); }
                    catch (Exception ex) { Log("watchdog-check", "failed", ex.GetType().Name + ": " + ex.Message); }
                    if (options.Once) break;
                    Thread.Sleep(Math.Max(1, options.IntervalSeconds) * 1000);
                } while (true);
            }
            return 0;
        }

        private static void CheckOnce()
        {
            string maintenanceReason;
            DateTime maintenanceExpiry;
            if (TryGetActiveMaintenance(out maintenanceReason, out maintenanceExpiry))
            {
                Log("maintenance-lock", "waiting", "reason=" + maintenanceReason + "; expiresAt=" + maintenanceExpiry.ToUniversalTime().ToString("o"));
                WriteStatus("maintenance", null, maintenanceReason);
                return;
            }

            string appPath = ResolveAppPath();
            if (String.IsNullOrEmpty(appPath))
            {
                Log("app-resolve", "not-found", null);
                WriteStatus("app-not-found", null, null);
                return;
            }

            EmergencyRecoveryRequest emergencyRequest;
            if (TryReadEmergencyRecoveryRequest(out emergencyRequest))
            {
                HandleEmergencyRecovery(appPath, emergencyRequest);
                return;
            }

            if (!options.SimulateAbsent && IsAppRunning(appPath))
            {
                MonitorEmbeddedServer(appPath);
                return;
            }

            DateTime now = DateTime.UtcNow;
            while (RestartTimes.Count > 0 && now - RestartTimes.Peek() > RestartWindow) RestartTimes.Dequeue();
            if (cooldownUntil > now)
            {
                Log("restart-cooldown", "waiting", "until=" + cooldownUntil.ToString("o"));
                WriteStatus("cooldown", appPath, null);
                return;
            }
            if (RestartTimes.Count >= MaxRestarts)
            {
                cooldownUntil = now.Add(Cooldown);
                Log("restart-cooldown", "started", "until=" + cooldownUntil.ToString("o"));
                WriteStatus("cooldown", appPath, null);
                return;
            }

            if (!options.NoDelay && !options.DryRun) Thread.Sleep(Math.Max(0, options.MissingGraceSeconds) * 1000);
            if (TryGetActiveMaintenance(out maintenanceReason, out maintenanceExpiry)) return;
            if (!options.SimulateAbsent && IsAppRunning(appPath)) return;

            if (options.DryRun)
            {
                Log("app-restart", "dry-run", "path=" + appPath);
                WriteStatus("dry-run-restart", appPath, null);
                return;
            }

            StartApplication(appPath, "app-restart");
        }

        private static void HandleEmergencyRecovery(string appPath, EmergencyRecoveryRequest request)
        {
            if (!CanRestart(appPath))
            {
                Log("emergency-recovery", "blocked", "requestId=" + request.RequestId + "; reason=" + request.Reason);
                WriteStatus("emergency-recovery-blocked", appPath, null);
                TryDelete(EmergencyRecoveryRequestPath());
                return;
            }

            Log("emergency-recovery", "accepted", "requestId=" + request.RequestId + "; reason=" + request.Reason);
            WriteStatus("emergency-recovery-handoff", appPath, null);
            if (options.DryRun)
            {
                Log("emergency-recovery", "dry-run", "requestId=" + request.RequestId);
                WriteStatus("emergency-recovery-dry-run", appPath, null);
                TryDelete(EmergencyRecoveryRequestPath());
                return;
            }

            if (IsAppRunning(appPath) && !TryTerminateApp(appPath))
            {
                Log("emergency-recovery", "failed", "cannot-terminate-app; requestId=" + request.RequestId);
                WriteStatus("emergency-recovery-failed", appPath, null);
                TryDelete(EmergencyRecoveryRequestPath());
                return;
            }

            Thread.Sleep(1000);
            if (IsAppRunning(appPath))
            {
                Log("emergency-recovery", "failed", "app-still-running; requestId=" + request.RequestId);
                WriteStatus("emergency-recovery-failed", appPath, null);
                TryDelete(EmergencyRecoveryRequestPath());
                return;
            }

            TryDelete(EmergencyRecoveryRequestPath());
            StartApplication(appPath, "emergency-recovery", false);
        }

        private static void MonitorEmbeddedServer(string appPath)
        {
            AppHeartbeat heartbeat = ReadAppHeartbeat();
            // A listening port alone is not a login-ready server. Electron
            // verifies the private ping token and publishes serverReady only
            // after DB and all routes have initialized.
            if (IsDedicatedServerReachable() && IsFreshAppHeartbeat(heartbeat) && heartbeat.ServerReady)
            {
                serverHealthFailures = 0;
                serverUnavailableSince = DateTime.MinValue;
                WriteStatus("running", appPath, null);
                return;
            }

            if (IsWithinServerStartupGrace(heartbeat) || IsAppWithinStartupGrace(appPath))
            {
                WriteStatus("server-starting", appPath, null);
                return;
            }

            if (IsFreshAppHeartbeat(heartbeat))
            {
                if (serverUnavailableSince == DateTime.MinValue) serverUnavailableSince = DateTime.UtcNow;
                TimeSpan elapsed = DateTime.UtcNow - serverUnavailableSince;
                if (elapsed < LiveAppServerRecoveryGrace)
                {
                    Log("server-recovery", "waiting", "fresh-app-heartbeat; elapsedSeconds=" + (int)elapsed.TotalSeconds);
                    WriteStatus("server-recovery-deferred", appPath, null);
                    return;
                }
            }
            else
            {
                serverUnavailableSince = DateTime.MinValue;
            }

            serverHealthFailures += 1;
            Log("server-health", "waiting", "port=" + DedicatedServerPort + "; failures=" + serverHealthFailures);
            if (serverHealthFailures < ServerHealthFailureLimit)
            {
                WriteStatus("server-unavailable", appPath, null);
                return;
            }
            serverHealthFailures = 0;

            if (!CanRestart(appPath)) return;

            if (!TryTerminateApp(appPath))
            {
                Log("server-recovery", "failed", "cannot-terminate-app");
                WriteStatus("server-recovery-failed", appPath, null);
                return;
            }

            Thread.Sleep(1000);
            if (IsAppRunning(appPath))
            {
                Log("server-recovery", "failed", "app-still-running");
                WriteStatus("server-recovery-failed", appPath, null);
                return;
            }
            StartApplication(appPath, "server-recovery");
        }

        private static void StartApplication(string appPath, string action, bool background = true)
        {
            var startInfo = new ProcessStartInfo
            {
                FileName = appPath,
                Arguments = background ? "--osoo-background-start" : "--osoo-emergency-recovery",
                WorkingDirectory = Path.GetDirectoryName(appPath),
                UseShellExecute = true,
                WindowStyle = ProcessWindowStyle.Hidden
            };
            Process.Start(startInfo);
            RestartTimes.Enqueue(DateTime.UtcNow);
            Log(action, "started", "path=" + appPath);
            WriteStatus(action == "server-recovery" ? "server-recovery-started" : action == "emergency-recovery" ? "emergency-recovery-started" : "restart-started", appPath, null);
        }

        private static bool CanRestart(string appPath)
        {
            DateTime now = DateTime.UtcNow;
            while (RestartTimes.Count > 0 && now - RestartTimes.Peek() > RestartWindow) RestartTimes.Dequeue();
            if (cooldownUntil > now)
            {
                Log("restart-cooldown", "waiting", "until=" + cooldownUntil.ToString("o"));
                WriteStatus("cooldown", appPath, null);
                return false;
            }
            if (RestartTimes.Count >= MaxRestarts)
            {
                cooldownUntil = now.Add(Cooldown);
                Log("restart-cooldown", "started", "until=" + cooldownUntil.ToString("o"));
                WriteStatus("cooldown", appPath, null);
                return false;
            }
            return true;
        }

        private static string ResolveAppPath()
        {
            var candidates = new List<string>();
            if (!String.IsNullOrWhiteSpace(options.AppPath)) candidates.Add(options.AppPath);
            candidates.Add(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Osoo Handle App", "Osoo Handle App.exe"));
            string programFilesX86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
            if (!String.IsNullOrEmpty(programFilesX86)) candidates.Add(Path.Combine(programFilesX86, "Osoo Handle App", "Osoo Handle App.exe"));
            candidates.Add(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "Osoo Handle App", "Osoo Handle App.exe"));
            foreach (string candidate in candidates)
            {
                try { if (!String.IsNullOrWhiteSpace(candidate) && File.Exists(candidate)) return Path.GetFullPath(candidate); }
                catch { }
            }
            return null;
        }

        private static bool IsAppRunning(string expectedPath)
        {
            foreach (Process process in Process.GetProcessesByName("Osoo Handle App"))
            {
                try
                {
                    string actualPath = process.MainModule.FileName;
                    if (String.Equals(Path.GetFullPath(actualPath), Path.GetFullPath(expectedPath), StringComparison.OrdinalIgnoreCase)) return true;
                }
                catch
                {
                    // A limited watchdog cannot inspect MainModule when the app
                    // is elevated. The matching product process is safer to
                    // treat as running than to start a duplicate every cycle.
                    return true;
                }
                finally { process.Dispose(); }
            }
            return false;
        }

        private static bool TryTerminateApp(string expectedPath)
        {
            bool found = false;
            foreach (Process process in Process.GetProcessesByName("Osoo Handle App"))
            {
                try
                {
                    string actualPath = process.MainModule.FileName;
                    if (!String.Equals(Path.GetFullPath(actualPath), Path.GetFullPath(expectedPath), StringComparison.OrdinalIgnoreCase)) continue;
                    found = true;
                    process.Kill();
                    process.WaitForExit(5000);
                }
                catch
                {
                    // Never kill an elevated or uninspectable process by name alone.
                    return false;
                }
                finally { process.Dispose(); }
            }
            return found;
        }

        private static bool IsAppWithinStartupGrace(string expectedPath)
        {
            foreach (Process process in Process.GetProcessesByName("Osoo Handle App"))
            {
                try
                {
                    string actualPath = process.MainModule.FileName;
                    if (!String.Equals(Path.GetFullPath(actualPath), Path.GetFullPath(expectedPath), StringComparison.OrdinalIgnoreCase)) continue;
                    return DateTime.UtcNow - process.StartTime.ToUniversalTime() < ServerStartupGrace;
                }
                catch
                {
                    // If the process cannot be inspected, do not risk interrupting startup.
                    return true;
                }
                finally { process.Dispose(); }
            }
            return false;
        }

        private static bool IsDedicatedServerReachable()
        {
            try
            {
                using (var client = new TcpClient())
                {
                    IAsyncResult pending = client.BeginConnect("127.0.0.1", DedicatedServerPort, null, null);
                    if (!pending.AsyncWaitHandle.WaitOne(1000)) return false;
                    client.EndConnect(pending);
                    return client.Connected;
                }
            }
            catch { return false; }
        }

        private static AppHeartbeat ReadAppHeartbeat()
        {
            string heartbeatPath = Path.Combine(runtimeDirectory, "app-heartbeat.json");
            if (!File.Exists(heartbeatPath)) return null;
            try
            {
                using (var stream = File.OpenRead(heartbeatPath))
                    return (AppHeartbeat)new DataContractJsonSerializer(typeof(AppHeartbeat)).ReadObject(stream);
            }
            catch { return null; }
        }

        private static string EmergencyRecoveryRequestPath()
        {
            return Path.Combine(runtimeDirectory, "emergency-recovery-request.json");
        }

        private static bool TryReadEmergencyRecoveryRequest(out EmergencyRecoveryRequest request)
        {
            request = null;
            string requestPath = EmergencyRecoveryRequestPath();
            if (!File.Exists(requestPath)) return false;
            try
            {
                using (var stream = File.OpenRead(requestPath))
                    request = (EmergencyRecoveryRequest)new DataContractJsonSerializer(typeof(EmergencyRecoveryRequest)).ReadObject(stream);
                DateTime requestedAt;
                DateTime expiresAt;
                if (request == null || String.IsNullOrWhiteSpace(request.RequestId) || String.IsNullOrWhiteSpace(request.Reason) ||
                    !DateTime.TryParse(request.RequestedAt, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out requestedAt) ||
                    !DateTime.TryParse(request.ExpiresAt, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out expiresAt) ||
                    expiresAt.ToUniversalTime() <= DateTime.UtcNow || requestedAt.ToUniversalTime() > DateTime.UtcNow.AddMinutes(1))
                {
                    TryDelete(requestPath);
                    Log("emergency-recovery", "expired-or-invalid", null);
                    request = null;
                    return false;
                }
                return true;
            }
            catch (Exception ex)
            {
                TryDelete(requestPath);
                Log("emergency-recovery", "invalid", ex.GetType().Name);
                request = null;
                return false;
            }
        }

        private static bool IsWithinServerStartupGrace(AppHeartbeat heartbeat)
        {
            if (heartbeat == null || String.IsNullOrWhiteSpace(heartbeat.AppStartedAt)) return false;
            DateTime startedAt;
            return DateTime.TryParse(heartbeat.AppStartedAt, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out startedAt)
                && DateTime.UtcNow - startedAt.ToUniversalTime() < ServerStartupGrace;
        }

        private static bool IsFreshAppHeartbeat(AppHeartbeat heartbeat)
        {
            if (heartbeat == null || String.IsNullOrWhiteSpace(heartbeat.CheckedAt)) return false;
            DateTime checkedAt;
            return DateTime.TryParse(heartbeat.CheckedAt, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out checkedAt)
                && DateTime.UtcNow - checkedAt.ToUniversalTime() < TimeSpan.FromSeconds(45);
        }

        private static bool TryGetActiveMaintenance(out string reason, out DateTime expiry)
        {
            reason = null;
            expiry = DateTime.MinValue;
            string filePath = Path.Combine(runtimeDirectory, "maintenance.json");
            if (!File.Exists(filePath)) return false;
            try
            {
                MaintenanceState state;
                using (var stream = File.OpenRead(filePath))
                    state = (MaintenanceState)new DataContractJsonSerializer(typeof(MaintenanceState)).ReadObject(stream);
                DateTime parsed;
                if (state == null || !IsMaintenanceReason(state.Reason) ||
                    !DateTime.TryParse(state.ExpiresAt, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out parsed) || parsed.ToUniversalTime() <= DateTime.UtcNow)
                {
                    TryDelete(filePath);
                    Log("maintenance-lock", "expired-or-invalid", null);
                    return false;
                }
                reason = state.Reason;
                expiry = parsed;
                return true;
            }
            catch (Exception ex)
            {
                Log("maintenance-lock", "invalid", ex.GetType().Name);
                TryDelete(filePath);
                return false;
            }
        }

        private static bool IsMaintenanceReason(string reason)
        {
            return reason == "update" || reason == "full-exit" || reason == "installer" || reason == "maintenance";
        }

        private static void WriteStatus(string state, string appPath, string reason)
        {
            DateTime now = DateTime.UtcNow;
            string statusKey = (state ?? "") + "|" + (appPath ?? "") + "|" + (reason ?? "");
            if (statusKey == lastStatusKey && now - lastStatusAt < TimeSpan.FromMinutes(1)) return;
            lastStatusKey = statusKey;
            lastStatusAt = now;
            string json = "{\n  \"version\": \"1.0.4\",\n  \"checkedAt\": \"" + now.ToString("o") + "\",\n  \"state\": \"" + Escape(state) + "\",\n  \"appPath\": " + JsonString(appPath) + ",\n  \"maintenanceReason\": " + JsonString(reason) + "\n}";
            AtomicWrite(Path.Combine(runtimeDirectory, "watchdog-status.json"), json);
        }

        private static void Log(string action, string result, string details)
        {
            try
            {
                string repeatedKey = action + "|" + result + "|" + (details ?? "");
                bool repeatable = result == "waiting" || result == "not-found";
                if (repeatable && repeatedKey == lastRepeatedLogKey && DateTime.UtcNow - lastRepeatedLogAt < TimeSpan.FromMinutes(5)) return;
                if (repeatable)
                {
                    lastRepeatedLogKey = repeatedKey;
                    lastRepeatedLogAt = DateTime.UtcNow;
                }
                RotateLog();
                string createdAt = DateTime.UtcNow.ToString("o");
                string line = createdAt + "\t" + action + "\t" + result + (String.IsNullOrEmpty(details) ? "" : "\t" + details) + Environment.NewLine;
                File.AppendAllText(logPath, line, new UTF8Encoding(false));
                string eventJson = "{\"createdAt\":\"" + createdAt + "\",\"version\":\"1.0.4\",\"action\":\"" + Escape(action) + "\",\"result\":\"" + Escape(result) + "\",\"details\":" + JsonString(details) + "}" + Environment.NewLine;
                File.AppendAllText(Path.Combine(runtimeDirectory, "watchdog-events.jsonl"), eventJson, new UTF8Encoding(false));
            }
            catch { }
        }

        private static void RotateLog()
        {
            if (!File.Exists(logPath) || new FileInfo(logPath).Length < 2 * 1024 * 1024) return;
            for (int index = 2; index >= 1; index--)
            {
                string source = logPath + "." + index.ToString(CultureInfo.InvariantCulture);
                string destination = logPath + "." + (index + 1).ToString(CultureInfo.InvariantCulture);
                if (File.Exists(destination)) TryDelete(destination);
                if (File.Exists(source)) File.Move(source, destination);
            }
            File.Move(logPath, logPath + ".1");
        }

        private static void AtomicWrite(string path, string content)
        {
            string temporary = path + ".tmp";
            File.WriteAllText(temporary, content, new UTF8Encoding(false));
            if (File.Exists(path)) File.Delete(path);
            File.Move(temporary, path);
        }

        private static string JsonString(string value) { return value == null ? "null" : "\"" + Escape(value) + "\""; }
        private static string Escape(string value) { return (value ?? "").Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", "\\r").Replace("\n", "\\n"); }
        private static void TryDelete(string path) { try { File.Delete(path); } catch { } }

        private static Options ParseOptions(string[] args)
        {
            var parsed = new Options();
            for (int i = 0; i < args.Length; i++)
            {
                string arg = args[i];
                if (arg == "--once") parsed.Once = true;
                else if (arg == "--dry-run") parsed.DryRun = true;
                else if (arg == "--no-delay") parsed.NoDelay = true;
                else if (arg == "--simulate-process-absent") parsed.SimulateAbsent = true;
                else if (arg == "--app" && i + 1 < args.Length) parsed.AppPath = args[++i];
                else if (arg == "--runtime" && i + 1 < args.Length) parsed.RuntimePath = args[++i];
                else if (arg == "--interval" && i + 1 < args.Length) Int32.TryParse(args[++i], out parsed.IntervalSeconds);
            }
            return parsed;
        }
    }
}
