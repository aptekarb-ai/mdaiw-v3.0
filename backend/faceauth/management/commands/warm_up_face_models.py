import time

from django.core.management.base import BaseCommand, CommandError

from faceauth.service import warm_up_models


class Command(BaseCommand):
    help = (
        'Pre-loads the configured Face Recognition detector, recognition, and '
        'anti-spoofing models into memory so the first real Face Enrollment or '
        'Face Recognition login request is not slowed by cold model loading. '
        'Processes no images and stores no biometric data — safe to run at '
        'deployment/startup time. Idempotent: running it again in the same '
        'process is a cheap no-op, since DeepFace caches loaded models. Each '
        'model loads independently and is reported separately, so one missing '
        'optional dependency does not hide whether the other models are ready.'
    )

    def handle(self, *args, **options):
        self.stdout.write('Loading Face Recognition models (detector, recognition, anti-spoofing)...')
        start = time.perf_counter()
        results = warm_up_models()
        total_elapsed = time.perf_counter() - start

        failed = []
        for key, outcome in results.items():
            ok, detail = outcome
            if ok:
                self.stdout.write(self.style.SUCCESS(f'  {key}: loaded in {detail:.2f}s'))
            else:
                failed.append(key)
                self.stdout.write(self.style.ERROR(f'  {key}: FAILED — {detail}'))

        self.stdout.write(f'Total: {total_elapsed:.2f}s')
        if failed:
            raise CommandError(
                f'{len(failed)} of {len(results)} model(s) failed to load: {", ".join(failed)}. '
                'Face Enrollment and Face Recognition login will fail for any request that '
                'needs a model that did not load — fix the reported error(s) above before deploying.'
            )
        self.stdout.write(self.style.SUCCESS('All Face Recognition models loaded successfully.'))
