import type { RefObject } from 'react';
import type { CameraStatus } from '../hooks/useCamera';
import { FaceFrameOverlay } from './FaceFrameOverlay';
import './FaceRecognition.css';

interface CameraPreviewProps {
  videoRef: RefObject<HTMLVideoElement | null>;
  status: CameraStatus;
  showFrameOverlay?: boolean;
}

export function CameraPreview({ videoRef, status, showFrameOverlay = true }: CameraPreviewProps) {
  const isReady = status === 'ready';

  return (
    <div className="camera-preview">
      {!isReady && (
        <div className="camera-preview__placeholder">
          <span className="mdaiw-icon mdaiw-icon--camera" aria-hidden="true" />
          <span>{status === 'requesting' ? 'Requesting camera access...' : 'Camera preview'}</span>
        </div>
      )}
      <video ref={videoRef} autoPlay muted playsInline style={{ display: isReady ? 'block' : 'none' }} />
      {isReady && showFrameOverlay && <FaceFrameOverlay />}
    </div>
  );
}
