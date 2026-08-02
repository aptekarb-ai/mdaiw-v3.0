import { useCallback, useEffect, useRef, useState } from 'react';
import { getFaceReadiness } from '../api/faceauth';
import type { FaceReadinessStatus } from '../types/faceauth';

const POLL_INTERVAL_MS = 2000;
// ~2 minutes of polling before giving up and showing a safe retry state —
// never leaves the UI stuck indefinitely waiting on a server that never
// becomes ready (see section G of the processing-timeout fix).
const MAX_POLL_ATTEMPTS = 60;

/**
 * Polls GET /api/v1/auth/face/readiness/ before the caller opens the
 * camera for Face Enrollment/Face Recognition login. Stops polling once
 * READY (or once UNAVAILABLE is given up on) — `retry()` restarts it.
 */
export function useFaceReadiness() {
  const [status, setStatus] = useState<FaceReadinessStatus>('LOADING');
  const attemptsRef = useRef(0);
  const cancelledRef = useRef(false);
  const intervalRef = useRef<number | null>(null);

  const stopPolling = useCallback(() => {
    if (intervalRef.current !== null) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const check = useCallback(async () => {
    try {
      const response = await getFaceReadiness();
      if (cancelledRef.current) return;
      setStatus(response.status);
      if (response.status === 'READY') {
        stopPolling();
      }
    } catch {
      // A network-level failure to even reach the readiness endpoint is
      // treated the same as UNAVAILABLE — there is nothing actionable to
      // do differently from the user's point of view.
      if (!cancelledRef.current) {
        setStatus('UNAVAILABLE');
      }
    }
  }, [stopPolling]);

  const startPolling = useCallback(() => {
    stopPolling();
    attemptsRef.current = 0;
    void check();
    intervalRef.current = window.setInterval(() => {
      attemptsRef.current += 1;
      if (attemptsRef.current > MAX_POLL_ATTEMPTS) {
        stopPolling();
        setStatus((current) => (current === 'READY' ? current : 'UNAVAILABLE'));
        return;
      }
      void check();
    }, POLL_INTERVAL_MS);
  }, [check, stopPolling]);

  useEffect(() => {
    cancelledRef.current = false;
    startPolling();
    return () => {
      cancelledRef.current = true;
      stopPolling();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const retry = useCallback(() => {
    setStatus('LOADING');
    startPolling();
  }, [startPolling]);

  return { status, retry };
}
