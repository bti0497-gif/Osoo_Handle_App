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
[assembly: System.Reflection.AssemblyVersion("1.0.7.0")]
[assembly: System.Reflection.AssemblyFileVersion("1.0.7.0")]

namespace OsooWatchdog
{
    [DataContract]
    internal sealed class MaintenanceState
    {
        [DataMember(Name = "reason")] public string Reason;
        [DataMember(Name = "expiresAt")] public string ExpiresAt;
    }

    [DataContract]
    internal sealed class UpdateUacObservationState
    {
        [DataMember(Name = "startedAt")] public string StartedAt;
        [DataMember(Name = "initialAppVersion")] public string InitialAppVersion;
        [DataMember(Name = "uacPromptObserved")] public bool UacPromptObserved;
        [DataMember(Name = "uacPromptObservedAt")] public string UacPromptObservedAt;
    }

    [DataContract]
    internal sealed class AppHeartbeat
    {
        [DataMember(Name = "appPid")] public int AppPid;
        [DataMember(Name = "appStartedAt")] public string AppStartedAt;
        [DataMember(Name = "checkedAt")] public string CheckedAt;
        [DataMember(Name = "serverReady")] public bool ServerReady;
        [DataMember(Name = "serverPort")] public int ServerPort;
        [DataMember(Name = "serverPid")] public int ServerPid;
        [DataMember(Name = "serverStartedAt")] public string ServerStartedAt;
        [DataMember(Name = "serverRecoveryInProgress")] public bool ServerRecoveryInProgress;
        [DataMember(Name = "serverHealthState")] public string ServerHealthState;
        [DataMember(Name = "serverHealthDecision")] public string ServerHealthDecision;
        [DataMember(Name = "serverHealthReason")] public string ServerHealthReason;
        [DataMember(Name = "serverHealthRetryAfterAt")] public string ServerHealthRetryAfterAt;
        [DataMember(Name = "serverHealthUpdatedAt")] public string ServerHealthUpdatedAt;
        [DataMember(Name = "sessionActive")] public bool SessionActive;
        [DataMember(Name = "windowVisible")] public bool WindowVisible;
    }

    [DataContract]
    internal sealed class ServerRecoveryResponse
    {
        [DataMember(Name = "requestId")] public string RequestId;
        [DataMember(Name = "respondedAt")] public string RespondedAt;
        [DataMember(Name = "decision")] public string Decision;
        [DataMember(Name = "state")] public string State;
        [DataMember(Name = "reason")] public string Reason;
        [DataMember(Name = "retryAfterMs")] public int RetryAfterMs;
        [DataMember(Name = "retryAfterAt")] public string RetryAfterAt;
        [DataMember(Name = "serverPid")] public int ServerPid;
        [DataMember(Name = "serverRecoveryInProgress")] public bool ServerRecoveryInProgress;
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
        private static readonly TimeSpan UpdateUacObservationMaxAge = TimeSpan.FromMinutes(45);
        private static readonly Queue<DateTime> RestartTimes = new Queue<DateTime>();
        private static DateTime cooldownUntil = DateTime.MinValue;
        private static string lastRepeatedLogKey;
        private static DateTime lastRepeatedLogAt = DateTime.MinValue;
        private static string lastStatusKey;
        private static DateTime lastStatusAt = DateTime.MinValue;
        private static int serverHealthFailures;
        private static DateTime serverUnavailableSince = DateTime.MinValue;
        private static string pendingServerRecoveryRequestId;
        private static DateTime nextServerRecoveryRequestAt = DateTime.MinValue;
        private static string lastServerRecoveryResponseId;
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

                Log("watchdog-start", "ok", "version=1.0.7; dryRun=" + options.DryRun.ToString(CultureInfo.InvariantCulture));
                do
                {
                    try { CheckOnce(); }
                    catch (Exception ex) { Log("watchdog-check", "failed", ex.GetType().Name + ": " + ex.Message); }
                    if (options.Once) break;
                    // UAC 창은 짧게 나타날 수 있다. 업데이트 잠금 관찰 중에만
                    // 1초 단위로 확인하고, 평상시에는 기존 간격을 유지한다.
                    Thread.Sleep((HasPendingUpdateUacObservation() ? 1 : Math.Max(1, options.IntervalSeconds)) * 1000);
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
                if (maintenanceReason == "update") ObserveUpdateUacPrompt();
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

            CompleteUpdateUacObservationIfAppRestarted(appPath);

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
                Log("app-restart", "dry-run", BuildRestartDiagnostic(appPath, options.SimulateAbsent ? "trigger=simulate-app-absent" : "trigger=app-process-absent", null));
                WriteStatus("dry-run-restart", appPath, null);
                return;
            }

            StartApplication(appPath, "app-restart", true, options.SimulateAbsent ? "trigger=simulate-app-absent" : "trigger=app-process-absent");
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
            StartApplication(appPath, "emergency-recovery", false, "trigger=emergency-request; requestId=" + request.RequestId + "; reason=" + request.Reason);
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
                pendingServerRecoveryRequestId = null;
                nextServerRecoveryRequestAt = DateTime.MinValue;
                lastServerRecoveryResponseId = null;
                TryDelete(ServerRecoveryRequestPath());
                TryDelete(ServerRecoveryResponsePath());
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
                if (ShouldWaitForElectronServerDecision(heartbeat))
                {
                    WriteStatus("server-recovery-conversation", appPath, heartbeat.ServerHealthState);
                    return;
                }
                bool requestCreated = RequestEmbeddedServerRecovery(heartbeat, elapsed);
                if (heartbeat.SessionActive || heartbeat.WindowVisible)
                {
                    if (requestCreated)
                    {
                        Log("server-recovery", "waiting", "server-only; active-workflow=true; requestId=" + pendingServerRecoveryRequestId);
                    }
                    WriteStatus("server-only-recovery", appPath, null);
                    return;
                }
                if (elapsed < LiveAppServerRecoveryGrace)
                {
                    if (requestCreated)
                    {
                        Log("server-recovery", "waiting", "server-only; idle-preparation=true; requestId=" + pendingServerRecoveryRequestId);
                    }
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
            StartApplication(appPath, "server-recovery", true, "trigger=server-health-failure; failures=" + ServerHealthFailureLimit);
        }

        private static void StartApplication(string appPath, string action, bool background = true, string trigger = null)
        {
            var startInfo = new ProcessStartInfo
            {
                FileName = appPath,
                Arguments = background ? "--osoo-background-start" : "--osoo-emergency-recovery",
                WorkingDirectory = Path.GetDirectoryName(appPath),
                UseShellExecute = true,
                WindowStyle = ProcessWindowStyle.Hidden
            };
            try
            {
                Process startedProcess = Process.Start(startInfo);
                RestartTimes.Enqueue(DateTime.UtcNow);
                string launchedPid = startedProcess == null ? "unknown" : startedProcess.Id.ToString(CultureInfo.InvariantCulture);
                if (startedProcess != null) startedProcess.Dispose();
                Log(action, "started", BuildRestartDiagnostic(appPath, trigger, launchedPid));
                WriteStatus(action == "server-recovery" ? "server-recovery-started" : action == "emergency-recovery" ? "emergency-recovery-started" : "restart-started", appPath, null);
            }
            catch (Exception ex)
            {
                Log(action, "failed", BuildRestartDiagnostic(appPath, trigger, null) + "; launchError=" + ex.GetType().Name);
                WriteStatus("restart-failed", appPath, action);
            }
        }

        private static string BuildRestartDiagnostic(string appPath, string trigger, string launchedPid)
        {
            AppHeartbeat heartbeat = ReadAppHeartbeat();
            string heartbeatSummary = heartbeat == null
                ? "missing"
                : "pid=" + heartbeat.AppPid.ToString(CultureInfo.InvariantCulture)
                    + ",serverReady=" + heartbeat.ServerReady.ToString(CultureInfo.InvariantCulture)
                    + ",serverPort=" + heartbeat.ServerPort.ToString(CultureInfo.InvariantCulture)
                    + ",checkedAt=" + (heartbeat.CheckedAt ?? "missing");
            return (trigger ?? "trigger=unknown")
                + "; path=" + appPath
                + "; observedAppProcesses=" + DescribeAppProcesses(appPath)
                + "; heartbeat=" + heartbeatSummary
                + "; port=" + DedicatedServerPort.ToString(CultureInfo.InvariantCulture)
                + "; portReachable=" + IsDedicatedServerReachable().ToString(CultureInfo.InvariantCulture)
                + "; restartWindowCount=" + RestartTimes.Count.ToString(CultureInfo.InvariantCulture)
                + (String.IsNullOrWhiteSpace(launchedPid) ? "" : "; launchedPid=" + launchedPid);
        }

        private static string DescribeAppProcesses(string expectedPath)
        {
            var descriptions = new List<string>();
            foreach (Process process in Process.GetProcessesByName("Osoo Handle App"))
            {
                try
                {
                    string actualPath = process.MainModule.FileName;
                    bool pathMatch = String.Equals(Path.GetFullPath(actualPath), Path.GetFullPath(expectedPath), StringComparison.OrdinalIgnoreCase);
                    descriptions.Add("pid=" + process.Id.ToString(CultureInfo.InvariantCulture)
                        + ",pathMatch=" + pathMatch.ToString(CultureInfo.InvariantCulture)
                        + ",startedAt=" + process.StartTime.ToUniversalTime().ToString("o"));
                }
                catch
                {
                    descriptions.Add("pid=" + process.Id.ToString(CultureInfo.InvariantCulture) + ",inspect=denied");
                }
                finally { process.Dispose(); }
            }
            return descriptions.Count == 0 ? "none" : String.Join("|", descriptions.ToArray());
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

        private static string ServerRecoveryRequestPath()
        {
            return Path.Combine(runtimeDirectory, "server-recovery-request.json");
        }

        private static string ServerRecoveryResponsePath()
        {
            return Path.Combine(runtimeDirectory, "server-recovery-response.json");
        }

        private static bool ShouldWaitForElectronServerDecision(AppHeartbeat heartbeat)
        {
            ServerRecoveryResponse response;
            if (TryReadServerRecoveryResponse(out response))
            {
                DateTime retryAfterAt;
                if (!String.IsNullOrWhiteSpace(response.RequestId)
                    && response.RequestId == pendingServerRecoveryRequestId
                    && DateTime.TryParse(response.RetryAfterAt, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out retryAfterAt))
                {
                    nextServerRecoveryRequestAt = retryAfterAt.ToUniversalTime();
                    if (response.RequestId != lastServerRecoveryResponseId)
                    {
                        lastServerRecoveryResponseId = response.RequestId;
                        Log("server-recovery-response", "received",
                            "requestId=" + response.RequestId
                            + "; decision=" + (response.Decision ?? "unknown")
                            + "; state=" + (response.State ?? "unknown")
                            + "; retryAfterAt=" + nextServerRecoveryRequestAt.ToString("o")
                            + "; serverPid=" + response.ServerPid.ToString(CultureInfo.InvariantCulture));
                    }
                    if (nextServerRecoveryRequestAt > DateTime.UtcNow) return true;
                }
            }

            DateTime heartbeatRetryAfterAt;
            bool conversationState = String.Equals(heartbeat.ServerHealthState, "starting", StringComparison.OrdinalIgnoreCase)
                || String.Equals(heartbeat.ServerHealthState, "degraded", StringComparison.OrdinalIgnoreCase)
                || String.Equals(heartbeat.ServerHealthState, "recovering", StringComparison.OrdinalIgnoreCase);
            if (conversationState
                && DateTime.TryParse(heartbeat.ServerHealthRetryAfterAt, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out heartbeatRetryAfterAt)
                && heartbeatRetryAfterAt.ToUniversalTime() > DateTime.UtcNow)
            {
                nextServerRecoveryRequestAt = heartbeatRetryAfterAt.ToUniversalTime();
                return true;
            }

            return heartbeat.ServerRecoveryInProgress || nextServerRecoveryRequestAt > DateTime.UtcNow;
        }

        private static bool TryReadServerRecoveryResponse(out ServerRecoveryResponse response)
        {
            response = null;
            string responsePath = ServerRecoveryResponsePath();
            if (!File.Exists(responsePath)) return false;
            try
            {
                using (var stream = File.OpenRead(responsePath))
                    response = (ServerRecoveryResponse)new DataContractJsonSerializer(typeof(ServerRecoveryResponse)).ReadObject(stream);
                DateTime respondedAt;
                if (response == null
                    || String.IsNullOrWhiteSpace(response.RequestId)
                    || !DateTime.TryParse(response.RespondedAt, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out respondedAt)
                    || DateTime.UtcNow - respondedAt.ToUniversalTime() > TimeSpan.FromMinutes(3))
                {
                    TryDelete(responsePath);
                    response = null;
                    return false;
                }
                return true;
            }
            catch
            {
                TryDelete(responsePath);
                response = null;
                return false;
            }
        }

        private static bool RequestEmbeddedServerRecovery(AppHeartbeat heartbeat, TimeSpan elapsed)
        {
            string requestPath = ServerRecoveryRequestPath();
            try
            {
                if (nextServerRecoveryRequestAt > DateTime.UtcNow) return false;
                if (File.Exists(requestPath) && DateTime.UtcNow - File.GetLastWriteTimeUtc(requestPath) < TimeSpan.FromSeconds(30)) return false;
                string requestId = Guid.NewGuid().ToString("N");
                DateTime now = DateTime.UtcNow;
                string json = "{\n  \"requestId\": \"" + requestId
                    + "\",\n  \"requestedAt\": \"" + now.ToString("o")
                    + "\",\n  \"expiresAt\": \"" + now.AddMinutes(2).ToString("o")
                    + "\",\n  \"reason\": \"watchdog-server-health-failure\"\n}";
                AtomicWrite(requestPath, json);
                pendingServerRecoveryRequestId = requestId;
                nextServerRecoveryRequestAt = now.AddSeconds(30);
                TryDelete(ServerRecoveryResponsePath());
                Log("server-only-recovery", "requested",
                    "requestId=" + requestId
                    + "; serverPid=" + (heartbeat == null ? "0" : heartbeat.ServerPid.ToString(CultureInfo.InvariantCulture))
                    + "; electronRecovery=" + (heartbeat != null && heartbeat.ServerRecoveryInProgress).ToString(CultureInfo.InvariantCulture)
                    + "; sessionActive=" + (heartbeat != null && heartbeat.SessionActive).ToString(CultureInfo.InvariantCulture)
                    + "; windowVisible=" + (heartbeat != null && heartbeat.WindowVisible).ToString(CultureInfo.InvariantCulture)
                    + "; elapsedSeconds=" + (int)elapsed.TotalSeconds);
                return true;
            }
            catch (Exception ex)
            {
                Log("server-only-recovery", "failed", ex.GetType().Name);
                return false;
            }
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
            if (heartbeat == null) return false;
            string startedAtText = !String.IsNullOrWhiteSpace(heartbeat.ServerStartedAt)
                ? heartbeat.ServerStartedAt
                : heartbeat.AppStartedAt;
            if (String.IsNullOrWhiteSpace(startedAtText)) return false;
            DateTime startedAt;
            return DateTime.TryParse(startedAtText, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out startedAt)
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

        private static string UpdateUacObservationPath()
        {
            return Path.Combine(runtimeDirectory, "update-uac-observation.json");
        }

        private static bool HasPendingUpdateUacObservation()
        {
            return File.Exists(UpdateUacObservationPath());
        }

        private static UpdateUacObservationState ReadUpdateUacObservation()
        {
            string filePath = UpdateUacObservationPath();
            if (!File.Exists(filePath)) return null;
            try
            {
                using (var stream = File.OpenRead(filePath))
                    return (UpdateUacObservationState)new DataContractJsonSerializer(typeof(UpdateUacObservationState)).ReadObject(stream);
            }
            catch
            {
                TryDelete(filePath);
                return null;
            }
        }

        private static void WriteUpdateUacObservation(UpdateUacObservationState state)
        {
            string json = "{\n  \"startedAt\": " + JsonString(state.StartedAt)
                + ",\n  \"initialAppVersion\": " + JsonString(state.InitialAppVersion)
                + ",\n  \"uacPromptObserved\": " + (state.UacPromptObserved ? "true" : "false")
                + ",\n  \"uacPromptObservedAt\": " + JsonString(state.UacPromptObservedAt)
                + "\n}";
            AtomicWrite(UpdateUacObservationPath(), json);
        }

        private static void ObserveUpdateUacPrompt()
        {
            UpdateUacObservationState state = ReadUpdateUacObservation();
            if (state == null)
            {
                state = new UpdateUacObservationState
                {
                    StartedAt = DateTime.UtcNow.ToString("o"),
                    InitialAppVersion = ReadAppFileVersion(ResolveAppPath()),
                    UacPromptObserved = false,
                    UacPromptObservedAt = null,
                };
                WriteUpdateUacObservation(state);
                Log("update-uac-observation", "started", "initialAppVersion=" + (state.InitialAppVersion ?? "unknown"));
            }

            if (state.UacPromptObserved || !IsConsentProcessRunning()) return;
            state.UacPromptObserved = true;
            state.UacPromptObservedAt = DateTime.UtcNow.ToString("o");
            WriteUpdateUacObservation(state);
            // Consent.exe is a Windows secure-desktop process. This is an
            // observation only; the watchdog never interacts with the prompt.
            Log("update-uac-observation", "uac-prompt-observed", "process=Consent.exe");
        }

        private static void CompleteUpdateUacObservationIfAppRestarted(string appPath)
        {
            UpdateUacObservationState state = ReadUpdateUacObservation();
            if (state == null) return;
            DateTime startedAt;
            if (!DateTime.TryParse(state.StartedAt, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out startedAt)
                || DateTime.UtcNow - startedAt.ToUniversalTime() > UpdateUacObservationMaxAge)
            {
                Log("update-uac-observation", "expired", "appRestarted=" + IsAppRunning(appPath));
                TryDelete(UpdateUacObservationPath());
                return;
            }
            if (!IsAppRunning(appPath)) return;

            string currentVersion = ReadAppFileVersion(appPath);
            bool versionChanged = !String.IsNullOrWhiteSpace(state.InitialAppVersion)
                && !String.IsNullOrWhiteSpace(currentVersion)
                && state.InitialAppVersion != currentVersion;
            Log("update-uac-observation", "app-restarted",
                "uacPromptObserved=" + state.UacPromptObserved
                + "; initialAppVersion=" + (state.InitialAppVersion ?? "unknown")
                + "; currentAppVersion=" + (currentVersion ?? "unknown")
                + "; versionChanged=" + versionChanged);
            TryDelete(UpdateUacObservationPath());
        }

        private static bool IsConsentProcessRunning()
        {
            try
            {
                foreach (Process process in Process.GetProcessesByName("Consent"))
                {
                    try
                    {
                        if (!process.HasExited) return true;
                    }
                    catch { }
                    finally { process.Dispose(); }
                }
            }
            catch { }
            return false;
        }

        private static string ReadAppFileVersion(string appPath)
        {
            if (String.IsNullOrWhiteSpace(appPath) || !File.Exists(appPath)) return null;
            try { return FileVersionInfo.GetVersionInfo(appPath).FileVersion; }
            catch { return null; }
        }

        private static void WriteStatus(string state, string appPath, string reason)
        {
            DateTime now = DateTime.UtcNow;
            string statusKey = (state ?? "") + "|" + (appPath ?? "") + "|" + (reason ?? "");
            if (statusKey == lastStatusKey && now - lastStatusAt < TimeSpan.FromMinutes(1)) return;
            lastStatusKey = statusKey;
            lastStatusAt = now;
            string json = "{\n  \"version\": \"1.0.7\",\n  \"checkedAt\": \"" + now.ToString("o") + "\",\n  \"state\": \"" + Escape(state) + "\",\n  \"appPath\": " + JsonString(appPath) + ",\n  \"maintenanceReason\": " + JsonString(reason) + "\n}";
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
                string eventJson = "{\"createdAt\":\"" + createdAt + "\",\"version\":\"1.0.7\",\"action\":\"" + Escape(action) + "\",\"result\":\"" + Escape(result) + "\",\"details\":" + JsonString(details) + "}" + Environment.NewLine;
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
