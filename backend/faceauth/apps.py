import os
import sys

from django.apps import AppConfig


class FaceauthConfig(AppConfig):
    name = 'faceauth'

    def ready(self):
        # Only for the actual `runserver` process, never for `test`,
        # `migrate`, `makemigrations`, `shell`, `warm_up_face_models`,
        # `download_face_models`, or any other management command — those
        # must never trigger a background import of the real biometric
        # engine stack (OpenCV/DeepFace/TensorFlow). `run_face_server` is
        # also excluded here — it performs its own synchronous, blocking
        # warm-up in its handle() before ever calling `runserver` itself,
        # which is a stronger guarantee than this background thread.
        if 'runserver' not in sys.argv:
            return
        # With Django's autoreloader (the default), `ready()` fires once in
        # the reloader's watcher process and again in the actual child
        # server process, which sets RUN_MAIN=true. Only the child should
        # start the background thread — otherwise two independent warm-up
        # threads would race pointlessly. `--noreload` never sets RUN_MAIN
        # at all, and in that mode there is only one process, so it must
        # still proceed.
        if os.environ.get('RUN_MAIN') != 'true' and '--noreload' not in sys.argv:
            return

        from . import service

        service.get_engine().start_background_warm_up()
        service.get_anti_spoof_provider().start_background_warm_up()
