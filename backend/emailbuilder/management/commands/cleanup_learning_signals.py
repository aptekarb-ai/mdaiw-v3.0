"""Feature 14 V3 Sub-phase 8 — permanently deletes LearnedRepairSignal
rows older than learning.RETENTION_DAYS (365 days by default).

IMPORTANT, documented honestly (do not remove this notice): this
repository has NO bundled task scheduler (no Celery/Redis/cron runner —
the same MVP infrastructure constraint every other Module-4 sub-phase
has followed). Running this command is NOT something the application
does for itself on a timer. For the 365-day retention boundary to
actually be enforced, an operator must invoke this command periodically
via an EXTERNAL scheduler — OS cron, Windows Task Scheduler, or a
deployment platform's own scheduled-job feature (e.g.
`python manage.py cleanup_learning_signals` run nightly/weekly). Until
that external schedule exists, old rows simply remain in the table
(harmlessly — they already fall outside learning.RANKING_WINDOW_DAYS and
stop influencing ranking long before this command would ever delete
them); this is a retention CEILING the app can enforce when invoked, not
an application-level SLA it enforces on its own.

Usage (Windows PowerShell, from backend/):
    python manage.py cleanup_learning_signals
    python manage.py cleanup_learning_signals --dry-run
"""

from datetime import timedelta

from django.core.management.base import BaseCommand
from django.utils import timezone

from ... import learning
from ...models import LearnedRepairSignal


class Command(BaseCommand):
    help = (
        'Permanently deletes LearnedRepairSignal rows older than '
        f'{learning.RETENTION_DAYS} days. Must be invoked by an external '
        'scheduler — this repository has no bundled task runner.'
    )

    def add_arguments(self, parser):
        parser.add_argument(
            '--dry-run', action='store_true',
            help='Report how many rows would be deleted without deleting them.',
        )

    def handle(self, *args, **options):
        cutoff = timezone.now() - timedelta(days=learning.RETENTION_DAYS)
        queryset = LearnedRepairSignal.objects.filter(created_at__lt=cutoff)
        count = queryset.count()

        if options['dry_run']:
            self.stdout.write(f'Would delete {count} learned repair signal(s) older than {learning.RETENTION_DAYS} days.')
            return

        deleted_count, _ = queryset.delete()
        self.stdout.write(self.style.SUCCESS(
            f'Deleted {deleted_count} learned repair signal(s) older than {learning.RETENTION_DAYS} days.',
        ))
