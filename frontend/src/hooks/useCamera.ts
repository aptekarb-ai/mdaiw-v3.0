import { useCallback, useEffect, useRef, useState } from 'react';

const QUALITY_SAMPLE_WIDTH = 80;
const QUALITY_SAMPLE_HEIGHT = 60;
const MIN_BRIGHTNESS = 25;
const MAX_BRIGHTNESS = 235;
// Tuned conservatively for a small, cheap, downsampled sample — this only
// needs to reject an obviously covered-lens/out-of-focus frame client-side
// before upload; the backend independently re-runs its own quality check
// (faceauth/service.py::assess_image_quality) on every submitted frame
// regardless, so a client-side false accept is never a security gap, only
// a wasted upload.
const MIN_SHARPNESS = 6;

function computeFrameQuality(video: HTMLVideoElement): { brightness: number; sharpness: number } | null {
  if (video.readyState < 2 || video.videoWidth === 0) {
    return null;
  }
  const canvas = document.createElement('canvas');
  canvas.width = QUALITY_SAMPLE_WIDTH;
  canvas.height = QUALITY_SAMPLE_HEIGHT;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    return null;
  }
  context.drawImage(video, 0, 0, QUALITY_SAMPLE_WIDTH, QUALITY_SAMPLE_HEIGHT);
  const { data } = context.getImageData(0, 0, QUALITY_SAMPLE_WIDTH, QUALITY_SAMPLE_HEIGHT);

  const luma = new Float32Array(QUALITY_SAMPLE_WIDTH * QUALITY_SAMPLE_HEIGHT);
  let sum = 0;
  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    const value = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    luma[p] = value;
    sum += value;
  }
  const brightness = sum / luma.length;

  // Cheap blur proxy: mean absolute horizontal pixel-to-pixel luma
  // gradient. A sharp image has strong transitions; a blurry or blank one
  // does not. Not a true Laplacian variance (that's what the backend uses
  // — see the reference above), but sufficient for this pre-upload check.
  let gradientSum = 0;
  let gradientCount = 0;
  for (let y = 0; y < QUALITY_SAMPLE_HEIGHT; y += 1) {
    for (let x = 1; x < QUALITY_SAMPLE_WIDTH; x += 1) {
      const idx = y * QUALITY_SAMPLE_WIDTH + x;
      gradientSum += Math.abs(luma[idx] - luma[idx - 1]);
      gradientCount += 1;
    }
  }
  const sharpness = gradientCount ? gradientSum / gradientCount : 0;

  return { brightness, sharpness };
}

/**
 * Best-effort, client-side pre-capture quality gate (section D of the
 * processing-timeout fix) — rejects an obviously unusable frame (too dark,
 * too bright, no edge detail at all) before it is ever captured/uploaded,
 * so the backend never wastes a real inference pass on it. A heuristic
 * only: the backend always independently re-validates every uploaded frame
 * regardless of what this returned.
 */
export function isFrameQualityAcceptable(video: HTMLVideoElement): boolean {
  const quality = computeFrameQuality(video);
  if (!quality) {
    return false;
  }
  return quality.brightness >= MIN_BRIGHTNESS && quality.brightness <= MAX_BRIGHTNESS && quality.sharpness >= MIN_SHARPNESS;
}

export type CameraStatus =
  | 'idle'
  | 'requesting'
  | 'ready'
  | 'denied'
  | 'unavailable'
  | 'insecure-context'
  | 'error';

export function useCamera() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<CameraStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setStatus('idle');
  }, []);

  const start = useCallback(async () => {
    if (!window.isSecureContext) {
      setStatus('insecure-context');
      setErrorMessage('Camera access requires a secure (HTTPS or localhost) connection.');
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus('unavailable');
      setErrorMessage('Camera is not supported in this browser.');
      return;
    }

    setStatus('requesting');
    setErrorMessage(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        // 640x480 preserves enough facial detail for the detector/
        // recognition/anti-spoofing models while keeping each captured
        // frame small — a multi-megapixel capture costs real decode/detect
        // time for no accuracy benefit at this range. `ideal` (not `exact`)
        // so a camera that cannot do exactly this resolution still works,
        // just at its closest supported size.
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setStatus('ready');
    } catch (error) {
      if (error instanceof DOMException && error.name === 'NotAllowedError') {
        setStatus('denied');
        setErrorMessage('Camera permission was denied.');
      } else if (error instanceof DOMException && error.name === 'NotFoundError') {
        setStatus('unavailable');
        setErrorMessage('No camera was detected.');
      } else if (error instanceof DOMException && error.name === 'NotReadableError') {
        setStatus('error');
        setErrorMessage('Camera is already in use by another application.');
      } else {
        setStatus('error');
        setErrorMessage('Could not access the camera.');
      }
    }
  }, []);

  const captureFrame = useCallback((): Promise<Blob | null> => {
    return new Promise((resolve) => {
      const video = videoRef.current;
      if (!video || video.readyState < 2 || video.videoWidth === 0) {
        resolve(null);
        return;
      }
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const context = canvas.getContext('2d');
      if (!context) {
        resolve(null);
        return;
      }
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      // 0.85 JPEG quality at the ~640x480 capture resolution above keeps
      // each frame comfortably small (well under FACE_FRAME_MAX_BYTES)
      // without visibly degrading the facial detail the backend models need.
      canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.85);
    });
  }, []);

  useEffect(() => stop, [stop]);

  return { videoRef, status, errorMessage, start, stop, captureFrame };
}
