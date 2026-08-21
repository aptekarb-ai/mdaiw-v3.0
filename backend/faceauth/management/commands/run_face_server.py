from django.conf import settings
from django.core.management import call_command
from django.core.management.base import BaseCommand, CommandError

from faceauth import service


class Command(BaseCommand):
    help = (
        'Warms the configured FACE_RECOGNITION_ENGINE (YuNet+SFace or DeepFace) '
        'and the configured anti-spoofing provider synchronously in THIS '
        'process, then starts the Django development server with the '
        'autoreloader disabled — so the process that actually serves requests '
        'is the same process that warmed the models (a separate one-off warm-up '
        'command does not help the real `runserver` process, since these models '
        'are cached per-process), and so there is no risk of the reloader '
        'spawning a second process that warms independently or serves before '
        'it is ready. Face Enrollment readiness '
        '(GET /api/v1/auth/face/readiness/) is READY before this command ever '
        'starts accepting connections. Processes no images and stores no '
        'biometric data during warm-up.'
    )

    def add_arguments(self, parser):
        parser.add_argument(
            'addrport',
            nargs='?',
            default='127.0.0.1:8000',
            help='Optional [ipaddr:]port to serve on (same as manage.py runserver).',
        )

    def handle(self, *args, **options):
        engine = service.get_engine()
        anti_spoof_provider = service.get_anti_spoof_provider()

        self.stdout.write(f'Warming face recognition engine ({engine.name})...')
        engine.warm_up()
        engine_status = engine.readiness().status
        if engine_status == 'READY':
            self.stdout.write(self.style.SUCCESS(f'  {engine.name}: READY'))
        else:
            self.stdout.write(self.style.ERROR(f'  {engine.name}: {engine_status}'))

        self.stdout.write(f'Warming anti-spoofing provider ({anti_spoof_provider.name})...')
        anti_spoof_provider.warm_up()
        anti_spoof_status = anti_spoof_provider.readiness().status
        if anti_spoof_status == 'READY':
            self.stdout.write(self.style.SUCCESS(f'  {anti_spoof_provider.name}: READY'))
        else:
            self.stdout.write(self.style.ERROR(f'  {anti_spoof_provider.name}: {anti_spoof_status}'))

        if engine_status != 'READY' or anti_spoof_status != 'READY':
            hint = ''
            if engine.name == 'opencv_sface' and engine_status != 'READY':
                hint = (
                    ' Run `python manage.py download_face_models` first if the YuNet/SFace '
                    f'model files are missing from {settings.FACE_OPENCV_MODEL_DIR}.'
                )
            raise CommandError(
                f'Face Enrollment will return MODEL_UNAVAILABLE for every request until this is '
                f'fixed and the process is restarted.{hint}'
            )

        self.stdout.write(
            self.style.SUCCESS(
                'Face Enrollment is ready — GET /api/v1/auth/face/readiness/ now reports READY.'
            )
        )
        self.stdout.write('Starting server (autoreload disabled)...')
        call_command('runserver', options['addrport'], use_reloader=False)
