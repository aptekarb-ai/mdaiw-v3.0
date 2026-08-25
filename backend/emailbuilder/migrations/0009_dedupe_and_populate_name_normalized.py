# Phase B (Template Experience) — step 2 of 3. Resolves any pre-existing
# per-user, case-/whitespace-insensitive `name` collisions (deterministic
# suffixing: the oldest row in each colliding group keeps its name
# unchanged, later rows become "Name (2)", "Name (3)", ... checked against
# the user's ENTIRE existing namespace so a suffix can never collide with
# an already-existing, unrelated document), then populates
# `name_normalized` for every row.
#
# No rows are deleted. No field other than `name`/`name_normalized` is
# touched, and only for rows that actually collide is `name` touched at
# all. Uses `.update()` (not instance.save()) so `updated_at` (auto_now)
# is not bumped by this migration.
#
# The normalization rule is intentionally duplicated here (`_normalize`)
# rather than importing name_normalization.normalize_email_name — a data
# migration must freeze the exact rule it needs at the time it ran; it must
# not silently change behavior if that shared helper is ever edited later.
# This copy matches name_normalization.py at the time of writing:
# name.strip().casefold().
#
# Reverse is a no-op: the specific pre-migration duplicate names are not
# recorded anywhere, so the exact original (colliding) names cannot be
# losslessly restored. Rolling back only removes the later 0010
# constraint/NOT NULL — it does not, and cannot, un-suffix these rows.

from collections import defaultdict

from django.db import migrations


def _normalize(name):
    return name.strip().casefold()


def resolve_collisions_and_populate(apps, schema_editor):
    EmailDocument = apps.get_model('emailbuilder', 'EmailDocument')

    docs_by_user = defaultdict(list)
    for doc in EmailDocument.objects.all().order_by('user_id', 'created_at', 'id'):
        docs_by_user[doc.user_id].append(doc)

    for _user_id, docs in docs_by_user.items():
        # Every name currently in use by this user — the full namespace a
        # newly-chosen suffix must avoid, not just names within one
        # colliding group.
        taken = {_normalize(doc.name) for doc in docs}

        groups = defaultdict(list)
        for doc in docs:
            groups[_normalize(doc.name)].append(doc)

        for norm_key, group in groups.items():
            if len(group) == 1:
                doc = group[0]
                EmailDocument.objects.filter(pk=doc.pk).update(name_normalized=norm_key)
                continue

            # `docs` was ordered by (created_at, id) above, so group[0] is
            # the oldest colliding row — it keeps its name unchanged.
            oldest = group[0]
            EmailDocument.objects.filter(pk=oldest.pk).update(name_normalized=norm_key)

            base_name = oldest.name
            for doc in group[1:]:
                suffix = 2
                candidate = f'{base_name} ({suffix})'
                while _normalize(candidate) in taken:
                    suffix += 1
                    candidate = f'{base_name} ({suffix})'
                taken.add(_normalize(candidate))
                EmailDocument.objects.filter(pk=doc.pk).update(
                    name=candidate, name_normalized=_normalize(candidate),
                )


class Migration(migrations.Migration):

    dependencies = [
        ('emailbuilder', '0008_emaildocument_name_normalized'),
    ]

    operations = [
        migrations.RunPython(resolve_collisions_and_populate, migrations.RunPython.noop),
    ]
