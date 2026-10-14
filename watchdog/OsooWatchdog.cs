using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Runtime.Serialization;
using System.Runtime.Serialization.Json;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using Microsoft.Win32;
using System.Text;
using System.Threading;

[assembly: System.Reflection.AssemblyTitle("Osoo Handle App Watchdog")]
[assembly: System.Reflection.AssemblyDescription("Background watchdog for Osoo Handle App")]
[assembly: System.Reflection.AssemblyCompany("Osoo")]
[assembly: System.Reflection.AssemblyProduct("Osoo Handle App Watchdog")]
[assembly: System.Reflection.AssemblyVersion("1.0.14.0")]
[assembly: System.Reflection.AssemblyFileVersion("1.0.14.0")]

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
        public bool MonitorOnly;
        public bool NoDelay;
        public bool SimulateAbsent;
        public int IntervalSeconds = 5;
        public int MissingGraceSeconds = 10;
        public string AppPath;
        public string RuntimePath;
    }

    // Diagnostic only: aggregate Windows input flags while this app owns the foreground.
    // Never retain keys, text, pointer coordinates, window titles, or individual events.
    internal static class RemoteInputMonitor
    {
        private const int KeyboardHook = 13;
        private const int MouseHook = 14;
        private const int InjectedFlag = 0x10; // LLKHF_INJECTED; mouse uses 0x01 below.
        private static readonly object Gate = new object();
        private static readonly Queue<InputSample> Samples = new Queue<InputSample>();
        private static HookProc keyboardCallback = OnKeyboard;
        private static HookProc mouseCallback = OnMouse;
        private static volatile bool foregroundIsApp;
        private static volatile bool keyboardReady;
        private static volatile bool mouseReady;
        private static int keyboardError;
        private static int mouseError;
        private static string outputPath;
        private static string runtimeDirectory;
        private static long lastInputObservationAtTicks;
        private static long nextInputObservationAtTicks;
        private static int pendingKeyInjected;
        private static int pendingKeyNonInjected;
        private static int pendingMouseInjected;
        private static int pendingMouseNonInjected;
        private static int pendingLowerIntegrityInjected;
        private static readonly string inputMonitorId = Guid.NewGuid().ToString("N");
        private static long totalKeyInjected, totalKeyNonInjected, totalMouseInjected, totalMouseNonInjected;

        [DataContract]
        private sealed class RemoteSessionSnapshot
        {
            [DataMember(Name = "checkedAt")] public string CheckedAt;
            [DataMember(Name = "state")] public string State;
            [DataMember(Name = "sources")] public RemoteSessionSources Sources;
        }

        [DataContract]
        private sealed class RemoteSessionSources
        {
            [DataMember(Name = "rustDesk")] public string RustDesk;
            [DataMember(Name = "chromeRemoteDesktop")] public string ChromeRemoteDesktop;
        }

        [DataContract]
        private sealed class AppHeartbeatSnapshot
        {
            [DataMember(Name = "appPid")] public int AppPid;
            [DataMember(Name = "checkedAt")] public string CheckedAt;
        }

        private struct InputSample { public long Ticks; public bool Keyboard; public bool Injected; public bool LowerIntegrity; }
        private delegate IntPtr HookProc(int code, IntPtr wParam, IntPtr lParam);
        [StructLayout(LayoutKind.Sequential)] private struct KeyboardData
        { public uint VkCode, ScanCode, Flags, Time; public IntPtr ExtraInfo; }
        [StructLayout(LayoutKind.Sequential)] private struct Point { public int X, Y; }
        [StructLayout(LayoutKind.Sequential)] private struct MouseData
        { public Point Position; public uint MouseDataValue, Flags, Time; public IntPtr ExtraInfo; }
        [DllImport("user32.dll", SetLastError = true)] private static extern IntPtr SetWindowsHookEx(int idHook, HookProc callback, IntPtr module, uint threadId);
        [DllImport("user32.dll")] private static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr wParam, IntPtr lParam);
        [DllImport("user32.dll")] private static extern int GetMessage(out NativeMessage message, IntPtr window, uint min, uint max);
        [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
        [StructLayout(LayoutKind.Sequential)] private struct NativeMessage
        { public IntPtr Window; public uint Message; public IntPtr WParam, LParam; public uint Time; public Point Position; public uint Private; }

        public static void Start(string runtimeDirectory)
        {
            RemoteInputMonitor.runtimeDirectory = runtimeDirectory;
            outputPath = Path.Combine(runtimeDirectory, "remote-input-state.json");
            lastInputObservationAtTicks = DateTime.UtcNow.Ticks;
            nextInputObservationAtTicks = DateTime.UtcNow.AddSeconds(30).Ticks;
            var hookThread = new Thread(RunHooks) { IsBackground = true, Name = "Osoo input diagnostics" };
            var samplingThread = new Thread(RunSampler) { IsBackground = true, Name = "Osoo input summary" };
            hookThread.Start();
            samplingThread.Start();
        }

        private static void RunHooks()
        {
            IntPtr keyboard = SetWindowsHookEx(KeyboardHook, keyboardCallback, IntPtr.Zero, 0);
            keyboardReady = keyboard != IntPtr.Zero;
            if (!keyboardReady) keyboardError = Marshal.GetLastWin32Error();
            IntPtr mouse = SetWindowsHookEx(MouseHook, mouseCallback, IntPtr.Zero, 0);
            mouseReady = mouse != IntPtr.Zero;
            if (!mouseReady) mouseError = Marshal.GetLastWin32Error();
            if (!keyboardReady && !mouseReady) return;
            NativeMessage message;
            while (GetMessage(out message, IntPtr.Zero, 0, 0) > 0) { }
        }

        private static IntPtr OnKeyboard(int code, IntPtr wParam, IntPtr lParam)
        {
            if (code >= 0 && foregroundIsApp)
            {
                uint flags = Marshal.PtrToStructure<KeyboardData>(lParam).Flags;
                AddSample(true, (flags & InjectedFlag) != 0, (flags & 0x02) != 0);
            }
            return CallNextHookEx(IntPtr.Zero, code, wParam, lParam);
        }

        private static IntPtr OnMouse(int code, IntPtr wParam, IntPtr lParam)
        {
            if (code >= 0 && foregroundIsApp)
            {
                uint flags = Marshal.PtrToStructure<MouseData>(lParam).Flags;
                AddSample(false, (flags & 0x01) != 0, (flags & 0x02) != 0);
            }
            return CallNextHookEx(IntPtr.Zero, code, wParam, lParam);
        }

        private static void AddSample(bool keyboard, bool injected, bool lowerIntegrity)
        {
            lock (Gate)
            {
                Samples.Enqueue(new InputSample { Ticks = DateTime.UtcNow.Ticks, Keyboard = keyboard,
                    Injected = injected, LowerIntegrity = lowerIntegrity });
                if (keyboard)
                {
                    if (injected) { pendingKeyInjected++; totalKeyInjected++; }
                    else { pendingKeyNonInjected++; totalKeyNonInjected++; }
                }
                else if (injected) { pendingMouseInjected++; totalMouseInjected++; }
                else { pendingMouseNonInjected++; totalMouseNonInjected++; }
                if (lowerIntegrity) pendingLowerIntegrityInjected++;
                while (Samples.Count > 4096) Samples.Dequeue();
            }
        }

        private static void RunSampler()
        {
            while (true)
            {
                try { foregroundIsApp = IsAppForeground(); WriteSummary(); }
                catch { foregroundIsApp = false; }
                Thread.Sleep(1000);
            }
        }

        private static bool IsAppForeground()
        {
            IntPtr window = GetForegroundWindow();
            if (window == IntPtr.Zero) return false;
            uint processId;
            GetWindowThreadProcessId(window, out processId);
            if (processId == 0) return false;
            int heartbeatProcessId;
            if (TryGetFreshHeartbeatProcessId(out heartbeatProcessId))
                return processId == (uint)heartbeatProcessId;
            using (Process process = Process.GetProcessById((int)processId))
                return String.Equals(process.ProcessName, "Osoo Handle App", StringComparison.OrdinalIgnoreCase);
        }

        private static bool TryGetFreshHeartbeatProcessId(out int processId)
        {
            processId = 0;
            try
            {
                string heartbeatPath = Path.Combine(runtimeDirectory, "app-heartbeat.json");
                if (!File.Exists(heartbeatPath)) return false;
                var serializer = new DataContractJsonSerializer(typeof(AppHeartbeatSnapshot));
                AppHeartbeatSnapshot heartbeat;
                using (FileStream stream = File.OpenRead(heartbeatPath))
                    heartbeat = (AppHeartbeatSnapshot)serializer.ReadObject(stream);
                DateTime checkedAt;
                if (heartbeat == null || heartbeat.AppPid <= 0 || !DateTime.TryParse(heartbeat.CheckedAt,
                    CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal, out checkedAt)) return false;
                double ageSeconds = (DateTime.UtcNow - checkedAt.ToUniversalTime()).TotalSeconds;
                if (ageSeconds < -5 || ageSeconds > 15) return false;
                processId = heartbeat.AppPid;
                return true;
            }
            catch { return false; }
        }

        private static void WriteSummary()
        {
            string cumulativeJson;
            lock (Gate)
            {
                cumulativeJson = ",\"inputMonitorId\":\"" + inputMonitorId + "\",\"cumulative\":{\"keyboardInjected\":"
                    + totalKeyInjected.ToString(CultureInfo.InvariantCulture)
                    + ",\"keyboardNonInjected\":" + totalKeyNonInjected.ToString(CultureInfo.InvariantCulture)
                    + ",\"mouseInjected\":" + totalMouseInjected.ToString(CultureInfo.InvariantCulture)
                    + ",\"mouseNonInjected\":" + totalMouseNonInjected.ToString(CultureInfo.InvariantCulture) + "}";
            }
            DateTime now = DateTime.UtcNow;
            int keyInjected = 0, keyPhysical = 0, keyInjectedRecent = 0, keyPhysicalRecent = 0;
            int mouseInjected = 0, mousePhysical = 0, mouseInjectedRecent = 0, mousePhysicalRecent = 0, lowerIntegrity = 0;
            int observedKeyInjected = 0, observedKeyNonInjected = 0;
            int observedMouseInjected = 0, observedMouseNonInjected = 0, observedLowerIntegrity = 0;
            long lastKeyTicks = 0, lastInjectedKeyTicks = 0, lastNonInjectedKeyTicks = 0;
            long lastMouseTicks = 0, lastInjectedMouseTicks = 0, lastNonInjectedMouseTicks = 0;
            long observationStartedAtTicks = lastInputObservationAtTicks;
            bool inputObservationDue = now.Ticks >= nextInputObservationAtTicks;
            long observationWindowSeconds = inputObservationDue
                ? Math.Max(1, (now.Ticks - observationStartedAtTicks) / TimeSpan.TicksPerSecond) : 0;
            lock (Gate)
            {
                while (Samples.Count > 0 && now.Ticks - Samples.Peek().Ticks > TimeSpan.FromSeconds(30).Ticks) Samples.Dequeue();
                if (inputObservationDue)
                {
                    observedKeyInjected = pendingKeyInjected;
                    observedKeyNonInjected = pendingKeyNonInjected;
                    observedMouseInjected = pendingMouseInjected;
                    observedMouseNonInjected = pendingMouseNonInjected;
                    observedLowerIntegrity = pendingLowerIntegrityInjected;
                    pendingKeyInjected = pendingKeyNonInjected = pendingMouseInjected = pendingMouseNonInjected = pendingLowerIntegrityInjected = 0;
                }
                foreach (InputSample sample in Samples)
                {
                    if (sample.Keyboard)
                    {
                        if (sample.Injected)
                        {
                            keyInjected++;
                            if (now.Ticks - sample.Ticks <= TimeSpan.FromSeconds(5).Ticks) keyInjectedRecent++;
                            lastInjectedKeyTicks = sample.Ticks;
                        }
                        else
                        {
                            keyPhysical++;
                            if (now.Ticks - sample.Ticks <= TimeSpan.FromSeconds(5).Ticks) keyPhysicalRecent++;
                            lastNonInjectedKeyTicks = sample.Ticks;
                        }
                        lastKeyTicks = sample.Ticks;
                    }
                    else if (sample.Injected)
                    {
                        mouseInjected++;
                        if (now.Ticks - sample.Ticks <= TimeSpan.FromSeconds(5).Ticks) mouseInjectedRecent++;
                        lastInjectedMouseTicks = sample.Ticks;
                        lastMouseTicks = sample.Ticks;
                    }
                    else
                    {
                        mousePhysical++;
                        if (now.Ticks - sample.Ticks <= TimeSpan.FromSeconds(5).Ticks) mousePhysicalRecent++;
                        lastNonInjectedMouseTicks = sample.Ticks;
                        lastMouseTicks = sample.Ticks;
                    }
                    if (sample.LowerIntegrity) lowerIntegrity++;
                }
            }
            if (inputObservationDue)
            {
                lastInputObservationAtTicks = now.Ticks;
                nextInputObservationAtTicks = now.AddSeconds(30).Ticks;
            }
            string json = "{\"version\":\"1.0.14\",\"checkedAt\":\"" + now.ToString("o") + "\",\"foregroundIsApp\":"
                + foregroundIsApp.ToString().ToLowerInvariant()
                + ",\"keyboardHookReady\":" + keyboardReady.ToString().ToLowerInvariant()
                + ",\"mouseHookReady\":" + mouseReady.ToString().ToLowerInvariant()
                + ",\"keyboardHookError\":" + keyboardError.ToString(CultureInfo.InvariantCulture)
                + ",\"mouseHookError\":" + mouseError.ToString(CultureInfo.InvariantCulture)
                + ",\"windowSeconds\":30,\"keyboardInjected\":" + keyInjected.ToString(CultureInfo.InvariantCulture)
                + ",\"keyboardNonInjected\":" + keyPhysical.ToString(CultureInfo.InvariantCulture)
                + ",\"keyboardInjectedLast5Seconds\":" + keyInjectedRecent.ToString(CultureInfo.InvariantCulture)
                + ",\"keyboardNonInjectedLast5Seconds\":" + keyPhysicalRecent.ToString(CultureInfo.InvariantCulture)
                + ",\"mouseInjected\":" + mouseInjected.ToString(CultureInfo.InvariantCulture)
                + ",\"mouseNonInjected\":" + mousePhysical.ToString(CultureInfo.InvariantCulture)
                + ",\"mouseInjectedLast5Seconds\":" + mouseInjectedRecent.ToString(CultureInfo.InvariantCulture)
                + ",\"mouseNonInjectedLast5Seconds\":" + mousePhysicalRecent.ToString(CultureInfo.InvariantCulture)
                + ",\"lowerIntegrityInjected\":" + lowerIntegrity.ToString(CultureInfo.InvariantCulture)
                + ",\"lastInputAgeMs\":" + AgeMillisecondsJson(now.Ticks, Math.Max(lastKeyTicks, lastMouseTicks))
                + ",\"lastKeyboardAgeMs\":" + AgeMillisecondsJson(now.Ticks, lastKeyTicks)
                + ",\"lastInjectedKeyboardAgeMs\":" + AgeMillisecondsJson(now.Ticks, lastInjectedKeyTicks)
                + ",\"lastNonInjectedKeyboardAgeMs\":" + AgeMillisecondsJson(now.Ticks, lastNonInjectedKeyTicks)
                + ",\"lastMouseAgeMs\":" + AgeMillisecondsJson(now.Ticks, lastMouseTicks)
                + ",\"lastInjectedMouseAgeMs\":" + AgeMillisecondsJson(now.Ticks, lastInjectedMouseTicks)
                + ",\"lastNonInjectedMouseAgeMs\":" + AgeMillisecondsJson(now.Ticks, lastNonInjectedMouseTicks) + cumulativeJson + "}";
            string temporary = outputPath + ".tmp";
            File.WriteAllText(temporary, json, new UTF8Encoding(false));
            bool replaced = false;
            if (File.Exists(outputPath))
            {
                try { File.Replace(temporary, outputPath, null); replaced = true; }
                catch { File.Delete(outputPath); }
            }
            if (!replaced) File.Move(temporary, outputPath);
            if (inputObservationDue && (observedKeyInjected + observedKeyNonInjected + observedMouseInjected + observedMouseNonInjected) > 0)
            {
                WriteInputObservation(now, observationStartedAtTicks, observationWindowSeconds,
                    observedKeyInjected, observedKeyNonInjected, observedMouseInjected, observedMouseNonInjected,
                    keyInjectedRecent, keyPhysicalRecent, mouseInjectedRecent, mousePhysicalRecent, observedLowerIntegrity,
                    lastKeyTicks, lastInjectedKeyTicks, lastNonInjectedKeyTicks,
                    lastMouseTicks, lastInjectedMouseTicks, lastNonInjectedMouseTicks);
            }
        }

        private static string AgeMillisecondsJson(long nowTicks, long eventTicks)
        {
            return eventTicks == 0 ? "null" : Math.Max(0, (nowTicks - eventTicks) / 10000).ToString(CultureInfo.InvariantCulture);
        }

        private static void WriteInputObservation(DateTime observedAt, long windowStartedAtTicks, long windowSeconds,
            int keyInjected, int keyNonInjected, int mouseInjected, int mouseNonInjected,
            int keyInjectedRecent, int keyNonInjectedRecent, int mouseInjectedRecent, int mouseNonInjectedRecent,
            int lowerIntegrity, long lastKeyTicks, long lastInjectedKeyTicks, long lastNonInjectedKeyTicks,
            long lastMouseTicks, long lastInjectedMouseTicks, long lastNonInjectedMouseTicks)
        {
            try
            {
                string overallState = "unknown";
                string rustDeskState = "unknown";
                string chromeState = "unknown";
                long remoteStateAgeSeconds = -1;
                string statePath = Path.Combine(runtimeDirectory, "remote-session-state.json");
                if (File.Exists(statePath))
                {
                    try
                    {
                        RemoteSessionSnapshot snapshot;
                        var serializer = new DataContractJsonSerializer(typeof(RemoteSessionSnapshot));
                        using (FileStream stream = File.OpenRead(statePath))
                            snapshot = (RemoteSessionSnapshot)serializer.ReadObject(stream);
                        DateTime checkedAt;
                        if (snapshot != null && DateTime.TryParse(snapshot.CheckedAt, CultureInfo.InvariantCulture,
                            DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal, out checkedAt))
                        {
                            remoteStateAgeSeconds = Math.Max(0, (long)(observedAt - checkedAt.ToUniversalTime()).TotalSeconds);
                            if (remoteStateAgeSeconds <= 15 && IsKnownRemoteState(snapshot.State)) overallState = snapshot.State;
                            if (snapshot.Sources != null)
                            {
                                if (remoteStateAgeSeconds <= 15 && IsKnownRemoteState(snapshot.Sources.RustDesk)) rustDeskState = snapshot.Sources.RustDesk;
                                if (remoteStateAgeSeconds <= 15 && IsKnownRemoteState(snapshot.Sources.ChromeRemoteDesktop)) chromeState = snapshot.Sources.ChromeRemoteDesktop;
                            }
                        }
                    }
                    catch { }
                }
                string timestamp = observedAt.ToString("o", CultureInfo.InvariantCulture);
                string windowStartedAt = new DateTime(windowStartedAtTicks, DateTimeKind.Utc).ToString("o", CultureInfo.InvariantCulture);
                string eventJson = "{\"observation_id\":\"" + Guid.NewGuid().ToString("N") + "\""
                    + ",\"createdAt\":\"" + timestamp + "\",\"version\":\"1.0.14\",\"watchdog_version\":\"1.0.14\""
                    + ",\"detector_version\":\"4\",\"area\":\"watchdog\",\"action\":\"remote-input-observation\""
                    + ",\"result\":\"" + overallState + "\",\"overall_state\":\"" + overallState + "\""
                    + ",\"decision_reason\":\"foreground-app-input-aggregate;origin-unverified\""
                    + ",\"rustdesk_state\":\"" + rustDeskState + "\",\"chrome_state\":\"" + chromeState + "\""
                    + ",\"raw_signals\":{\"inputObservation\":{\"captureScope\":\"foreground-app-only\""
                    + ",\"inputOrigin\":\"unverified\",\"windowSeconds\":" + windowSeconds.ToString(CultureInfo.InvariantCulture)
                    + ",\"keyboardHookReady\":" + keyboardReady.ToString().ToLowerInvariant()
                    + ",\"mouseHookReady\":" + mouseReady.ToString().ToLowerInvariant()
                    + ",\"keyboardHookError\":" + keyboardError.ToString(CultureInfo.InvariantCulture)
                    + ",\"mouseHookError\":" + mouseError.ToString(CultureInfo.InvariantCulture)
                    + ",\"keyboardInjected\":" + keyInjected.ToString(CultureInfo.InvariantCulture)
                    + ",\"keyboardNonInjected\":" + keyNonInjected.ToString(CultureInfo.InvariantCulture)
                    + ",\"keyboardInjectedLast5Seconds\":" + keyInjectedRecent.ToString(CultureInfo.InvariantCulture)
                    + ",\"keyboardNonInjectedLast5Seconds\":" + keyNonInjectedRecent.ToString(CultureInfo.InvariantCulture)
                    + ",\"mouseInjected\":" + mouseInjected.ToString(CultureInfo.InvariantCulture)
                    + ",\"mouseNonInjected\":" + mouseNonInjected.ToString(CultureInfo.InvariantCulture)
                    + ",\"mouseInjectedLast5Seconds\":" + mouseInjectedRecent.ToString(CultureInfo.InvariantCulture)
                    + ",\"mouseNonInjectedLast5Seconds\":" + mouseNonInjectedRecent.ToString(CultureInfo.InvariantCulture)
                    + ",\"lowerIntegrityInjected\":" + lowerIntegrity.ToString(CultureInfo.InvariantCulture)
                    + ",\"windowStartedAt\":\"" + windowStartedAt + "\""
                    + ",\"lastKeyboardAgeMs\":" + AgeMillisecondsJson(observedAt.Ticks, lastKeyTicks)
                    + ",\"lastInjectedKeyboardAgeMs\":" + AgeMillisecondsJson(observedAt.Ticks, lastInjectedKeyTicks)
                    + ",\"lastNonInjectedKeyboardAgeMs\":" + AgeMillisecondsJson(observedAt.Ticks, lastNonInjectedKeyTicks)
                    + ",\"lastMouseAgeMs\":" + AgeMillisecondsJson(observedAt.Ticks, lastMouseTicks)
                    + ",\"lastInjectedMouseAgeMs\":" + AgeMillisecondsJson(observedAt.Ticks, lastInjectedMouseTicks)
                    + ",\"lastNonInjectedMouseAgeMs\":" + AgeMillisecondsJson(observedAt.Ticks, lastNonInjectedMouseTicks)
                    + ",\"remoteSessionSignalAgeSeconds\":" + (remoteStateAgeSeconds < 0 ? "null" : remoteStateAgeSeconds.ToString(CultureInfo.InvariantCulture))
                    + "}}}" + Environment.NewLine;
                File.AppendAllText(Path.Combine(runtimeDirectory, "remote-session-observations.jsonl"), eventJson, new UTF8Encoding(false));
            }
            catch { }
        }

        private static bool IsKnownRemoteState(string state)
        {
            return state == "active" || state == "clear" || state == "unknown";
        }
    }

    internal static class Program
    {
        private const string MutexName = "Local\\OsooHandleAppWatchdog-1.0";
        private const string DiagnosticMonitorMutexName = "Local\\OsooHandleAppWatchdogDiagnostic-1.0";
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
        private static string lastRemoteStateKey;
        private static DateTime lastRemoteStateLogAt = DateTime.MinValue;
        private static bool chromotingCursorInitialized;
        private static int lastChromotingRecordIndex = -1;
        private static string lastChromotingEventState = "unknown";
        private static DateTime lastChromotingConnectedAt = DateTime.MinValue;
        private static DateTime lastChromotingEventAt = DateTime.MinValue;
        private static long lastChromotingEventId;
        private static long lastChromotingChannelEventId;
        private static DateTime lastChromotingChannelEventAt = DateTime.MinValue;
        private static readonly HashSet<string> lastChromotingTransports = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        private static int chromeHostProcessCount = -1;
        private static int chromeDesktopProcessCount = -1;
        private static int chromeAssistanceHostProcessCount = -1;
        private static int chromeNativeHostProcessCount = -1;
        private static bool chromotingEventSourceAvailable;
        private static bool chromotingEventLogReadable;
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
            string mutexName = options.MonitorOnly ? DiagnosticMonitorMutexName : MutexName;
            using (var mutex = new Mutex(true, mutexName, out createdNew))
            {
                if (!createdNew)
                {
                    Log("duplicate-instance", "ignored", null);
                    return 2;
                }

                Log("watchdog-start", "ok", "version=1.0.14; mode=" + (options.MonitorOnly ? "diagnostic-only" : "supervisor")
                    + "; dryRun=" + options.DryRun.ToString(CultureInfo.InvariantCulture));
                if (!options.Once) RemoteInputMonitor.Start(runtimeDirectory);
                do
                {
                    try
                    {
                        if (options.MonitorOnly) RefreshRemoteSessionState();
                        else CheckOnce();
                    }
                    catch (Exception ex) { Log(options.MonitorOnly ? "diagnostic-monitor" : "watchdog-check", "failed", ex.GetType().Name + ": " + ex.Message); }
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
            RefreshRemoteSessionState();

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

        private static void RefreshRemoteSessionState()
        {
            string rustDeskState;
            string rustDeskEvidence;
            int rustDeskProcessCount;
            bool rustDeskWindowDetected;
            DetectRustDeskSession(out rustDeskState, out rustDeskEvidence, out rustDeskProcessCount, out rustDeskWindowDetected);

            string chromeState;
            string chromeEvidence;
            DetectChromeRemoteDesktopSession(out chromeState, out chromeEvidence);

            bool detected = rustDeskState == "active" || chromeState == "active";
            bool unknown = !detected && (rustDeskState == "unknown" || chromeState == "unknown");
            string state = detected ? "active" : unknown ? "unknown" : "clear";
            string sessionType = rustDeskState == "active" && chromeState == "active"
                ? "multiple"
                : rustDeskState == "active" ? "RustDesk"
                : chromeState == "active" ? "Chrome Remote Desktop" : unknown ? "unknown" : "local";
            var observedTools = new List<string>();
            if (rustDeskState == "active") observedTools.Add("RustDesk");
            if (chromeState == "active") observedTools.Add("Chrome Remote Desktop");
            var evidence = new List<string>();
            if (!String.IsNullOrEmpty(rustDeskEvidence)) evidence.Add("rustdesk:" + rustDeskEvidence);
            if (!String.IsNullOrEmpty(chromeEvidence)) evidence.Add("chrome-remote-desktop:" + chromeEvidence);
            DateTime checkedAt = DateTime.UtcNow;
            string evidenceText = String.Join("; ", evidence.ToArray());
            string json = "{\n"
                + "  \"version\": \"1.0.14\",\n"
                + "  \"checkedAt\": " + JsonString(checkedAt.ToString("o")) + ",\n"
                + "  \"state\": " + JsonString(state) + ",\n"
                + "  \"sessionType\": " + JsonString(sessionType) + ",\n"
                + "  \"evidence\": " + JsonString(evidenceText) + ",\n"
                + "  \"observedTools\": [" + String.Join(", ", observedTools.ConvertAll(JsonString).ToArray()) + "],\n"
                + "  \"sources\": {\"rustDesk\": " + JsonString(rustDeskState)
                + ", \"chromeRemoteDesktop\": " + JsonString(chromeState) + "}\n} \n";
            AtomicWrite(Path.Combine(runtimeDirectory, "remote-session-state.json"), json);

            string stateKey = state + "|" + sessionType + "|" + rustDeskState + "|" + chromeState + "|" + evidenceText
                + "|rustdesk-processes=" + rustDeskProcessCount.ToString(CultureInfo.InvariantCulture)
                + "|rustdesk-window=" + rustDeskWindowDetected.ToString(CultureInfo.InvariantCulture)
                + "|chrome-host=" + chromeHostProcessCount.ToString(CultureInfo.InvariantCulture)
                + "|chrome-desktop=" + chromeDesktopProcessCount.ToString(CultureInfo.InvariantCulture)
                + "|chrome-assist=" + chromeAssistanceHostProcessCount.ToString(CultureInfo.InvariantCulture)
                + "|chrome-native=" + chromeNativeHostProcessCount.ToString(CultureInfo.InvariantCulture)
                + "|chrome-event=" + lastChromotingEventId.ToString(CultureInfo.InvariantCulture)
                + "|chrome-transport=" + GetChromotingTransportsSummary()
                + "|chrome-source=" + chromotingEventSourceAvailable.ToString(CultureInfo.InvariantCulture)
                + "|chrome-log=" + chromotingEventLogReadable.ToString(CultureInfo.InvariantCulture);
            if (stateKey != lastRemoteStateKey || checkedAt - lastRemoteStateLogAt >= TimeSpan.FromMinutes(5))
            {
                lastRemoteStateKey = stateKey;
                lastRemoteStateLogAt = checkedAt;
                WriteRemoteObservation(checkedAt, state, rustDeskState, rustDeskEvidence, rustDeskProcessCount,
                    rustDeskWindowDetected, chromeState, chromeEvidence);
                Log("remote-session-detection", state, "sessionType=" + sessionType
                    + "; rustDesk=" + rustDeskState
                    + "; chromeRemoteDesktop=" + chromeState
                    + "; evidence=" + evidenceText);
            }
        }

        private static void WriteRemoteObservation(DateTime checkedAt, string overallState,
            string rustDeskState, string rustDeskEvidence, int rustDeskProcessCount, bool rustDeskWindowDetected,
            string chromeState, string chromeEvidence)
        {
            try
            {
                string observedAt = checkedAt.ToString("o");
                string chromeEventAt = lastChromotingEventAt == DateTime.MinValue
                    ? null : lastChromotingEventAt.ToString("o");
                long chromeAgeSeconds = lastChromotingEventAt == DateTime.MinValue
                    ? -1 : Math.Max(0, (long)(checkedAt - lastChromotingEventAt).TotalSeconds);
                string chromeChannelEventAt = lastChromotingChannelEventAt == DateTime.MinValue
                    ? null : lastChromotingChannelEventAt.ToString("o");
                long chromeChannelAgeSeconds = lastChromotingChannelEventAt == DateTime.MinValue
                    ? -1 : Math.Max(0, (long)(checkedAt - lastChromotingChannelEventAt).TotalSeconds);
                string chromeEventState = lastChromotingEventState;
                string rustDeskInterpretation = rustDeskWindowDetected
                    ? "session-window-visible-direction-unverified"
                    : rustDeskProcessCount > 0 ? "process-present-no-session-window" : "no-process";
                string decisionReason = overallState == "active"
                    ? "one-or-more-source-active" : overallState == "unknown"
                        ? "no-active-source-and-one-or-more-source-unknown" : "all-sources-clear";
                string rawSignals = "{\"checkedAt\":" + JsonString(observedAt)
                    + ",\"rustDesk\":{\"state\":" + JsonString(rustDeskState)
                    + ",\"evidence\":" + JsonString(rustDeskEvidence)
                    + ",\"processCount\":" + rustDeskProcessCount.ToString(CultureInfo.InvariantCulture)
                    + ",\"visibleSessionWindow\":" + rustDeskWindowDetected.ToString().ToLowerInvariant()
                    + ",\"interpretation\":" + JsonString(rustDeskInterpretation) + "}"
                    + ",\"chromeRemoteDesktop\":{\"state\":" + JsonString(chromeState)
                    + ",\"evidence\":" + JsonString(chromeEvidence)
                    + ",\"eventSourceAvailable\":" + chromotingEventSourceAvailable.ToString().ToLowerInvariant()
                    + ",\"eventLogReadable\":" + chromotingEventLogReadable.ToString().ToLowerInvariant()
                    + ",\"hostProcessCount\":" + chromeHostProcessCount.ToString(CultureInfo.InvariantCulture)
                    + ",\"desktopProcessCount\":" + chromeDesktopProcessCount.ToString(CultureInfo.InvariantCulture)
                    + ",\"assistanceHostProcessCount\":" + chromeAssistanceHostProcessCount.ToString(CultureInfo.InvariantCulture)
                    + ",\"nativeHostProcessCount\":" + chromeNativeHostProcessCount.ToString(CultureInfo.InvariantCulture)
                    + ",\"eventState\":" + JsonString(chromeEventState)
                    + ",\"eventId\":" + lastChromotingEventId.ToString(CultureInfo.InvariantCulture)
                    + ",\"eventAt\":" + JsonString(chromeEventAt)
                    + ",\"signalAgeSeconds\":" + (chromeAgeSeconds < 0 ? "null" : chromeAgeSeconds.ToString(CultureInfo.InvariantCulture))
                    + ",\"channelEventId\":" + lastChromotingChannelEventId.ToString(CultureInfo.InvariantCulture)
                    + ",\"channelEventAt\":" + JsonString(chromeChannelEventAt)
                    + ",\"channelAgeSeconds\":" + (chromeChannelAgeSeconds < 0 ? "null" : chromeChannelAgeSeconds.ToString(CultureInfo.InvariantCulture))
                    + ",\"transports\":" + GetChromotingTransportsJson() + "}}";
                string eventJson = "{\"observation_id\":" + JsonString(Guid.NewGuid().ToString("N"))
                    + ",\"createdAt\":" + JsonString(observedAt)
                    + ",\"version\":\"1.0.14\",\"watchdog_version\":\"1.0.14\",\"detector_version\":\"4\",\"area\":\"watchdog\",\"action\":\"remote-session-detection\""
                    + ",\"result\":" + JsonString(overallState)
                    + ",\"overall_state\":" + JsonString(overallState)
                    + ",\"decision_reason\":" + JsonString(decisionReason)
                    + ",\"rustdesk_state\":" + JsonString(rustDeskState)
                    + ",\"rustdesk_evidence\":" + JsonString(rustDeskEvidence)
                    + ",\"rustdesk_signal_at\":" + JsonString(rustDeskWindowDetected ? observedAt : null)
                    + ",\"rustdesk_process_count\":" + rustDeskProcessCount.ToString(CultureInfo.InvariantCulture)
                    + ",\"rustdesk_window_detected\":" + rustDeskWindowDetected.ToString().ToLowerInvariant()
                    + ",\"chrome_state\":" + JsonString(chromeState)
                    + ",\"chrome_evidence\":" + JsonString(chromeEvidence)
                    + ",\"chrome_event_state\":" + JsonString(chromeEventState)
                    + ",\"chrome_event_id\":" + lastChromotingEventId.ToString(CultureInfo.InvariantCulture)
                    + ",\"chrome_event_at\":" + JsonString(chromeEventAt)
                    + ",\"chrome_signal_age_seconds\":" + (chromeAgeSeconds < 0 ? "null" : chromeAgeSeconds.ToString(CultureInfo.InvariantCulture))
                    + ",\"raw_signals\":" + rawSignals + "}" + Environment.NewLine;
                File.AppendAllText(Path.Combine(runtimeDirectory, "remote-session-observations.jsonl"), eventJson, new UTF8Encoding(false));
            }
            catch (Exception ex)
            {
                Log("remote-session-observation-write", "failed", ex.GetType().Name);
            }
        }

        private static void DetectRustDeskSession(out string state, out string evidence, out int processCount, out bool windowDetected)
        {
            state = "clear";
            evidence = "no-active-session-window";
            processCount = 0;
            windowDetected = false;
            Process[] processes;
            try { processes = Process.GetProcessesByName("rustdesk"); }
            catch (Exception ex)
            {
                state = "unknown";
                evidence = "process-query-failed-" + ex.GetType().Name;
                return;
            }
            if (processes == null || processes.Length == 0) return;

            var processIds = new HashSet<int>();
            foreach (Process process in processes)
            {
                try { if (!process.HasExited) processIds.Add(process.Id); }
                catch { }
                finally { process.Dispose(); }
            }
            if (processIds.Count == 0) return;
            processCount = processIds.Count;

            bool queryFailed = false;
            bool activeSessionWindow = false;
            bool enumerationCompleted = EnumWindows(delegate(IntPtr window, IntPtr statePointer)
            {
                try
                {
                    if (!IsWindowVisible(window)) return true;
                    uint processId;
                    GetWindowThreadProcessId(window, out processId);
                    if (!processIds.Contains((int)processId)) return true;
                    var title = new StringBuilder(512);
                    GetWindowText(window, title, title.Capacity);
                    string windowTitle = title.ToString().Trim();
                    const string sessionTitleSuffix = " - RustDesk";
                    if (windowTitle.Length > sessionTitleSuffix.Length
                        && windowTitle.EndsWith(sessionTitleSuffix, StringComparison.OrdinalIgnoreCase))
                    {
                        activeSessionWindow = true;
                        return false;
                    }
                }
                catch { queryFailed = true; }
                return true;
            }, IntPtr.Zero);
            if (!enumerationCompleted && !activeSessionWindow) queryFailed = true;

            if (activeSessionWindow)
            {
                windowDetected = true;
                state = "active";
                evidence = "visible-remote-session-window";
            }
            else if (queryFailed)
            {
                state = "unknown";
                evidence = "window-enumeration-incomplete";
            }
        }

        private static void DetectChromeRemoteDesktopSession(out string state, out string evidence)
        {
            chromeHostProcessCount = CountProcessesByName("remoting_host");
            chromeDesktopProcessCount = CountProcessesByName("remoting_desktop");
            chromeAssistanceHostProcessCount = CountProcessesByName("remote_assistance_host");
            chromeNativeHostProcessCount = CountProcessesByName("remoting_native_messaging_host");
            chromotingEventSourceAvailable = false;
            chromotingEventLogReadable = false;
            state = "clear";
            evidence = "no-connected-client-event";
            const string sourceRegistryPath = @"SYSTEM\CurrentControlSet\Services\EventLog\Application\chromoting";
            try
            {
                using (RegistryKey sourceKey = Registry.LocalMachine.OpenSubKey(sourceRegistryPath))
                {
                    if (sourceKey == null)
                    {
                        evidence = "event-source-not-installed";
                        return;
                    }
                }
                chromotingEventSourceAvailable = true;

                using (var applicationLog = new EventLog("Application"))
                {
                    EventLogEntryCollection entries = applicationLog.Entries;
                    chromotingEventLogReadable = true;
                    int newestRecordIndex = entries.Count > 0 ? entries[entries.Count - 1].Index : -1;
                    bool rebuildCursor = !chromotingCursorInitialized || newestRecordIndex < lastChromotingRecordIndex;
                    if (rebuildCursor)
                    {
                        lastChromotingTransports.Clear();
                        int start = Math.Max(0, entries.Count - 1000);
                        bool foundSessionEvent = false;
                        var observedTransports = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                        for (int index = entries.Count - 1; index >= start; index--)
                        {
                            EventLogEntry entry = entries[index];
                            if (!String.Equals(entry.Source, "chromoting", StringComparison.OrdinalIgnoreCase)) continue;
                            long eventId = GetChromotingEventId(entry);
                            if (!foundSessionEvent && eventId == 4)
                            {
                                lastChromotingChannelEventId = eventId;
                                lastChromotingChannelEventAt = entry.TimeGenerated.ToUniversalTime();
                                string transport = GetChromotingTransport(entry);
                                observedTransports.Add(transport);
                                if (transport == "relay" || transport == "stun") lastChromotingTransports.Add(transport);
                            }
                            if (!foundSessionEvent && (eventId == 1 || eventId == 2))
                            {
                                lastChromotingEventId = eventId;
                                ApplyChromotingEvent(eventId, entry.TimeGenerated.ToUniversalTime());
                                foundSessionEvent = true;
                                if (eventId == 2) lastChromotingTransports.Clear();
                            }
                            if (foundSessionEvent) break;
                        }
                        chromotingCursorInitialized = true;
                    }
                    else if (newestRecordIndex > lastChromotingRecordIndex)
                    {
                        bool foundSessionEvent = false;
                        var observedTransports = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                        for (int index = entries.Count - 1; index >= 0; index--)
                        {
                            EventLogEntry entry = entries[index];
                            if (entry.Index <= lastChromotingRecordIndex) break;
                            if (!String.Equals(entry.Source, "chromoting", StringComparison.OrdinalIgnoreCase)) continue;
                            long eventId = GetChromotingEventId(entry);
                            if (!foundSessionEvent && eventId == 4)
                            {
                                lastChromotingChannelEventId = eventId;
                                lastChromotingChannelEventAt = entry.TimeGenerated.ToUniversalTime();
                                string transport = GetChromotingTransport(entry);
                                observedTransports.Add(transport);
                                if (transport == "relay" || transport == "stun") lastChromotingTransports.Add(transport);
                            }
                            if (!foundSessionEvent && (eventId == 1 || eventId == 2))
                            {
                                lastChromotingEventId = eventId;
                                ApplyChromotingEvent(eventId, entry.TimeGenerated.ToUniversalTime());
                                foundSessionEvent = true;
                                if (eventId == 1)
                                {
                                    lastChromotingTransports.Clear();
                                    foreach (string transport in observedTransports)
                                    {
                                        if (transport == "relay" || transport == "stun") lastChromotingTransports.Add(transport);
                                    }
                                }
                                else lastChromotingTransports.Clear();
                            }
                            if (foundSessionEvent) break;
                        }
                    }
                    else if (lastChromotingEventState == "disconnected") lastChromotingTransports.Clear();
                    lastChromotingRecordIndex = newestRecordIndex;

                    if (lastChromotingEventState == "connected")
                    {
                        if (DateTime.UtcNow - lastChromotingConnectedAt > TimeSpan.FromHours(24))
                        {
                            state = "unknown";
                            evidence = "connected-event-older-than-24h";
                        }
                        else
                        {
                            state = "active";
                            evidence = "client-connected-event";
                        }
                    }
                    else if (lastChromotingEventState == "disconnected")
                    {
                        state = "clear";
                        evidence = "client-disconnected-event";
                    }
                    else
                    {
                        state = "unknown";
                        evidence = "no-session-event-in-recent-history";
                    }
                }
            }
            catch (Exception ex)
            {
                state = "unknown";
                evidence = "event-log-query-failed-" + ex.GetType().Name;
            }
        }

        private static int CountProcessesByName(string processName)
        {
            try
            {
                Process[] processes = Process.GetProcessesByName(processName);
                int count = processes == null ? 0 : processes.Length;
                if (processes != null)
                {
                    foreach (Process process in processes) process.Dispose();
                }
                return count;
            }
            catch { return -1; }
        }

        private static string GetChromotingTransport(EventLogEntry entry)
        {
            try
            {
                string message = entry.Message ?? String.Empty;
                if (message.IndexOf("connection='relay'", StringComparison.OrdinalIgnoreCase) >= 0) return "relay";
                if (message.IndexOf("connection='stun'", StringComparison.OrdinalIgnoreCase) >= 0) return "stun";
            }
            catch { }
            return "other-or-unparsed";
        }

        private static List<string> GetChromotingTransports()
        {
            var transports = new List<string>(lastChromotingTransports);
            transports.Sort(StringComparer.OrdinalIgnoreCase);
            return transports;
        }

        private static string GetChromotingTransportsSummary()
        {
            return String.Join("+", GetChromotingTransports().ToArray());
        }

        private static string GetChromotingTransportsJson()
        {
            return "[" + String.Join(",", GetChromotingTransports().ConvertAll(JsonString).ToArray()) + "]";
        }

        private static long GetChromotingEventId(EventLogEntry entry)
        {
            // InstanceId includes severity/facility bits (for example 0x40000001
            // for displayed EventID 1). The low 16 bits are the Windows event ID.
            return entry == null ? -1 : entry.InstanceId & 0xFFFF;
        }

        private static void ApplyChromotingEvent(long eventId, DateTime eventAt)
        {
            lastChromotingEventAt = eventAt;
            if (eventId == 1)
            {
                lastChromotingEventState = "connected";
                lastChromotingConnectedAt = eventAt;
            }
            else if (eventId == 2)
            {
                lastChromotingEventState = "disconnected";
                lastChromotingConnectedAt = DateTime.MinValue;
            }
        }

        private delegate bool EnumWindowsCallback(IntPtr window, IntPtr state);

        [DllImport("user32.dll")]
        private static extern bool EnumWindows(EnumWindowsCallback callback, IntPtr state);

        [DllImport("user32.dll")]
        private static extern bool IsWindowVisible(IntPtr window);

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        private static extern int GetWindowText(IntPtr window, StringBuilder text, int maxCount);

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        private static extern int GetWindowThreadProcessId(IntPtr window, out uint processId);

        private static void WriteStatus(string state, string appPath, string reason)
        {
            DateTime now = DateTime.UtcNow;
            string statusKey = (state ?? "") + "|" + (appPath ?? "") + "|" + (reason ?? "");
            if (statusKey == lastStatusKey && now - lastStatusAt < TimeSpan.FromMinutes(1)) return;
            lastStatusKey = statusKey;
            lastStatusAt = now;
            string json = "{\n  \"version\": \"1.0.14\",\n  \"checkedAt\": \"" + now.ToString("o") + "\",\n  \"state\": \"" + Escape(state) + "\",\n  \"appPath\": " + JsonString(appPath) + ",\n  \"maintenanceReason\": " + JsonString(reason) + "\n}";
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
                string eventJson = "{\"createdAt\":\"" + createdAt + "\",\"version\":\"1.0.14\",\"action\":\"" + Escape(action) + "\",\"result\":\"" + Escape(result) + "\",\"details\":" + JsonString(details) + "}" + Environment.NewLine;
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
            if (File.Exists(path))
            {
                try
                {
                    File.Replace(temporary, path, null);
                    return;
                }
                catch { TryDelete(path); }
            }
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
                else if (arg == "--monitor-only") parsed.MonitorOnly = true;
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
