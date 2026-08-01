import { useCallback, useEffect, useRef, useState } from 'react';

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
        video: { facingMode: 'user' },
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
      canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.92);
    });
  }, []);

  useEffect(() => stop, [stop]);

  return { videoRef, status, errorMessage, start, stop, captureFrame };
}
