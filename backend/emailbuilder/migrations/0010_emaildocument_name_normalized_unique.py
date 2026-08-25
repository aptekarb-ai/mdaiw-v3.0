# Phase B (Template Experience) — step 3 of 3. Every row now has a
# populated, collision-free `name_normalized` (0009), so this makes the
# column required and adds the authoritative per-user uniqueness
# constraint. From here on, EmailDocument.save() (models.py) keeps
# `name_normalized` in sync on every write, and the constraint is the
# final backstop against concurrent/racing requests choosing the same
# name (see EmailDocumentViewSet's IntegrityError handling in views.py).

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('emailbuilder', '0009_dedupe_and_populate_name_normalized'),
    ]

    operations = [
        migrations.AlterField(
            model_name='emaildocument',
            name='name_normalized',
            field=models.CharField(editable=False, max_length=360),
        ),
        migrations.AddConstraint(
            model_name='emaildocument',
            constraint=models.UniqueConstraint(
                fields=('user', 'name_normalized'), name='unique_emaildocument_user_name_normalized',
            ),
        ),
    ]
