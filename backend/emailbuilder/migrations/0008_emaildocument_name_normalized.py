# Phase B (Template Experience) — step 1 of 3 for per-user, case- and
# whitespace-insensitive EmailDocument name uniqueness. Adds the column
# nullable first so existing rows are not required to have a value before
# 0009's data migration populates it (and resolves any legacy collisions).

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('emailbuilder', '0007_learnedrepairsignal'),
    ]

    operations = [
        migrations.AddField(
            model_name='emaildocument',
            name='name_normalized',
            field=models.CharField(blank=True, editable=False, max_length=360, null=True),
        ),
    ]
