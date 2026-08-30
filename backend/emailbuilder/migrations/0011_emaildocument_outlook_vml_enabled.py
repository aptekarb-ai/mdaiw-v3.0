# Generated for Module-4 E4 — Outlook/VML document-level toggle.

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('emailbuilder', '0010_emaildocument_name_normalized_unique'),
    ]

    operations = [
        migrations.AddField(
            model_name='emaildocument',
            name='outlook_vml_enabled',
            field=models.BooleanField(default=False),
        ),
    ]
