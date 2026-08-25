'use strict';

const HARD_FAILURE_REASONS = new Set([
  'server-process-missing',
  'server-token-missing',
  'unexpected-server',
  'instance-token-mismatch',
  'invalid-ping-response',
  'status-401',
  'status-403',
]);

function createServerRecoveryPolicy({
  transientGraceMs = 60_000,
  startupGraceMs = 120_000,
} = {}) {
  let degradedSince = null;
  let degradedReason = null;

  const reset = () => {
    degradedSince = null;
    degradedReason = null;
  };

  const evaluate = ({
    health,
    processAlive,
    serverAgeMs,
    recoveryInProgress,
    restartScheduled,
    nowMs = Date.now(),
  }) => {
    const normalizedHealth = health && typeof health === 'object'
      ? health
      : { healthy: false, reason: 'unknown-health' };
    const reason = String(normalizedHealth.reason || 'unknown-health');

    if (normalizedHealth.healthy) {
      const degradedElapsedMs = degradedSince === null ? 0 : Math.max(0, nowMs - degradedSince);
      const previousReason = degradedReason;
      reset();
      return {
        decision: 'healthy',
        priority: 'ready',
        reason,
        degradedElapsedMs,
        previousReason,
      };
    }

    if (recoveryInProgress || restartScheduled) {
      return {
        decision: 'defer-recovery-in-progress',
        priority: 'recovery',
        reason,
      };
    }

    if (!processAlive || HARD_FAILURE_REASONS.has(reason)) {
      reset();
      return {
        decision: 'recover-hard-failure',
        priority: 'process-or-identity-failure',
        reason,
      };
    }

    const normalizedServerAgeMs = Number.isFinite(serverAgeMs) ? Math.max(0, serverAgeMs) : Number.POSITIVE_INFINITY;
    if (normalizedServerAgeMs < startupGraceMs) {
      return {
        decision: 'defer-startup',
        priority: 'server-startup',
        reason,
        remainingMs: startupGraceMs - normalizedServerAgeMs,
      };
    }

    if (degradedSince === null) {
      degradedSince = nowMs;
      degradedReason = reason;
    }
    const degradedElapsedMs = Math.max(0, nowMs - degradedSince);
    if (degradedElapsedMs < transientGraceMs) {
      return {
        decision: 'defer-transient-delay',
        priority: 'live-process-delay',
        reason,
        degradedElapsedMs,
        remainingMs: transientGraceMs - degradedElapsedMs,
      };
    }

    reset();
    return {
      decision: 'recover-sustained-failure',
      priority: 'sustained-unresponsive-server',
      reason,
      degradedElapsedMs,
    };
  };

  return { evaluate, reset };
}

module.exports = {
  HARD_FAILURE_REASONS,
  createServerRecoveryPolicy,
};
