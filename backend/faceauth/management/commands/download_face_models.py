"""Downloads and verifies the pinned OpenCV Zoo model files this project
uses for the `opencv_sface` FaceRecognitionEngine. Never invoked during an
active request — this is a deploy/setup-time step, matching the existing
`warm_up_face_models` command's "never during a request" rule.

Model provenance (recorded here, not just in code, so it survives a
`git blame` of this file):

- YuNet (face detection): https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet
  File: face_detection_yunet_2026may.onnx (the dynamic-input-shape build
  OpenCV Zoo's own README documents as "the default model" for OpenCV 5.x
  compatibility — this project's installed opencv-python is 5.0.0).
  Licence: MIT (Shiqi Yu).
- SFace (alignment/embedding/matching): https://github.com/opencv/opencv_zoo/tree/main/models/face_recognition_sface
  File: face_recognition_sface_2021dec.onnx.
  Licence: Apache 2.0.

Both checksums below were computed from a real download performed and
verified during this change — not invented.
"""

import hashlib
import urllib.request

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

MODELS = {
    'yunet': {
        'url': (
            'https://github.com/opencv/opencv_zoo/raw/main/models/'
            'face_detection_yunet/face_detection_yunet_2026may.onnx'
        ),
        'sha256': 'ebafce4e3c118d6554634be5c27ab333b4c047a9a8c3faf1d7cf93101c22f0f0',
        'dest_attr': 'FACE_YUNET_MODEL_PATH',
        'label': 'YuNet face detector (2026may)',
    },
    'sface': {
        'url': (
            'https://github.com/opencv/opencv_zoo/raw/main/models/'
            'face_recognition_sface/face_recognition_sface_2021dec.onnx'
        ),
        'sha256': '0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79',
        'dest_attr': 'FACE_SFACE_MODEL_PATH',
        'label': 'SFace face recognizer (2021dec)',
    },
}


def _sha256(path):
    digest = hashlib.sha256()
    with open(path, 'rb') as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


class Command(BaseCommand):
    help = (
        'Downloads and SHA-256-verifies the pinned YuNet and SFace ONNX model '
        'files used by FACE_RECOGNITION_ENGINE=opencv_sface, from the official '
        'opencv/opencv_zoo repository only. Refuses to keep a file whose '
        'checksum does not match the pinned value. Never run during an active '
        'enrollment request — this is a one-time setup/deploy step, same as '
        '`warm_up_face_models`.'
    )

    def add_arguments(self, parser):
        parser.add_argument(
            '--engine',
            default='opencv_sface',
            choices=['opencv_sface'],
            help='Present for symmetry with FACE_RECOGNITION_ENGINE; only opencv_sface currently has models to fetch.',
        )
        parser.add_argument(
            '--force', action='store_true', help='Re-download even if a correctly-checksummed file already exists.'
        )

    def handle(self, *args, **options):
        settings.FACE_OPENCV_MODEL_DIR.mkdir(parents=True, exist_ok=True)
        failed = []

        for key, spec in MODELS.items():
            dest = getattr(settings, spec['dest_attr'])
            self.stdout.write(f"{spec['label']}...")

            if dest.exists() and not options['force']:
                existing_hash = _sha256(dest)
                if existing_hash == spec['sha256']:
                    self.stdout.write(self.style.SUCCESS(f'  already present and checksum-verified: {dest}'))
                    continue
                self.stdout.write(self.style.WARNING('  existing file checksum mismatch — re-downloading'))

            tmp_dest = dest.with_suffix(dest.suffix + '.download')
            try:
                urllib.request.urlretrieve(spec['url'], tmp_dest)  # noqa: S310 - fixed, pinned https URL only
            except Exception as exc:  # noqa: BLE001 - reported below, never a raw traceback to the operator's log alone
                tmp_dest.unlink(missing_ok=True)
                failed.append(key)
                self.stdout.write(self.style.ERROR(f'  download failed: {type(exc).__name__}'))
                continue

            actual_hash = _sha256(tmp_dest)
            if actual_hash != spec['sha256']:
                tmp_dest.unlink(missing_ok=True)
                failed.append(key)
                self.stdout.write(
                    self.style.ERROR(
                        f'  checksum mismatch (expected {spec["sha256"][:12]}..., got {actual_hash[:12]}...) '
                        '— refusing to keep this file. The download may be corrupt, or upstream may have '
                        'changed the pinned file; do not proceed without investigating.'
                    )
                )
                continue

            tmp_dest.replace(dest)
            self.stdout.write(self.style.SUCCESS(f'  downloaded and checksum-verified: {dest}'))

        if failed:
            raise CommandError(
                f'{len(failed)} model(s) failed to download/verify: {", ".join(failed)}. '
                'FACE_RECOGNITION_ENGINE=opencv_sface will report MODEL_UNAVAILABLE until this is fixed.'
            )
        self.stdout.write(self.style.SUCCESS('All OpenCV face models downloaded and verified.'))
