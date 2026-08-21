import './FaceRecognition.css';

export function FaceFrameOverlay() {
  return (
    <div className="camera-preview__overlay">
      <img src="/assets/mdaiw/images/face-scan-frame.svg" alt="" aria-hidden="true" />
    </div>
  );
}
