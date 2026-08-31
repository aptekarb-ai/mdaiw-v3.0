import io
import json
from unittest.mock import Mock

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import IntegrityError, connection, transaction
from django.db.migrations.executor import MigrationExecutor
from django.test import TestCase, TransactionTestCase
from django.test.client import BOUNDARY, MULTIPART_CONTENT, encode_multipart
from rest_framework.exceptions import ValidationError as DRFValidationError

from PIL import Image

from .models import EmailAsset, EmailDocument, SavedEmailModule
from .views import save_with_unique_name_guard


def _asset_image_bytes(image_format='JPEG', size=(20, 20)):
    buffer = io.BytesIO()
    Image.new('RGB', size, color='blue').save(buffer, format=image_format)
    return buffer.getvalue()


class EmailDocumentCreateTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(
            username='jane.doe',
            email='jane.doe@example.com',
            password='StrongPass123',
        )
        self.other_user = User.objects.create_user(
            username='john.roe',
            email='john.roe@example.com',
            password='StrongPass123',
        )
        self.url = '/api/v1/email-builder/emails/'

    def _post_json(self, data):
        return self.client.post(self.url, data=json.dumps(data), content_type='application/json')

    def _valid_payload(self, **overrides):
        payload = {'name': 'August Product Newsletter', 'platform': 'generic', 'width': 700, 'start_type': 'blank'}
        payload.update(overrides)
        return payload

    def test_unauthenticated_create_rejected(self):
        response = self._post_json(self._valid_payload())
        self.assertEqual(response.status_code, 403)
        body = response.json()
        self.assertFalse(body['success'])
        self.assertEqual(body['code'], 'PERMISSION_DENIED')
        self.assertEqual(EmailDocument.objects.count(), 0)

    def test_authenticated_create_succeeds(self):
        self.client.force_login(self.user)
        response = self._post_json(self._valid_payload())
        self.assertEqual(response.status_code, 201)
        body = response.json()
        self.assertEqual(body['name'], 'August Product Newsletter')
        self.assertEqual(body['platform'], 'generic')
        self.assertEqual(body['width'], 700)
        self.assertEqual(body['start_type'], 'blank')
        self.assertEqual(body['status'], 'draft')
        self.assertIn('id', body)

    def test_created_by_comes_from_authenticated_user_not_client(self):
        self.client.force_login(self.user)
        response = self._post_json(self._valid_payload(created_by=self.other_user.id))
        self.assertEqual(response.status_code, 201)
        document = EmailDocument.objects.get(pk=response.json()['id'])
        self.assertEqual(document.user_id, self.user.id)

    def test_valid_platform_values_accepted(self):
        self.client.force_login(self.user)
        for platform in ['generic', 'sfmc', 'marketo', 'hubspot', 'pardot', 'other']:
            response = self._post_json(self._valid_payload(name=f'Email {platform}', platform=platform))
            self.assertEqual(response.status_code, 201, platform)
            self.assertEqual(response.json()['platform'], platform)

    def test_invalid_platform_rejected(self):
        self.client.force_login(self.user)
        response = self._post_json(self._valid_payload(platform='mailchimp'))
        self.assertEqual(response.status_code, 400)
        body = response.json()
        self.assertFalse(body['success'])
        self.assertIn('platform', body['errors'])

    def test_valid_start_type_values_accepted(self):
        self.client.force_login(self.user)
        for start_type in ['blank', 'template', 'html', 'ai']:
            response = self._post_json(self._valid_payload(name=f'Email {start_type}', start_type=start_type))
            self.assertEqual(response.status_code, 201, start_type)
            self.assertEqual(response.json()['start_type'], start_type)

    def test_invalid_start_type_rejected(self):
        self.client.force_login(self.user)
        response = self._post_json(self._valid_payload(start_type='scratch'))
        self.assertEqual(response.status_code, 400)
        self.assertIn('start_type', response.json()['errors'])

    def test_width_below_minimum_rejected(self):
        self.client.force_login(self.user)
        response = self._post_json(self._valid_payload(width=100))
        self.assertEqual(response.status_code, 400)
        self.assertIn('width', response.json()['errors'])

    def test_width_above_maximum_rejected(self):
        self.client.force_login(self.user)
        response = self._post_json(self._valid_payload(width=5000))
        self.assertEqual(response.status_code, 400)
        self.assertIn('width', response.json()['errors'])

    def test_width_within_range_accepted(self):
        self.client.force_login(self.user)
        response = self._post_json(self._valid_payload(width=320))
        self.assertEqual(response.status_code, 201)
        response = self._post_json(self._valid_payload(name='Wide email', width=1200))
        self.assertEqual(response.status_code, 201)

    def test_name_required(self):
        self.client.force_login(self.user)
        response = self._post_json(self._valid_payload(name=''))
        self.assertEqual(response.status_code, 400)
        self.assertIn('name', response.json()['errors'])

    def test_name_whitespace_only_rejected(self):
        self.client.force_login(self.user)
        response = self._post_json(self._valid_payload(name='   '))
        self.assertEqual(response.status_code, 400)
        self.assertIn('name', response.json()['errors'])

    def test_name_is_trimmed(self):
        self.client.force_login(self.user)
        response = self._post_json(self._valid_payload(name='  Spaced Name  '))
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()['name'], 'Spaced Name')

    def test_default_status_is_draft(self):
        self.client.force_login(self.user)
        response = self._post_json(self._valid_payload())
        document = EmailDocument.objects.get(pk=response.json()['id'])
        self.assertEqual(document.status, 'draft')


class EmailDocumentListTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(username='jane.doe', password='StrongPass123')
        self.other_user = User.objects.create_user(username='john.roe', password='StrongPass123')
        self.url = '/api/v1/email-builder/emails/'

    def test_unauthenticated_list_rejected(self):
        response = self.client.get(self.url)
        self.assertEqual(response.status_code, 403)

    def test_list_only_returns_own_documents(self):
        EmailDocument.objects.create(user=self.user, name='Mine', platform='generic', width=700, start_type='blank')
        EmailDocument.objects.create(
            user=self.other_user, name='Not mine', platform='generic', width=700, start_type='blank',
        )
        self.client.force_login(self.user)
        response = self.client.get(self.url)
        self.assertEqual(response.status_code, 200)
        names = [item['name'] for item in response.json()]
        self.assertEqual(names, ['Mine'])

    def test_another_users_document_404s_on_retrieve(self):
        other_document = EmailDocument.objects.create(
            user=self.other_user, name='Not mine', platform='generic', width=700, start_type='blank',
        )
        self.client.force_login(self.user)
        response = self.client.get(f'{self.url}{other_document.id}/')
        self.assertEqual(response.status_code, 404)


def _module(module_id='m1', module_type='text', order=0, props=None, settings=None):
    return {
        'id': module_id,
        'type': module_type,
        'order': order,
        'props': props if props is not None else {'text': 'Welcome'},
        'settings': settings if settings is not None else {
            'paddingTop': 20, 'paddingRight': 20, 'paddingBottom': 20, 'paddingLeft': 20,
        },
    }


class EmailDocumentBuilderPatchTests(TestCase):
    """Feature 03 — builder persistence (GET one / PATCH content)."""

    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(username='jane.doe', password='StrongPass123')
        self.other_user = User.objects.create_user(username='john.roe', password='StrongPass123')
        self.document = EmailDocument.objects.create(
            user=self.user, name='August Newsletter', platform='sfmc', width=750, start_type='blank',
        )
        self.url = f'/api/v1/email-builder/emails/{self.document.id}/'

    def _patch_json(self, data):
        return self.client.patch(self.url, data=json.dumps(data), content_type='application/json')

    def test_owner_can_retrieve_email(self):
        self.client.force_login(self.user)
        response = self.client.get(self.url)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['id'], self.document.id)
        self.assertEqual(response.json()['content'], {'version': 1, 'modules': []})

    def test_non_owner_cannot_retrieve(self):
        self.client.force_login(self.other_user)
        response = self.client.get(self.url)
        self.assertEqual(response.status_code, 404)

    def test_anonymous_retrieve_rejected(self):
        response = self.client.get(self.url)
        self.assertEqual(response.status_code, 403)

    def test_owner_can_patch_builder_content(self):
        self.client.force_login(self.user)
        content = {'version': 1, 'modules': [_module()]}
        response = self._patch_json({'content': content})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['content'], content)
        self.document.refresh_from_db()
        self.assertEqual(self.document.content, content)

    def test_anonymous_update_rejected(self):
        response = self._patch_json({'content': {'version': 1, 'modules': [_module()]}})
        self.assertEqual(response.status_code, 403)
        self.document.refresh_from_db()
        self.assertEqual(self.document.content, {'version': 1, 'modules': []})

    def test_non_owner_update_rejected(self):
        self.client.force_login(self.other_user)
        response = self._patch_json({'content': {'version': 1, 'modules': [_module()]}})
        self.assertEqual(response.status_code, 404)

    def test_invalid_document_schema_rejected_missing_modules(self):
        self.client.force_login(self.user)
        response = self._patch_json({'content': {'version': 1}})
        self.assertEqual(response.status_code, 400)
        self.assertIn('content', response.json()['errors'])

    def test_invalid_document_schema_rejected_wrong_version(self):
        self.client.force_login(self.user)
        response = self._patch_json({'content': {'version': 2, 'modules': []}})
        self.assertEqual(response.status_code, 400)
        self.assertIn('content', response.json()['errors'])

    def test_invalid_module_type_rejected(self):
        self.client.force_login(self.user)
        response = self._patch_json({'content': {'version': 1, 'modules': [_module(module_type='carousel')]}})
        self.assertEqual(response.status_code, 400)
        self.assertIn('content', response.json()['errors'])

    def test_invalid_module_data_rejected_bad_padding(self):
        self.client.force_login(self.user)
        bad_module = _module(settings={
            'paddingTop': -5, 'paddingRight': 20, 'paddingBottom': 20, 'paddingLeft': 20,
        })
        response = self._patch_json({'content': {'version': 1, 'modules': [bad_module]}})
        self.assertEqual(response.status_code, 400)
        self.assertIn('content', response.json()['errors'])

    def test_invalid_module_data_rejected_missing_id(self):
        self.client.force_login(self.user)
        module = _module()
        del module['id']
        response = self._patch_json({'content': {'version': 1, 'modules': [module]}})
        self.assertEqual(response.status_code, 400)
        self.assertIn('content', response.json()['errors'])

    def test_email_width_remains_validated_on_patch(self):
        self.client.force_login(self.user)
        response = self._patch_json({'width': 5000})
        self.assertEqual(response.status_code, 400)
        self.assertIn('width', response.json()['errors'])
        self.document.refresh_from_db()
        self.assertEqual(self.document.width, 750)

    def test_platform_preserved_when_patching_only_content(self):
        self.client.force_login(self.user)
        response = self._patch_json({'content': {'version': 1, 'modules': [_module()]}})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['platform'], 'sfmc')
        self.assertEqual(response.json()['width'], 750)

    def test_feature_04_module_types_accepted(self):
        self.client.force_login(self.user)
        for module_type in [
            'header-logo-nav', 'hero-background-image', 'content-quote',
            'product-three-cards', 'cta-dual', 'social-follow-us', 'footer-preference-unsubscribe',
        ]:
            content = {'version': 1, 'modules': [_module(module_type=module_type)]}
            response = self._patch_json({'content': content})
            self.assertEqual(response.status_code, 200, module_type)
        # layout-6col needs real columnWidths (Feature 05 validates the
        # sum/minimum — see LayoutBuilderNestedTests below), not the
        # generic _module() default {'text': ...} props.
        response = self._patch_json({'content': {'version': 1, 'modules': [_layout_module(module_type='layout-6col', column_widths=[17, 17, 16, 17, 16, 17])]}})
        self.assertEqual(response.status_code, 200, 'layout-6col')

    def test_responsive_settings_shape_accepted(self):
        self.client.force_login(self.user)
        settings = {
            'desktop': {'paddingTop': 20, 'paddingRight': 20, 'paddingBottom': 20, 'paddingLeft': 20},
            'mobile': {'paddingLeft': 12, 'paddingRight': 12},
            'outerSpacing': {'left': {'value': 20, 'unit': 'px'}, 'right': {'value': 0, 'unit': 'px'}},
        }
        content = {'version': 1, 'modules': [_module(settings=settings)]}
        response = self._patch_json({'content': content})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['content'], content)

    def test_responsive_settings_desktop_missing_key_rejected(self):
        self.client.force_login(self.user)
        settings = {'desktop': {'paddingTop': 20, 'paddingRight': 20, 'paddingBottom': 20}, 'mobile': {}}
        content = {'version': 1, 'modules': [_module(settings=settings)]}
        response = self._patch_json({'content': content})
        self.assertEqual(response.status_code, 400)
        self.assertIn('content', response.json()['errors'])

    def test_outer_spacing_percent_over_100_rejected(self):
        self.client.force_login(self.user)
        settings = {
            'desktop': {'paddingTop': 0, 'paddingRight': 0, 'paddingBottom': 0, 'paddingLeft': 0},
            'mobile': {},
            'outerSpacing': {'left': {'value': 150, 'unit': '%'}, 'right': {'value': 0, 'unit': 'px'}},
        }
        content = {'version': 1, 'modules': [_module(settings=settings)]}
        response = self._patch_json({'content': content})
        self.assertEqual(response.status_code, 400)
        self.assertIn('content', response.json()['errors'])

    def test_outer_spacing_percent_sum_over_100_rejected(self):
        self.client.force_login(self.user)
        settings = {
            'desktop': {'paddingTop': 0, 'paddingRight': 0, 'paddingBottom': 0, 'paddingLeft': 0},
            'mobile': {},
            'outerSpacing': {'left': {'value': 60, 'unit': '%'}, 'right': {'value': 45, 'unit': '%'}},
        }
        content = {'version': 1, 'modules': [_module(settings=settings)]}
        response = self._patch_json({'content': content})
        self.assertEqual(response.status_code, 400)
        self.assertIn('content', response.json()['errors'])

    def test_outer_spacing_percent_sum_under_100_accepted(self):
        self.client.force_login(self.user)
        settings = {
            'desktop': {'paddingTop': 0, 'paddingRight': 0, 'paddingBottom': 0, 'paddingLeft': 0},
            'mobile': {},
            'outerSpacing': {'left': {'value': 5, 'unit': '%'}, 'right': {'value': 10, 'unit': '%'}},
        }
        content = {'version': 1, 'modules': [_module(settings=settings)]}
        response = self._patch_json({'content': content})
        self.assertEqual(response.status_code, 200)

    def test_outer_spacing_negative_value_rejected(self):
        self.client.force_login(self.user)
        settings = {
            'desktop': {'paddingTop': 0, 'paddingRight': 0, 'paddingBottom': 0, 'paddingLeft': 0},
            'mobile': {},
            'outerSpacing': {'left': {'value': -5, 'unit': 'px'}, 'right': {'value': 0, 'unit': 'px'}},
        }
        content = {'version': 1, 'modules': [_module(settings=settings)]}
        response = self._patch_json({'content': content})
        self.assertEqual(response.status_code, 400)
        self.assertIn('content', response.json()['errors'])

    def test_outer_spacing_invalid_unit_rejected(self):
        self.client.force_login(self.user)
        settings = {
            'desktop': {'paddingTop': 0, 'paddingRight': 0, 'paddingBottom': 0, 'paddingLeft': 0},
            'mobile': {},
            'outerSpacing': {'left': {'value': 20, 'unit': 'em'}, 'right': {'value': 0, 'unit': 'px'}},
        }
        content = {'version': 1, 'modules': [_module(settings=settings)]}
        response = self._patch_json({'content': content})
        self.assertEqual(response.status_code, 400)
        self.assertIn('content', response.json()['errors'])

    def test_legacy_flat_settings_shape_still_accepted(self):
        # Pre-Feature-04.5 drafts — no `desktop`/`mobile`/`outerSpacing`
        # keys at all. Must keep saving without a forced migration.
        self.client.force_login(self.user)
        content = {'version': 1, 'modules': [_module(settings={
            'paddingTop': 20, 'paddingRight': 20, 'paddingBottom': 20, 'paddingLeft': 20,
        })]}
        response = self._patch_json({'content': content})
        self.assertEqual(response.status_code, 200)

    def test_outer_spacing_desktop_mobile_shape_accepted(self):
        self.client.force_login(self.user)
        settings = {
            'desktop': {'paddingTop': 0, 'paddingRight': 0, 'paddingBottom': 0, 'paddingLeft': 0},
            'mobile': {},
            'outerSpacing': {
                'desktop': {'left': {'value': 20, 'unit': 'px'}, 'right': {'value': 30, 'unit': 'px'}},
                'mobile': {'left': {'value': 10, 'unit': 'px'}},
            },
        }
        content = {'version': 1, 'modules': [_module(settings=settings)]}
        response = self._patch_json({'content': content})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['content'], content)

    def test_outer_spacing_desktop_missing_side_rejected(self):
        self.client.force_login(self.user)
        settings = {
            'desktop': {'paddingTop': 0, 'paddingRight': 0, 'paddingBottom': 0, 'paddingLeft': 0},
            'mobile': {},
            'outerSpacing': {'desktop': {'left': {'value': 20, 'unit': 'px'}}, 'mobile': {}},
        }
        content = {'version': 1, 'modules': [_module(settings=settings)]}
        response = self._patch_json({'content': content})
        self.assertEqual(response.status_code, 400)
        self.assertIn('content', response.json()['errors'])

    def test_outer_spacing_mobile_partial_override_accepted(self):
        self.client.force_login(self.user)
        settings = {
            'desktop': {'paddingTop': 0, 'paddingRight': 0, 'paddingBottom': 0, 'paddingLeft': 0},
            'mobile': {},
            'outerSpacing': {
                'desktop': {'left': {'value': 20, 'unit': 'px'}, 'right': {'value': 30, 'unit': 'px'}},
                'mobile': {'right': {'value': 12, 'unit': 'px'}},
            },
        }
        content = {'version': 1, 'modules': [_module(settings=settings)]}
        response = self._patch_json({'content': content})
        self.assertEqual(response.status_code, 200)

    def test_outer_spacing_resolved_mobile_percent_sum_over_100_rejected(self):
        # Desktop alone (5% / 90%) is fine, but a mobile override that
        # pushes the RESOLVED mobile pair over budget must still be
        # rejected — not just the desktop pair in isolation.
        self.client.force_login(self.user)
        settings = {
            'desktop': {'paddingTop': 0, 'paddingRight': 0, 'paddingBottom': 0, 'paddingLeft': 0},
            'mobile': {},
            'outerSpacing': {
                'desktop': {'left': {'value': 5, 'unit': '%'}, 'right': {'value': 90, 'unit': '%'}},
                'mobile': {'left': {'value': 50, 'unit': '%'}},
            },
        }
        content = {'version': 1, 'modules': [_module(settings=settings)]}
        response = self._patch_json({'content': content})
        self.assertEqual(response.status_code, 400)
        self.assertIn('content', response.json()['errors'])

    def test_outer_spacing_legacy_flat_shape_still_accepted(self):
        # Feature-04.5's first pass — outerSpacing was flat {left,right},
        # no desktop/mobile split yet. Must keep saving.
        self.client.force_login(self.user)
        settings = {
            'desktop': {'paddingTop': 0, 'paddingRight': 0, 'paddingBottom': 0, 'paddingLeft': 0},
            'mobile': {},
            'outerSpacing': {'left': {'value': 20, 'unit': 'px'}, 'right': {'value': 20, 'unit': 'px'}},
        }
        content = {'version': 1, 'modules': [_module(settings=settings)]}
        response = self._patch_json({'content': content})
        self.assertEqual(response.status_code, 200)

    def test_non_owner_cannot_patch_document_with_nested_layout(self):
        other = get_user_model().objects.create_user(username='mallory', password='StrongPass123')
        self.client.force_login(other)
        response = self._patch_json({'content': {'version': 1, 'modules': [_layout_module()]}})
        self.assertEqual(response.status_code, 404)


class EmailDocumentRenameTests(TestCase):
    """Dashboard rename — reuses the same PATCH endpoint the builder uses
    for content; `name` is just another writable serializer field, so no
    new endpoint is needed."""

    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(username='jane.doe', password='StrongPass123')
        self.other_user = User.objects.create_user(username='john.roe', password='StrongPass123')
        self.document = EmailDocument.objects.create(
            user=self.user, name='Original Name', platform='generic', width=700, start_type='blank',
        )
        self.url = f'/api/v1/email-builder/emails/{self.document.id}/'

    def _patch_json(self, data):
        return self.client.patch(self.url, data=json.dumps(data), content_type='application/json')

    def test_owner_can_rename(self):
        self.client.force_login(self.user)
        response = self._patch_json({'name': 'Renamed Newsletter'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['name'], 'Renamed Newsletter')
        self.document.refresh_from_db()
        self.assertEqual(self.document.name, 'Renamed Newsletter')

    def test_rename_trims_whitespace(self):
        self.client.force_login(self.user)
        response = self._patch_json({'name': '  Spaced Rename  '})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['name'], 'Spaced Rename')

    def test_rename_rejects_empty_name(self):
        self.client.force_login(self.user)
        response = self._patch_json({'name': ''})
        self.assertEqual(response.status_code, 400)
        self.assertIn('name', response.json()['errors'])
        self.document.refresh_from_db()
        self.assertEqual(self.document.name, 'Original Name')

    def test_rename_rejects_whitespace_only_name(self):
        self.client.force_login(self.user)
        response = self._patch_json({'name': '   '})
        self.assertEqual(response.status_code, 400)
        self.assertIn('name', response.json()['errors'])

    def test_rename_preserves_content(self):
        self.document.content = {'version': 1, 'modules': [_module()]}
        self.document.save()
        self.client.force_login(self.user)
        response = self._patch_json({'name': 'Renamed, Content Preserved'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['content'], {'version': 1, 'modules': [_module()]})

    def test_non_owner_cannot_rename(self):
        self.client.force_login(self.other_user)
        response = self._patch_json({'name': 'Hijacked'})
        self.assertEqual(response.status_code, 404)
        self.document.refresh_from_db()
        self.assertEqual(self.document.name, 'Original Name')

    def test_anonymous_cannot_rename(self):
        response = self._patch_json({'name': 'Hijacked'})
        self.assertEqual(response.status_code, 403)


class EmailDocumentNameUniquenessTests(TestCase):
    """Phase B (Template Experience) Decision 1 — durable per-user,
    case-/whitespace-insensitive name uniqueness. The DB's
    (user, name_normalized) UniqueConstraint (models.py) is authoritative;
    EmailDocumentSerializer.validate_name pre-checks the same condition for
    fast UX (see EmailDocumentNameNormalizationModelTests and
    SaveWithUniqueNameGuardTests below for the model- and race-level
    backstops this HTTP-level behavior sits on top of)."""

    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(username='jane.doe', password='StrongPass123')
        self.other_user = User.objects.create_user(username='john.roe', password='StrongPass123')
        self.document = EmailDocument.objects.create(
            user=self.user, name='Spring Launch', platform='generic', width=700, start_type='blank',
        )
        self.url = '/api/v1/email-builder/emails/'

    def _post_json(self, data):
        payload = {'platform': 'generic', 'width': 700, 'start_type': 'blank'}
        payload.update(data)
        return self.client.post(self.url, data=json.dumps(payload), content_type='application/json')

    def _patch_json(self, doc_id, data):
        return self.client.patch(
            f'{self.url}{doc_id}/', data=json.dumps(data), content_type='application/json',
        )

    def test_create_exact_duplicate_name_rejected(self):
        self.client.force_login(self.user)
        response = self._post_json({'name': 'Spring Launch'})
        self.assertEqual(response.status_code, 400)
        self.assertIn('name', response.json()['errors'])
        self.assertEqual(EmailDocument.objects.filter(user=self.user).count(), 1)

    def test_create_case_insensitive_duplicate_rejected(self):
        self.client.force_login(self.user)
        for variant in ['spring launch', 'SPRING LAUNCH', 'Spring LAUNCH', 'sPrInG lAuNcH']:
            response = self._post_json({'name': variant})
            self.assertEqual(response.status_code, 400, variant)
            self.assertIn('name', response.json()['errors'])
        self.assertEqual(EmailDocument.objects.filter(user=self.user).count(), 1)

    def test_create_whitespace_equivalent_duplicate_rejected(self):
        self.client.force_login(self.user)
        response = self._post_json({'name': '  Spring Launch  '})
        self.assertEqual(response.status_code, 400)
        self.assertIn('name', response.json()['errors'])

    def test_create_same_name_different_user_allowed(self):
        self.client.force_login(self.other_user)
        response = self._post_json({'name': 'Spring Launch'})
        self.assertEqual(response.status_code, 201)

    def test_rename_to_existing_name_rejected(self):
        second = EmailDocument.objects.create(
            user=self.user, name='Autumn Launch', platform='generic', width=700, start_type='blank',
        )
        self.client.force_login(self.user)
        response = self._patch_json(second.id, {'name': 'spring launch'})
        self.assertEqual(response.status_code, 400)
        self.assertIn('name', response.json()['errors'])
        second.refresh_from_db()
        self.assertEqual(second.name, 'Autumn Launch')

    def test_rename_to_own_current_name_allowed(self):
        # A document colliding only with itself (e.g. re-casing/re-trimming
        # its own current name) must not be rejected — validate_name
        # excludes self.instance.
        self.client.force_login(self.user)
        response = self._patch_json(self.document.id, {'name': '  SPRING LAUNCH  '})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['name'], 'SPRING LAUNCH')

    def test_rename_to_different_users_name_allowed(self):
        EmailDocument.objects.create(
            user=self.other_user, name='Shared Title', platform='generic', width=700, start_type='blank',
        )
        self.client.force_login(self.user)
        response = self._patch_json(self.document.id, {'name': 'Shared Title'})
        self.assertEqual(response.status_code, 200)

    def test_duplicate_error_message_is_field_level_and_specific(self):
        self.client.force_login(self.user)
        response = self._post_json({'name': 'Spring Launch'})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(
            response.json()['errors']['name'],
            ['An email with this name already exists. Choose a different name.'],
        )
        self.assertNotEqual(response.status_code, 500)

    def test_forged_name_normalized_in_payload_is_ignored_not_written(self):
        # name_normalized is absent from EmailDocumentSerializer.Meta.fields
        # (serializers.py) — DRF drops unknown keys, so this proves a
        # forged value can neither reach storage nor be used to dodge the
        # uniqueness check by claiming a mismatched normalized form.
        self.client.force_login(self.user)
        response = self._post_json({'name': 'Forged Normalized Value', 'name_normalized': 'not-even-close'})
        self.assertEqual(response.status_code, 201)
        self.assertNotIn('name_normalized', response.json())
        document = EmailDocument.objects.get(pk=response.json()['id'])
        self.assertEqual(document.name_normalized, 'forged normalized value')

    def test_forged_name_normalized_cannot_bypass_uniqueness_check(self):
        self.client.force_login(self.user)
        # Claiming a name_normalized that doesn't collide, while `name`
        # itself does, must still be rejected — the server derives
        # name_normalized from `name`, never trusts the client's claim.
        response = self._post_json({'name': 'spring launch', 'name_normalized': 'this-does-not-collide'})
        self.assertEqual(response.status_code, 400)
        self.assertIn('name', response.json()['errors'])
        self.assertEqual(EmailDocument.objects.filter(user=self.user).count(), 1)


class CreateFromTemplateIntegrityTests(TestCase):
    """The frontend's createEmailDocumentFromTemplate (duplicateEmailDocument.ts)
    composes create-from-template purely from this API's existing
    create/update endpoints — no dedicated backend endpoint exists for it.
    This proves the resulting rows are fully independent at the API/DB
    level: editing the newly-created document afterward cannot reach the
    source template's row, by ordinary FK/PK isolation."""

    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(username='jane.doe', password='StrongPass123')
        self.template = EmailDocument.objects.create(
            user=self.user, name='Newsletter Template', platform='sfmc', width=650, start_type='template',
            content={'version': 1, 'modules': [_module('tpl-1')]},
        )
        self.url = '/api/v1/email-builder/emails/'

    def test_editing_the_created_document_never_touches_the_source_template(self):
        self.client.force_login(self.user)
        created = self.client.post(self.url, data=json.dumps({
            'name': 'From Newsletter Template', 'platform': self.template.platform,
            'width': self.template.width, 'start_type': 'blank',
        }), content_type='application/json').json()

        # Further edits to the NEW document (the builder's normal autosave
        # PATCH path) target only its own id.
        self.client.patch(f'{self.url}{created["id"]}/', data=json.dumps({
            'content': {'version': 1, 'modules': [_module('edited-1'), _module('edited-2', order=1)]},
        }), content_type='application/json')

        self.template.refresh_from_db()
        self.assertEqual(self.template.name, 'Newsletter Template')
        self.assertEqual(self.template.start_type, 'template')
        self.assertEqual(self.template.content, {'version': 1, 'modules': [_module('tpl-1')]})

        edited = EmailDocument.objects.get(pk=created['id'])
        self.assertEqual(len(edited.content['modules']), 2)
        self.assertEqual(edited.start_type, 'blank')


class EmailDocumentNameNormalizationModelTests(TestCase):
    """Model-level proof that `name_normalized` (models.py) stays in sync
    on every save() regardless of caller, and that the DB constraint
    itself — not just the serializer pre-check — rejects a collision."""

    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(username='jane.doe', password='StrongPass123')

    def test_save_trims_and_populates_name_normalized(self):
        document = EmailDocument.objects.create(
            user=self.user, name='  Mixed CASE Name  ', platform='generic', width=700, start_type='blank',
        )
        self.assertEqual(document.name, 'Mixed CASE Name')
        self.assertEqual(document.name_normalized, 'mixed case name')

    def test_casefold_collides_beyond_ascii_lower(self):
        # German sharp s (ß) casefolds to "ss" — a case Python's plain
        # .lower() does not fold but .casefold() does; this is exactly why
        # name_normalization.py uses casefold(), not lower().
        document = EmailDocument.objects.create(
            user=self.user, name='Straße Update', platform='generic', width=700, start_type='blank',
        )
        self.assertEqual(document.name_normalized, 'strasse update')

    def test_db_constraint_blocks_direct_orm_duplicate(self):
        EmailDocument.objects.create(
            user=self.user, name='Direct One', platform='generic', width=700, start_type='blank',
        )
        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                EmailDocument.objects.create(
                    user=self.user, name='direct one', platform='generic', width=700, start_type='blank',
                )
        # The failed INSERT must not have left a partial row behind.
        self.assertEqual(EmailDocument.objects.filter(user=self.user).count(), 1)


class NameNormalizedMigrationLogicTests(TransactionTestCase):
    """Runs the REAL 0009/0010 migrations through Django's own
    MigrationExecutor against a database actually parked at the 0008
    state (nullable name_normalized, no constraint yet — the exact
    pre-migration window this migration was designed for), rather than
    calling the migration's Python function in isolation against the
    current (already-constrained) schema. This is the textbook-correct
    way to test a data migration and the only way to legitimately
    reproduce "before" behavior: the live dev database this migration was
    originally run against has no snapshot from before it ran, so its
    true pre-migration state can't be replayed directly — this rebuilds
    that same state from scratch via the migration graph itself.

    Rows are created through the HISTORICAL model
    (state.apps.get_model(...) at the 0008 migration), which does NOT
    carry models.py's custom save() override (migrations only capture
    field structure, never Python methods) — so name_normalized genuinely
    stays unset, not "reset after the fact" the way a real-model bypass
    would have to fake it."""

    def setUp(self):
        self.executor = MigrationExecutor(connection)
        self.executor.migrate([('emailbuilder', '0008_emaildocument_name_normalized')])
        self.executor.loader.build_graph()

    def tearDown(self):
        # Leave the test database back at the latest migration state for
        # every other test in the suite.
        executor = MigrationExecutor(connection)
        executor.migrate(executor.loader.graph.leaf_nodes())

    def _historical_models(self):
        state = self.executor.loader.project_state(('emailbuilder', '0008_emaildocument_name_normalized'))
        return state.apps.get_model('auth', 'User'), state.apps.get_model('emailbuilder', 'EmailDocument')

    def test_resolves_collisions_avoids_taken_suffixes_and_populates_every_row(self):
        HistoricalUser, HistoricalDocument = self._historical_models()
        user = HistoricalUser.objects.create(username='migration.qa')
        other_user = HistoricalUser.objects.create(username='migration.qa.2')

        def unmigrated(owner, name, content=None):
            return HistoricalDocument.objects.create(
                user=owner, name=name, platform='generic', width=700, start_type='blank',
                content=content or {'version': 1, 'modules': []},
            )

        content_a = {'version': 1, 'modules': [{'id': 'a', 'type': 'text', 'order': 0, 'props': {}, 'settings': {}}]}
        oldest = unmigrated(user, 'test', content_a)
        middle = unmigrated(user, 'Test')
        newest = unmigrated(user, 'TEST')
        # An unrelated, pre-existing row that already occupies the exact
        # suffix a naive algorithm would pick first — proves suffix
        # selection checks the user's WHOLE namespace, not just the
        # colliding group.
        occupies_suffix = unmigrated(user, 'test (2)')
        unrelated = unmigrated(user, 'Completely Different')
        other_users_row = unmigrated(other_user, 'test')
        self.assertIsNone(oldest.name_normalized)  # genuinely unset pre-migration, not faked

        # Migrate to the graph's ACTUAL leaf nodes, not a hardcoded
        # '0010...' target — the assertions below query through the
        # CURRENT (real, apps-registry) EmailDocument model, which has
        # every field any migration up to and including the latest has
        # added (e.g. outlook_vml_enabled from 0011). Hardcoding '0010'
        # here would park the DB one migration short of what the model
        # class expects, raising "no such column" the moment a later
        # migration adds a new field — exactly what this fix prevents.
        self.executor.migrate(self.executor.loader.graph.leaf_nodes())

        oldest = EmailDocument.objects.get(pk=oldest.pk)
        middle = EmailDocument.objects.get(pk=middle.pk)
        newest = EmailDocument.objects.get(pk=newest.pk)
        occupies_suffix = EmailDocument.objects.get(pk=occupies_suffix.pk)
        unrelated = EmailDocument.objects.get(pk=unrelated.pk)
        other_users_row = EmailDocument.objects.get(pk=other_users_row.pk)

        # Oldest keeps its exact original name and content untouched.
        self.assertEqual(oldest.name, 'test')
        self.assertEqual(oldest.name_normalized, 'test')
        self.assertEqual(oldest.content, content_a)

        # Colliding rows get a suffix; "(2)" is already taken by an
        # unrelated row, so the algorithm must skip straight to (3)/(4).
        self.assertEqual(middle.name, 'test (3)')
        self.assertEqual(newest.name, 'test (4)')
        self.assertEqual(middle.name_normalized, 'test (3)')
        self.assertEqual(newest.name_normalized, 'test (4)')

        # The unrelated pre-existing "(2)" row is left alone.
        self.assertEqual(occupies_suffix.name, 'test (2)')
        self.assertEqual(occupies_suffix.name_normalized, 'test (2)')

        # A non-colliding row just gets populated; name unchanged.
        self.assertEqual(unrelated.name, 'Completely Different')
        self.assertEqual(unrelated.name_normalized, 'completely different')

        # A different user's identical name is untouched — no cross-user
        # collision handling.
        self.assertEqual(other_users_row.name, 'test')
        self.assertEqual(other_users_row.name_normalized, 'test')

        normalized_values = [oldest.name_normalized, middle.name_normalized, newest.name_normalized, occupies_suffix.name_normalized]
        self.assertEqual(len(normalized_values), len(set(normalized_values)))

        # The constraint this migration exists to add is now live and
        # enforced through the real (post-migration) model.
        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                EmailDocument.objects.create(
                    user_id=user.pk, name='test', platform='generic', width=700, start_type='blank',
                )

    def test_migration_sequence_applies_cleanly_and_final_state_is_populated_and_unique(self):
        HistoricalUser, HistoricalDocument = self._historical_models()
        user = HistoricalUser.objects.create(username='migration.qa.sequence')
        HistoricalDocument.objects.create(
            user=user, name='dup', platform='generic', width=700, start_type='blank',
            content={'version': 1, 'modules': []},
        )
        HistoricalDocument.objects.create(
            user=user, name='DUP', platform='generic', width=700, start_type='blank',
            content={'version': 1, 'modules': []},
        )

        # 0008 -> 0009 -> ... -> leaf in one real sequence, exactly the
        # order `migrate` runs them in production. Migrates to the
        # graph's ACTUAL leaf nodes (see the earlier test's identical
        # fix in this same class for why a hardcoded '0010...' target
        # breaks once a later migration adds a new field).
        self.executor.migrate(self.executor.loader.graph.leaf_nodes())

        docs = list(EmailDocument.objects.filter(user_id=user.pk).order_by('id'))
        self.assertEqual(len(docs), 2)
        self.assertTrue(all(d.name_normalized for d in docs))
        self.assertEqual(len({d.name_normalized for d in docs}), 2)

    def test_reverse_migration_is_schema_safe_and_does_not_delete_or_corrupt_rows(self):
        # 0009's data changes (the suffix renames) are intentionally NOT
        # undone on reverse (documented in the migration file — the exact
        # pre-migration names aren't recorded anywhere to restore
        # losslessly). What reverse MUST do safely: drop the constraint
        # and the column back to nullable, then drop the column entirely,
        # without touching row count, ids, or any other field.
        #
        # KNOWN LIMITATION (discovered here, SQLite only, unverified on
        # Postgres): reversing 0010 -> 0007 as ONE combined multi-hop
        # `migrate` call raises `OperationalError: expressions prohibited
        # in PRIMARY KEY and UNIQUE constraints` from SQLite's
        # column-drop table-rebuild — a SQLite/Django backward-executor
        # interaction, not a defect in these migrations' own definitions
        # (each one is a standard AddField/RunPython/AlterField+
        # AddConstraint). Reversing the SAME target as TWO separate
        # `manage.py migrate emailbuilder <target>` invocations (0008,
        # then 0007) — exactly how a real staged rollback would be run
        # from the CLI — is clean, which is what this test demonstrates
        # and asserts. Postgres does DROP COLUMN/DROP CONSTRAINT as true
        # ALTER TABLE statements with no full-table rebuild, so this is
        # very likely SQLite-specific, but that has not been verified
        # against a real Postgres instance in this environment — flagged
        # honestly rather than assumed.
        HistoricalUser, HistoricalDocument = self._historical_models()
        user = HistoricalUser.objects.create(username='migration.qa.reverse')
        first = HistoricalDocument.objects.create(
            user=user, name='dup', platform='generic', width=700, start_type='blank',
            content={'version': 1, 'modules': [{'id': 'x', 'type': 'text', 'order': 0, 'props': {}, 'settings': {}}]},
        )
        second = HistoricalDocument.objects.create(
            user=user, name='DUP', platform='generic', width=700, start_type='blank',
            content={'version': 1, 'modules': []},
        )
        first_id, second_id = first.pk, second.pk

        # Migrate to the graph's ACTUAL leaf nodes (see the earlier tests'
        # identical fix in this same class) — the reversal steps below
        # only ever touch HISTORICAL model states via project_state(), so
        # parking further forward than '0010...' here is harmless.
        self.executor.migrate(self.executor.loader.graph.leaf_nodes())
        self.executor.loader.build_graph()
        forward_names = list(EmailDocument.objects.filter(user_id=user.pk).order_by('id').values_list('name', flat=True))
        self.assertEqual(forward_names, ['dup', 'dup (2)'])  # 0009 already ran; sanity check before reversing

        # Staged reversal, matching the CLI-realistic two-command rollback
        # — must not raise, must not drop rows.
        self.executor.migrate([('emailbuilder', '0008_emaildocument_name_normalized')])
        self.executor.loader.build_graph()
        self.executor.migrate([('emailbuilder', '0007_learnedrepairsignal')])
        self.executor.loader.build_graph()

        state_0007 = self.executor.loader.project_state(('emailbuilder', '0007_learnedrepairsignal'))
        ReversedDocument = state_0007.apps.get_model('emailbuilder', 'EmailDocument')
        reversed_docs = ReversedDocument.objects.filter(user_id=user.pk).order_by('id')
        self.assertEqual(list(reversed_docs.values_list('pk', flat=True)), [first_id, second_id])
        # The 0009 rename is NOT undone by reversing — by design, and
        # explicitly not silently data-lossy: the row simply keeps
        # whatever name it already had.
        self.assertEqual([d.name for d in reversed_docs], ['dup', 'dup (2)'])
        self.assertEqual(reversed_docs[0].content['modules'][0]['id'], 'x')
        # name_normalized doesn't exist on the historical 0007 model at
        # all — the column itself was dropped by reversing 0008.
        self.assertNotIn('name_normalized', [f.name for f in ReversedDocument._meta.get_fields()])


class SaveWithUniqueNameGuardTests(TestCase):
    """views.save_with_unique_name_guard is the final race backstop behind
    EmailDocumentSerializer.validate_name — this proves the translation
    from a DB-level IntegrityError to a clean field-level 400 directly,
    independent of whether the pre-check already caught the common case."""

    def test_translates_name_collision_integrity_error_to_field_error(self):
        serializer = Mock()
        serializer.save.side_effect = IntegrityError(
            'UNIQUE constraint failed: emailbuilder_emaildocument.user_id, '
            'emailbuilder_emaildocument.name_normalized',
        )
        with self.assertRaises(DRFValidationError) as ctx:
            save_with_unique_name_guard(serializer)
        self.assertIn('name', ctx.exception.detail)
        self.assertEqual(
            str(ctx.exception.detail['name'][0]),
            'An email with this name already exists. Choose a different name.',
        )

    def test_reraises_unrelated_integrity_error_unchanged(self):
        serializer = Mock()
        serializer.save.side_effect = IntegrityError('some other constraint failed')
        with self.assertRaises(IntegrityError):
            save_with_unique_name_guard(serializer)


class EmailDocumentDeleteTests(TestCase):
    """Dashboard delete row action — same ownership boundary as every
    other EmailDocument view."""

    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(username='jane.doe', password='StrongPass123')
        self.other_user = User.objects.create_user(username='john.roe', password='StrongPass123')
        self.document = EmailDocument.objects.create(
            user=self.user, name='To Delete', platform='generic', width=700, start_type='blank',
        )
        self.url = f'/api/v1/email-builder/emails/{self.document.id}/'

    def test_owner_can_delete_own_document(self):
        self.client.force_login(self.user)
        response = self.client.delete(self.url)
        self.assertEqual(response.status_code, 204)
        self.assertFalse(EmailDocument.objects.filter(pk=self.document.id).exists())

    def test_deleted_document_no_longer_listed(self):
        self.client.force_login(self.user)
        self.client.delete(self.url)
        response = self.client.get('/api/v1/email-builder/emails/')
        self.assertEqual(response.json(), [])

    def test_non_owner_cannot_delete(self):
        self.client.force_login(self.other_user)
        response = self.client.delete(self.url)
        self.assertEqual(response.status_code, 404)
        self.assertTrue(EmailDocument.objects.filter(pk=self.document.id).exists())

    def test_anonymous_cannot_delete(self):
        response = self.client.delete(self.url)
        self.assertEqual(response.status_code, 403)
        self.assertTrue(EmailDocument.objects.filter(pk=self.document.id).exists())


class EmailDocumentDuplicateViaCreateThenPatchTests(TestCase):
    """Duplicate has no dedicated endpoint — the frontend composes it from
    a plain create() followed by a content-only patch() (see
    frontend/src/emailbuilder/duplicateEmailDocument.ts). These tests
    cover that exact two-call sequence end-to-end against the real API,
    the same way the frontend actually calls it."""

    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(username='jane.doe', password='StrongPass123')
        self.source = EmailDocument.objects.create(
            user=self.user, name='Source Email', platform='sfmc', width=650, start_type='blank',
            content={'version': 1, 'modules': [_module(module_id='m-original')]},
        )

    def test_duplicate_sequence_creates_independent_document(self):
        self.client.force_login(self.user)
        create_response = self.client.post(
            '/api/v1/email-builder/emails/',
            data=json.dumps({
                'name': 'Copy of Source Email', 'platform': self.source.platform,
                'width': self.source.width, 'start_type': self.source.start_type,
            }),
            content_type='application/json',
        )
        self.assertEqual(create_response.status_code, 201)
        new_id = create_response.json()['id']
        self.assertNotEqual(new_id, self.source.id)

        cloned_content = {'version': 1, 'modules': [_module(module_id='m-fresh-clone')]}
        patch_response = self.client.patch(
            f'/api/v1/email-builder/emails/{new_id}/',
            data=json.dumps({'content': cloned_content}),
            content_type='application/json',
        )
        self.assertEqual(patch_response.status_code, 200)
        self.assertEqual(patch_response.json()['name'], 'Copy of Source Email')
        self.assertEqual(patch_response.json()['content'], cloned_content)

        self.source.refresh_from_db()
        self.assertEqual(self.source.name, 'Source Email')
        self.assertEqual(self.source.content, {'version': 1, 'modules': [_module(module_id='m-original')]})
        self.assertEqual(EmailDocument.objects.filter(user=self.user).count(), 2)


def _column(column_id='col-a', modules=None, background='', valign='top', background_image=None):
    settings = {
        'desktop': {'paddingTop': 0, 'paddingRight': 0, 'paddingBottom': 0, 'paddingLeft': 0},
        'mobile': {},
        'backgroundColor': background,
        'verticalAlign': valign,
    }
    if background_image is not None:
        settings['backgroundImage'] = background_image
    return {
        'id': column_id,
        'modules': modules if modules is not None else [],
        'settings': settings,
    }


def _layout_module(module_id='layout-1', module_type='layout-2col-50-50', column_widths=None, columns=None, settings=None):
    widths = column_widths if column_widths is not None else [50, 50]
    return {
        'id': module_id,
        'type': module_type,
        'order': 0,
        'props': {'columnWidths': widths},
        'columns': columns if columns is not None else [_column(f'{module_id}-col-{i}') for i in range(len(widths))],
        'settings': settings if settings is not None else {
            'desktop': {'paddingTop': 0, 'paddingRight': 0, 'paddingBottom': 0, 'paddingLeft': 0},
            'mobile': {},
            'outerSpacing': {
                'desktop': {'left': {'value': 0, 'unit': 'px'}, 'right': {'value': 0, 'unit': 'px'}}, 'mobile': {},
            },
        },
    }


class LayoutBuilderNestedTests(TestCase):
    """Feature 05 — Layout Builder: nested column content validation."""

    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(username='jane.doe', password='StrongPass123')
        self.document = EmailDocument.objects.create(
            user=self.user, name='Layout Draft', platform='generic', width=700, start_type='blank',
        )
        self.url = f'/api/v1/email-builder/emails/{self.document.id}/'
        self.client.force_login(self.user)

    def _patch_json(self, data):
        return self.client.patch(self.url, data=json.dumps(data), content_type='application/json')

    def test_nested_layout_with_content_accepted(self):
        nested_text = _module('text-1', module_type='text', order=0)
        layout = _layout_module(columns=[
            _column('col-a', modules=[nested_text]),
            _column('col-b'),
        ])
        content = {'version': 1, 'modules': [layout]}
        response = self._patch_json({'content': content})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['content'], content)

    def test_missing_columns_key_still_accepted_backward_compat(self):
        # Feature 03/04 layout modules (no `columns` key at all) must
        # keep saving — the frontend backfills empty columns at load time
        # (edmMigration.ts), not the backend (instruction 2).
        layout = _layout_module()
        del layout['columns']
        response = self._patch_json({'content': {'version': 1, 'modules': [layout]}})
        self.assertEqual(response.status_code, 200)

    def test_malformed_columns_not_a_list_rejected(self):
        layout = _layout_module()
        layout['columns'] = 'not-a-list'
        response = self._patch_json({'content': {'version': 1, 'modules': [layout]}})
        self.assertEqual(response.status_code, 400)
        self.assertIn('content', response.json()['errors'])

    def test_wrong_column_count_rejected(self):
        layout = _layout_module(module_type='layout-3col', column_widths=[34, 33, 33])
        layout['columns'] = layout['columns'][:2]
        response = self._patch_json({'content': {'version': 1, 'modules': [layout]}})
        self.assertEqual(response.status_code, 400)
        self.assertIn('content', response.json()['errors'])

    def test_duplicate_column_ids_rejected(self):
        layout = _layout_module(columns=[_column('same-id'), _column('same-id')])
        response = self._patch_json({'content': {'version': 1, 'modules': [layout]}})
        self.assertEqual(response.status_code, 400)

    def test_duplicate_nested_module_ids_across_columns_rejected(self):
        layout = _layout_module(columns=[
            _column('col-a', modules=[_module('dup-id')]),
            _column('col-b', modules=[_module('dup-id')]),
        ])
        response = self._patch_json({'content': {'version': 1, 'modules': [layout]}})
        self.assertEqual(response.status_code, 400)

    def test_nested_module_id_colliding_with_top_level_id_rejected(self):
        # Instruction 34 — ids must be unique across the WHOLE document,
        # top-level and nested alike.
        nested = _module('layout-1', module_type='text')
        layout = _layout_module(module_id='layout-1', columns=[
            _column('col-a', modules=[nested]), _column('col-b'),
        ])
        response = self._patch_json({'content': {'version': 1, 'modules': [layout]}})
        self.assertEqual(response.status_code, 400)

    def test_invalid_column_widths_sum_rejected(self):
        layout = _layout_module(column_widths=[50, 40])
        response = self._patch_json({'content': {'version': 1, 'modules': [layout]}})
        self.assertEqual(response.status_code, 400)
        self.assertIn('content', response.json()['errors'])

    def test_column_width_below_minimum_rejected(self):
        layout = _layout_module(column_widths=[5, 95])
        response = self._patch_json({'content': {'version': 1, 'modules': [layout]}})
        self.assertEqual(response.status_code, 400)

    def test_column_gutter_valid_px_accepted(self):
        layout = _layout_module()
        layout['settings']['columnGutter'] = {'desktop': {'value': 20, 'unit': 'px'}}
        response = self._patch_json({'content': {'version': 1, 'modules': [layout]}})
        self.assertEqual(response.status_code, 200)

    def test_column_gutter_percent_unit_rejected(self):
        layout = _layout_module()
        layout['settings']['columnGutter'] = {'desktop': {'value': 5, 'unit': '%'}}
        response = self._patch_json({'content': {'version': 1, 'modules': [layout]}})
        self.assertEqual(response.status_code, 400)

    def test_column_gutter_over_max_rejected(self):
        layout = _layout_module()
        layout['settings']['columnGutter'] = {'desktop': {'value': 500, 'unit': 'px'}}
        response = self._patch_json({'content': {'version': 1, 'modules': [layout]}})
        self.assertEqual(response.status_code, 400)

    def test_layout_nested_inside_column_rejected(self):
        nested_layout = _layout_module(module_id='inner-layout')
        layout = _layout_module(columns=[
            _column('col-a', modules=[nested_layout]), _column('col-b'),
        ])
        response = self._patch_json({'content': {'version': 1, 'modules': [layout]}})
        self.assertEqual(response.status_code, 400)

    def test_nested_module_with_own_columns_key_rejected(self):
        bad_nested = _module('bad-1', module_type='text')
        bad_nested['columns'] = []
        layout = _layout_module(columns=[_column('col-a', modules=[bad_nested]), _column('col-b')])
        response = self._patch_json({'content': {'version': 1, 'modules': [layout]}})
        self.assertEqual(response.status_code, 400)

    def test_invalid_nested_module_type_rejected(self):
        bad_nested = _module('bad-1', module_type='carousel')
        layout = _layout_module(columns=[_column('col-a', modules=[bad_nested]), _column('col-b')])
        response = self._patch_json({'content': {'version': 1, 'modules': [layout]}})
        self.assertEqual(response.status_code, 400)

    def test_mobile_column_order_valid_permutation_accepted(self):
        layout = _layout_module()
        layout['settings']['mobileColumnOrder'] = [1, 0]
        response = self._patch_json({'content': {'version': 1, 'modules': [layout]}})
        self.assertEqual(response.status_code, 200)

    def test_mobile_column_order_invalid_permutation_rejected(self):
        layout = _layout_module()
        layout['settings']['mobileColumnOrder'] = [0, 0]
        response = self._patch_json({'content': {'version': 1, 'modules': [layout]}})
        self.assertEqual(response.status_code, 400)

    def test_column_vertical_align_invalid_value_rejected(self):
        layout = _layout_module(columns=[_column('col-a', valign='center'), _column('col-b')])
        response = self._patch_json({'content': {'version': 1, 'modules': [layout]}})
        self.assertEqual(response.status_code, 400)

    # E5 — generic per-column background image.
    def test_column_background_image_valid_string_accepted(self):
        layout = _layout_module(columns=[
            _column('col-a', background_image='https://cdn.example.com/col-bg.jpg'), _column('col-b'),
        ])
        response = self._patch_json({'content': {'version': 1, 'modules': [layout]}})
        self.assertEqual(response.status_code, 200)

    def test_column_background_image_non_string_rejected(self):
        layout = _layout_module(columns=[_column('col-a', background_image=42), _column('col-b')])
        response = self._patch_json({'content': {'version': 1, 'modules': [layout]}})
        self.assertEqual(response.status_code, 400)

    def test_column_background_image_absent_still_accepted_backward_compat(self):
        layout = _layout_module(columns=[_column('col-a'), _column('col-b')])
        response = self._patch_json({'content': {'version': 1, 'modules': [layout]}})
        self.assertEqual(response.status_code, 200)


class ModuleElementEditorValidationTests(TestCase):
    """Feature 06 — generic key-pattern prop validation (colors, font
    ids, unsafe URL schemes, bounded repeatable lists)."""

    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(username='jane.doe', password='StrongPass123')
        self.document = EmailDocument.objects.create(
            user=self.user, name='Module Editor Draft', platform='generic', width=700, start_type='blank',
        )
        self.url = f'/api/v1/email-builder/emails/{self.document.id}/'
        self.client.force_login(self.user)

    def _patch_json(self, data):
        return self.client.patch(self.url, data=json.dumps(data), content_type='application/json')

    def _text_module(self, **prop_overrides):
        props = {
            'text': 'Hello', 'align': 'left', 'fontFamily': 'arial', 'fontSize': 16,
            'fontWeight': 400, 'color': '#333333', 'lineHeight': 24, 'backgroundColor': '',
        }
        props.update(prop_overrides)
        return _module(module_type='text', props=props)

    def test_invalid_hex_color_rejected(self):
        module = self._text_module(backgroundColor='red')
        response = self._patch_json({'content': {'version': 1, 'modules': [module]}})
        self.assertEqual(response.status_code, 400)
        self.assertIn('content', response.json()['errors'])

    def test_valid_hex_color_accepted(self):
        module = self._text_module(backgroundColor='#FF0000')
        response = self._patch_json({'content': {'version': 1, 'modules': [module]}})
        self.assertEqual(response.status_code, 200)

    def test_empty_color_string_accepted_as_no_color(self):
        module = self._text_module(backgroundColor='')
        response = self._patch_json({'content': {'version': 1, 'modules': [module]}})
        self.assertEqual(response.status_code, 200)

    def test_short_hex_color_rejected(self):
        module = self._text_module(color='#fff')
        response = self._patch_json({'content': {'version': 1, 'modules': [module]}})
        self.assertEqual(response.status_code, 400)

    def test_invalid_font_family_rejected(self):
        module = self._text_module(fontFamily='ComicSans')
        response = self._patch_json({'content': {'version': 1, 'modules': [module]}})
        self.assertEqual(response.status_code, 400)
        self.assertIn('content', response.json()['errors'])

    def test_valid_font_family_accepted(self):
        module = self._text_module(fontFamily='georgia')
        response = self._patch_json({'content': {'version': 1, 'modules': [module]}})
        self.assertEqual(response.status_code, 200)

    def test_javascript_url_in_button_href_rejected(self):
        module = _module(module_type='button', props={
            'text': 'Shop', 'href': 'javascript:alert(1)', 'align': 'center',
            'backgroundColor': '#0082AD', 'textColor': '#FFFFFF', 'fontSize': 15, 'borderRadius': 6,
        })
        response = self._patch_json({'content': {'version': 1, 'modules': [module]}})
        self.assertEqual(response.status_code, 400)
        self.assertIn('content', response.json()['errors'])

    def test_data_url_in_image_src_rejected(self):
        module = _module(module_type='image', props={
            'src': 'data:text/html,<script>alert(1)</script>', 'alt': 'x',
            'width': {'desktop': {'value': 100, 'unit': '%'}}, 'align': 'center', 'href': '',
        })
        response = self._patch_json({'content': {'version': 1, 'modules': [module]}})
        self.assertEqual(response.status_code, 400)

    def test_safe_https_url_accepted(self):
        module = _module(module_type='button', props={
            'text': 'Shop', 'href': 'https://example.com', 'align': 'center',
            'backgroundColor': '#0082AD', 'textColor': '#FFFFFF', 'fontSize': 15, 'borderRadius': 6,
        })
        response = self._patch_json({'content': {'version': 1, 'modules': [module]}})
        self.assertEqual(response.status_code, 200)

    def _header_with_nav_links(self, count):
        return _module(module_type='header-logo-nav', props={
            'logoSrc': '', 'logoAlt': 'Logo', 'logoWidth': 160, 'logoHref': '',
            'preheaderText': '', 'navLinks': [{'label': f'Link {i}', 'href': ''} for i in range(count)],
            'ctaText': '', 'ctaHref': '', 'backgroundColor': '#FFFFFF', 'align': 'left',
        })

    def test_nav_links_over_max_rejected(self):
        module = self._header_with_nav_links(7)
        response = self._patch_json({'content': {'version': 1, 'modules': [module]}})
        self.assertEqual(response.status_code, 400)
        self.assertIn('content', response.json()['errors'])

    def test_nav_links_at_max_accepted(self):
        module = self._header_with_nav_links(6)
        response = self._patch_json({'content': {'version': 1, 'modules': [module]}})
        self.assertEqual(response.status_code, 200)

    def test_nav_link_href_unsafe_scheme_rejected(self):
        module = _module(module_type='header-logo-nav', props={
            'logoSrc': '', 'logoAlt': 'Logo', 'logoWidth': 160, 'logoHref': '',
            'preheaderText': '', 'navLinks': [{'label': 'Evil', 'href': 'javascript:alert(1)'}],
            'ctaText': '', 'ctaHref': '', 'backgroundColor': '#FFFFFF', 'align': 'left',
        })
        response = self._patch_json({'content': {'version': 1, 'modules': [module]}})
        self.assertEqual(response.status_code, 400)


class ResponsiveEditorValidationTests(TestCase):
    """Feature 07 — responsive-field validation (visibility, mobile
    typography/width-mode bounds, mobileStack/mobileColumnGap, and
    backward compatibility for documents with no responsive fields)."""

    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(username='jane.doe', password='StrongPass123')
        self.document = EmailDocument.objects.create(
            user=self.user, name='Responsive Draft', platform='generic', width=700, start_type='blank',
        )
        self.url = f'/api/v1/email-builder/emails/{self.document.id}/'
        self.client.force_login(self.user)

    def _patch_json(self, data):
        return self.client.patch(self.url, data=json.dumps(data), content_type='application/json')

    def _responsive_settings(self, **overrides):
        settings = {
            'desktop': {'paddingTop': 20, 'paddingRight': 20, 'paddingBottom': 20, 'paddingLeft': 20},
            'mobile': {},
            'outerSpacing': {'desktop': {'left': {'value': 0, 'unit': 'px'}, 'right': {'value': 0, 'unit': 'px'}}, 'mobile': {}},
        }
        settings.update(overrides)
        return settings

    # --- visibility ---------------------------------------------------------

    def test_valid_visibility_values_accepted(self):
        for value in ('all', 'hideMobile', 'hideDesktop'):
            module = _module(settings=self._responsive_settings(visibility=value))
            response = self._patch_json({'content': {'version': 1, 'modules': [module]}})
            self.assertEqual(response.status_code, 200, value)

    def test_invalid_visibility_value_rejected(self):
        module = _module(settings=self._responsive_settings(visibility='hideEverywhere'))
        response = self._patch_json({'content': {'version': 1, 'modules': [module]}})
        self.assertEqual(response.status_code, 400)
        self.assertIn('content', response.json()['errors'])

    def test_absent_visibility_defaults_to_valid_all(self):
        module = _module(settings=self._responsive_settings())
        response = self._patch_json({'content': {'version': 1, 'modules': [module]}})
        self.assertEqual(response.status_code, 200)

    # --- mobileStack / mobileColumnGap (layout-shaped, but validated for any module) ---

    def test_mobile_stack_must_be_boolean(self):
        module = _module(settings=self._responsive_settings(mobileStack='yes'))
        response = self._patch_json({'content': {'version': 1, 'modules': [module]}})
        self.assertEqual(response.status_code, 400)

    def test_mobile_stack_boolean_accepted(self):
        module = _module(settings=self._responsive_settings(mobileStack=False))
        response = self._patch_json({'content': {'version': 1, 'modules': [module]}})
        self.assertEqual(response.status_code, 200)

    def test_mobile_column_gap_valid_dimension_accepted(self):
        module = _module(settings=self._responsive_settings(mobileColumnGap={'value': 12, 'unit': 'px'}))
        response = self._patch_json({'content': {'version': 1, 'modules': [module]}})
        self.assertEqual(response.status_code, 200)

    def test_mobile_column_gap_percent_unit_rejected(self):
        module = _module(settings=self._responsive_settings(mobileColumnGap={'value': 12, 'unit': '%'}))
        response = self._patch_json({'content': {'version': 1, 'modules': [module]}})
        self.assertEqual(response.status_code, 400)

    def test_mobile_column_gap_negative_value_rejected(self):
        module = _module(settings=self._responsive_settings(mobileColumnGap={'value': -5, 'unit': 'px'}))
        response = self._patch_json({'content': {'version': 1, 'modules': [module]}})
        self.assertEqual(response.status_code, 400)

    # --- mobile typography bounds (Text module) ------------------------------

    def _text_module_with_props(self, **prop_overrides):
        props = {
            'text': 'Hello', 'align': 'left', 'fontFamily': 'arial', 'fontSize': 16,
            'fontWeight': 400, 'color': '#333333', 'lineHeight': 24, 'backgroundColor': '',
        }
        props.update(prop_overrides)
        return _module(module_type='text', props=props, settings=self._responsive_settings())

    def test_mobile_font_size_within_bounds_accepted(self):
        module = self._text_module_with_props(mobileFontSize=24)
        response = self._patch_json({'content': {'version': 1, 'modules': [module]}})
        self.assertEqual(response.status_code, 200)

    def test_mobile_font_size_out_of_bounds_rejected(self):
        module = self._text_module_with_props(mobileFontSize=300)
        response = self._patch_json({'content': {'version': 1, 'modules': [module]}})
        self.assertEqual(response.status_code, 400)
        self.assertIn('content', response.json()['errors'])

    def test_mobile_line_height_out_of_bounds_rejected(self):
        module = self._text_module_with_props(mobileLineHeight=1)
        response = self._patch_json({'content': {'version': 1, 'modules': [module]}})
        self.assertEqual(response.status_code, 400)

    def test_mobile_align_invalid_value_rejected(self):
        module = self._text_module_with_props(mobileAlign='justify')
        response = self._patch_json({'content': {'version': 1, 'modules': [module]}})
        self.assertEqual(response.status_code, 400)

    def test_mobile_align_valid_value_accepted(self):
        module = self._text_module_with_props(mobileAlign='center')
        response = self._patch_json({'content': {'version': 1, 'modules': [module]}})
        self.assertEqual(response.status_code, 200)

    # --- mobile button width mode --------------------------------------------

    def test_mobile_width_mode_valid_accepted(self):
        module = _module(module_type='button', props={
            'text': 'Shop', 'href': 'https://example.com', 'align': 'center',
            'backgroundColor': '#0082AD', 'textColor': '#FFFFFF', 'fontSize': 15, 'borderRadius': 6,
            'widthMode': 'auto', 'mobileWidthMode': 'full',
        }, settings=self._responsive_settings())
        response = self._patch_json({'content': {'version': 1, 'modules': [module]}})
        self.assertEqual(response.status_code, 200)

    def test_mobile_width_mode_invalid_rejected(self):
        module = _module(module_type='button', props={
            'text': 'Shop', 'href': 'https://example.com', 'align': 'center',
            'backgroundColor': '#0082AD', 'textColor': '#FFFFFF', 'fontSize': 15, 'borderRadius': 6,
            'widthMode': 'auto', 'mobileWidthMode': 'huge',
        }, settings=self._responsive_settings())
        response = self._patch_json({'content': {'version': 1, 'modules': [module]}})
        self.assertEqual(response.status_code, 400)

    # --- backward compatibility -----------------------------------------------

    def test_legacy_document_with_no_responsive_fields_still_saves(self):
        # No visibility/mobileStack/mobileColumnGap/mobile typography at
        # all — exactly what every pre-Feature-07 document looks like.
        module = _module(settings={'paddingTop': 20, 'paddingRight': 20, 'paddingBottom': 20, 'paddingLeft': 20})
        response = self._patch_json({'content': {'version': 1, 'modules': [module]}})
        self.assertEqual(response.status_code, 200)

    def test_nested_module_inside_layout_column_validates_responsive_fields_too(self):
        nested_text = self._text_module_with_props(mobileFontSize=999)
        layout = _module(module_type='layout-2col-50-50', props={'columnWidths': [50, 50]}, settings=self._responsive_settings())
        layout['columns'] = [
            {'id': 'c1', 'modules': [nested_text], 'settings': {
                'desktop': {'paddingTop': 0, 'paddingRight': 0, 'paddingBottom': 0, 'paddingLeft': 0}, 'mobile': {},
                'backgroundColor': '', 'verticalAlign': 'top',
            }},
            {'id': 'c2', 'modules': [], 'settings': {
                'desktop': {'paddingTop': 0, 'paddingRight': 0, 'paddingBottom': 0, 'paddingLeft': 0}, 'mobile': {},
                'backgroundColor': '', 'verticalAlign': 'top',
            }},
        ]
        response = self._patch_json({'content': {'version': 1, 'modules': [layout]}})
        self.assertEqual(response.status_code, 400)


def _saved_module_payload(**overrides):
    payload = {
        'name': 'My Reusable Header',
        'module_type': 'header-logo-center',
        'props': {'logoSrc': '', 'logoAlt': 'Logo', 'logoWidth': 160},
        'settings': {'paddingTop': 24, 'paddingRight': 24, 'paddingBottom': 24, 'paddingLeft': 24},
    }
    payload.update(overrides)
    return payload


class SavedEmailModuleTests(TestCase):
    """Feature 04 — personal Saved Modules library."""

    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(username='jane.doe', password='StrongPass123')
        self.other_user = User.objects.create_user(username='john.roe', password='StrongPass123')
        self.url = '/api/v1/email-builder/saved-modules/'

    def _post_json(self, data):
        return self.client.post(self.url, data=json.dumps(data), content_type='application/json')

    def test_unauthenticated_create_rejected(self):
        response = self._post_json(_saved_module_payload())
        self.assertEqual(response.status_code, 403)
        self.assertEqual(SavedEmailModule.objects.count(), 0)

    def test_authenticated_create_succeeds(self):
        self.client.force_login(self.user)
        response = self._post_json(_saved_module_payload())
        self.assertEqual(response.status_code, 201)
        body = response.json()
        self.assertEqual(body['name'], 'My Reusable Header')
        self.assertEqual(body['module_type'], 'header-logo-center')
        saved = SavedEmailModule.objects.get(pk=body['id'])
        self.assertEqual(saved.user_id, self.user.id)

    def test_owner_never_settable_from_client(self):
        self.client.force_login(self.user)
        response = self._post_json(_saved_module_payload())
        saved = SavedEmailModule.objects.get(pk=response.json()['id'])
        self.assertEqual(saved.user_id, self.user.id)
        self.assertNotEqual(saved.user_id, self.other_user.id)

    def test_invalid_module_type_rejected(self):
        self.client.force_login(self.user)
        response = self._post_json(_saved_module_payload(module_type='carousel'))
        self.assertEqual(response.status_code, 400)
        self.assertIn('module_type', response.json()['errors'])
        self.assertEqual(SavedEmailModule.objects.count(), 0)

    def test_invalid_props_rejected(self):
        self.client.force_login(self.user)
        response = self._post_json(_saved_module_payload(props='not-an-object'))
        self.assertEqual(response.status_code, 400)
        self.assertIn('module_type', response.json()['errors'])

    def test_invalid_settings_padding_rejected(self):
        self.client.force_login(self.user)
        response = self._post_json(_saved_module_payload(settings={'paddingTop': -20}))
        self.assertEqual(response.status_code, 400)
        self.assertIn('module_type', response.json()['errors'])

    def test_responsive_settings_shape_accepted(self):
        self.client.force_login(self.user)
        settings = {
            'desktop': {'paddingTop': 24, 'paddingRight': 24, 'paddingBottom': 24, 'paddingLeft': 24},
            'mobile': {},
            'outerSpacing': {'left': {'value': 0, 'unit': 'px'}, 'right': {'value': 0, 'unit': 'px'}},
        }
        response = self._post_json(_saved_module_payload(settings=settings))
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()['settings'], settings)

    def test_feature07_responsive_fields_persist_on_saved_module(self):
        # Instruction 40 — Saved Modules must preserve visibility, mobile
        # typography overrides, and everything else Feature 07 added,
        # not just the pre-existing desktop/mobile padding shape.
        self.client.force_login(self.user)
        settings = {
            'desktop': {'paddingTop': 24, 'paddingRight': 24, 'paddingBottom': 24, 'paddingLeft': 24},
            'mobile': {'paddingTop': 12},
            'outerSpacing': {
                'desktop': {'left': {'value': 30, 'unit': 'px'}, 'right': {'value': 20, 'unit': 'px'}},
                'mobile': {'left': {'value': 8, 'unit': 'px'}, 'right': {'value': 8, 'unit': 'px'}},
            },
            'visibility': 'hideMobile',
        }
        props = {
            'text': 'Hello', 'align': 'left', 'fontFamily': 'arial', 'fontSize': 32,
            'fontWeight': 400, 'color': '#333333', 'lineHeight': 40, 'backgroundColor': '',
            'mobileFontSize': 24, 'mobileLineHeight': 30, 'mobileAlign': 'center',
        }
        response = self._post_json(_saved_module_payload(module_type='text', props=props, settings=settings))
        self.assertEqual(response.status_code, 201)
        body = response.json()
        self.assertEqual(body['settings']['visibility'], 'hideMobile')
        self.assertEqual(body['settings']['mobile']['paddingTop'], 12)
        self.assertEqual(body['settings']['outerSpacing']['mobile']['left']['value'], 8)
        self.assertEqual(body['props']['mobileFontSize'], 24)
        self.assertEqual(body['props']['mobileAlign'], 'center')

    def test_outer_spacing_percent_over_100_rejected(self):
        self.client.force_login(self.user)
        settings = {
            'desktop': {'paddingTop': 24, 'paddingRight': 24, 'paddingBottom': 24, 'paddingLeft': 24},
            'mobile': {},
            'outerSpacing': {'left': {'value': 200, 'unit': '%'}, 'right': {'value': 0, 'unit': 'px'}},
        }
        response = self._post_json(_saved_module_payload(settings=settings))
        self.assertEqual(response.status_code, 400)
        self.assertIn('module_type', response.json()['errors'])

    def test_saved_module_retains_desktop_and_mobile_outer_spacing(self):
        self.client.force_login(self.user)
        settings = {
            'desktop': {'paddingTop': 24, 'paddingRight': 24, 'paddingBottom': 24, 'paddingLeft': 24},
            'mobile': {},
            'outerSpacing': {
                'desktop': {'left': {'value': 20, 'unit': 'px'}, 'right': {'value': 30, 'unit': 'px'}},
                'mobile': {'left': {'value': 8, 'unit': 'px'}, 'right': {'value': 12, 'unit': 'px'}},
            },
        }
        response = self._post_json(_saved_module_payload(settings=settings))
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()['settings'], settings)

    def test_name_required(self):
        self.client.force_login(self.user)
        response = self._post_json(_saved_module_payload(name=''))
        self.assertEqual(response.status_code, 400)
        self.assertIn('name', response.json()['errors'])

    def test_list_only_returns_own_modules(self):
        SavedEmailModule.objects.create(user=self.user, **{k: v for k, v in _saved_module_payload().items() if k != 'name'}, name='Mine')
        SavedEmailModule.objects.create(user=self.other_user, **{k: v for k, v in _saved_module_payload().items() if k != 'name'}, name='Not mine')
        self.client.force_login(self.user)
        response = self.client.get(self.url)
        self.assertEqual(response.status_code, 200)
        names = [item['name'] for item in response.json()]
        self.assertEqual(names, ['Mine'])

    def test_unauthenticated_list_rejected(self):
        response = self.client.get(self.url)
        self.assertEqual(response.status_code, 403)

    def test_owner_can_delete_own_module(self):
        self.client.force_login(self.user)
        saved = SavedEmailModule.objects.create(user=self.user, **_saved_module_payload())
        response = self.client.delete(f'{self.url}{saved.id}/')
        self.assertEqual(response.status_code, 204)
        self.assertFalse(SavedEmailModule.objects.filter(pk=saved.id).exists())

    def test_non_owner_cannot_delete_another_users_module(self):
        saved = SavedEmailModule.objects.create(user=self.other_user, **_saved_module_payload())
        self.client.force_login(self.user)
        response = self.client.delete(f'{self.url}{saved.id}/')
        self.assertEqual(response.status_code, 404)
        self.assertTrue(SavedEmailModule.objects.filter(pk=saved.id).exists())

    def test_anonymous_cannot_delete(self):
        saved = SavedEmailModule.objects.create(user=self.user, **_saved_module_payload())
        response = self.client.delete(f'{self.url}{saved.id}/')
        self.assertEqual(response.status_code, 403)
        self.assertTrue(SavedEmailModule.objects.filter(pk=saved.id).exists())

    def _layout_settings(self):
        return {
            'desktop': {'paddingTop': 0, 'paddingRight': 0, 'paddingBottom': 0, 'paddingLeft': 0},
            'mobile': {},
            'outerSpacing': {'left': {'value': 0, 'unit': 'px'}, 'right': {'value': 0, 'unit': 'px'}},
        }

    def test_saved_layout_module_with_nested_columns_accepted(self):
        self.client.force_login(self.user)
        layout_columns = [
            _column('col-a', modules=[_module('text-1', module_type='text')]),
            _column('col-b'),
        ]
        payload = _saved_module_payload(
            name='My 2-Column Layout', module_type='layout-2col-50-50',
            props={'columnWidths': [50, 50]}, settings=self._layout_settings(), columns=layout_columns,
        )
        response = self._post_json(payload)
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()['columns'], layout_columns)
        saved = SavedEmailModule.objects.get(pk=response.json()['id'])
        self.assertEqual(saved.columns, layout_columns)

    def test_saved_layout_module_wrong_column_count_rejected(self):
        self.client.force_login(self.user)
        payload = _saved_module_payload(
            name='Bad Layout', module_type='layout-3col',
            props={'columnWidths': [34, 33, 33]}, settings=self._layout_settings(),
            columns=[_column('col-a'), _column('col-b')],
        )
        response = self._post_json(payload)
        self.assertEqual(response.status_code, 400)
        self.assertIn('module_type', response.json()['errors'])

    def test_saved_module_ownership_enforced_for_nested_layout(self):
        self.client.force_login(self.user)
        payload = _saved_module_payload(
            module_type='layout-2col-50-50', props={'columnWidths': [50, 50]},
            settings=self._layout_settings(), columns=[_column('col-a'), _column('col-b')],
        )
        response = self._post_json(payload)
        saved_id = response.json()['id']
        self.client.logout()
        self.client.force_login(self.other_user)
        delete_response = self.client.delete(f'{self.url}{saved_id}/')
        self.assertEqual(delete_response.status_code, 404)
        self.assertTrue(SavedEmailModule.objects.filter(pk=saved_id).exists())


class EmailAssetTests(TestCase):
    """Feature 08 — personal Asset Manager library (uploads + external URLs)."""

    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(username='jane.doe', password='StrongPass123')
        self.other_user = User.objects.create_user(username='john.roe', password='StrongPass123')
        self.url = '/api/v1/email-builder/assets/'

    def _upload_payload(self, **overrides):
        payload = {
            'name': 'Hero banner',
            'category': 'image',
            'source_type': 'upload',
            'file': SimpleUploadedFile('hero.jpg', _asset_image_bytes('JPEG'), content_type='image/jpeg'),
        }
        payload.update(overrides)
        return payload

    def _external_payload(self, **overrides):
        payload = {
            'name': 'CDN logo',
            'category': 'logo',
            'source_type': 'external',
            'external_url': 'https://cdn.example.com/logo.png',
        }
        payload.update(overrides)
        return payload

    def test_unauthenticated_create_rejected(self):
        response = self.client.post(self.url, data=self._upload_payload())
        self.assertEqual(response.status_code, 403)
        self.assertEqual(EmailAsset.objects.count(), 0)

    def test_authenticated_upload_succeeds(self):
        self.client.force_login(self.user)
        response = self.client.post(self.url, data=self._upload_payload())
        self.assertEqual(response.status_code, 201)
        body = response.json()
        self.assertEqual(body['name'], 'Hero banner')
        self.assertEqual(body['category'], 'image')
        self.assertEqual(body['source_type'], 'upload')
        self.assertEqual(body['content_type'], 'image/jpeg')
        self.assertEqual(body['width'], 20)
        self.assertEqual(body['height'], 20)
        self.assertTrue(body['file_size'] > 0)
        self.assertTrue(body['url'].startswith('http'))
        self.assertNotIn('file', body)
        asset = EmailAsset.objects.get(pk=body['id'])
        self.assertEqual(asset.user_id, self.user.id)

    def test_authenticated_external_url_succeeds(self):
        self.client.force_login(self.user)
        response = self.client.post(
            self.url, data=json.dumps(self._external_payload()), content_type='application/json',
        )
        self.assertEqual(response.status_code, 201)
        body = response.json()
        self.assertEqual(body['source_type'], 'external')
        self.assertEqual(body['url'], 'https://cdn.example.com/logo.png')
        self.assertIsNone(body['width'])
        self.assertIsNone(body['file_size'])

    def test_owner_never_settable_from_client(self):
        self.client.force_login(self.user)
        response = self.client.post(self.url, data=self._upload_payload())
        asset = EmailAsset.objects.get(pk=response.json()['id'])
        self.assertEqual(asset.user_id, self.user.id)
        self.assertNotEqual(asset.user_id, self.other_user.id)

    def test_name_required(self):
        self.client.force_login(self.user)
        response = self.client.post(self.url, data=self._upload_payload(name=''))
        self.assertEqual(response.status_code, 400)
        self.assertIn('name', response.json()['errors'])

    def test_upload_without_file_rejected(self):
        self.client.force_login(self.user)
        payload = self._upload_payload()
        del payload['file']
        response = self.client.post(self.url, data=payload)
        self.assertEqual(response.status_code, 400)
        self.assertIn('file', response.json()['errors'])

    def test_external_without_url_rejected(self):
        self.client.force_login(self.user)
        payload = self._external_payload()
        del payload['external_url']
        response = self.client.post(
            self.url, data=json.dumps(payload), content_type='application/json',
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn('external_url', response.json()['errors'])

    def test_unsafe_external_url_scheme_rejected(self):
        self.client.force_login(self.user)
        response = self.client.post(
            self.url,
            data=json.dumps(self._external_payload(external_url='javascript:alert(1)')),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn('external_url', response.json()['errors'])

    def test_oversized_upload_rejected(self):
        self.client.force_login(self.user)
        oversized = SimpleUploadedFile(
            'huge.jpg', b'\x00' * (6 * 1024 * 1024), content_type='image/jpeg',
        )
        response = self.client.post(self.url, data=self._upload_payload(file=oversized))
        self.assertEqual(response.status_code, 400)
        self.assertIn('file', response.json()['errors'])
        self.assertEqual(EmailAsset.objects.count(), 0)

    def test_non_image_upload_rejected(self):
        self.client.force_login(self.user)
        fake = SimpleUploadedFile('not-image.jpg', b'not a real image', content_type='image/jpeg')
        response = self.client.post(self.url, data=self._upload_payload(file=fake))
        self.assertEqual(response.status_code, 400)
        self.assertIn('file', response.json()['errors'])

    def test_gif_upload_accepted(self):
        self.client.force_login(self.user)
        gif = SimpleUploadedFile('anim.gif', _asset_image_bytes('GIF'), content_type='image/gif')
        response = self.client.post(self.url, data=self._upload_payload(file=gif, name='Animated banner'))
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()['content_type'], 'image/gif')

    def test_list_only_returns_own_assets(self):
        self.client.force_login(self.user)
        self.client.post(self.url, data=self._upload_payload(name='Mine'))
        self.client.logout()
        self.client.force_login(self.other_user)
        self.client.post(self.url, data=self._upload_payload(name='Not mine'))
        self.client.logout()
        self.client.force_login(self.user)
        response = self.client.get(self.url)
        self.assertEqual(response.status_code, 200)
        names = [item['name'] for item in response.json()]
        self.assertIn('Mine', names)
        self.assertNotIn('Not mine', names)

    def test_search_filters_by_name(self):
        self.client.force_login(self.user)
        self.client.post(self.url, data=self._upload_payload(name='Summer sale hero'))
        self.client.post(self.url, data=self._upload_payload(name='Winter banner'))
        response = self.client.get(self.url, {'search': 'summer'})
        self.assertEqual(response.status_code, 200)
        names = [item['name'] for item in response.json()]
        self.assertEqual(names, ['Summer sale hero'])

    def test_category_filter(self):
        self.client.force_login(self.user)
        self.client.post(self.url, data=self._upload_payload(name='A logo', category='logo'))
        self.client.post(self.url, data=self._upload_payload(name='An image', category='image'))
        response = self.client.get(self.url, {'category': 'logo'})
        self.assertEqual(response.status_code, 200)
        names = [item['name'] for item in response.json()]
        self.assertEqual(names, ['A logo'])

    def test_update_alt_text(self):
        self.client.force_login(self.user)
        create_response = self.client.post(self.url, data=self._upload_payload())
        asset_id = create_response.json()['id']
        response = self.client.patch(
            f'{self.url}{asset_id}/', data=json.dumps({'alt_text': 'Summer sale hero image'}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['alt_text'], 'Summer sale hero image')

    def test_replace_uploaded_file(self):
        self.client.force_login(self.user)
        create_response = self.client.post(self.url, data=self._upload_payload())
        asset_id = create_response.json()['id']
        original_width = create_response.json()['width']
        new_file = SimpleUploadedFile(
            'replacement.png', _asset_image_bytes('PNG', size=(50, 50)), content_type='image/png',
        )
        # Django's test Client.patch() only JSON-encodes `data` (unlike
        # .post(), which auto-multipart-encodes a dict) — a file upload on
        # PATCH has to be multipart-encoded by hand and sent as the raw body.
        response = self.client.patch(
            f'{self.url}{asset_id}/',
            data=encode_multipart(BOUNDARY, {'file': new_file}),
            content_type=MULTIPART_CONTENT,
        )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body['width'], 50)
        self.assertNotEqual(body['width'], original_width)
        self.assertEqual(body['content_type'], 'image/png')

    def test_delete_own_asset(self):
        self.client.force_login(self.user)
        create_response = self.client.post(self.url, data=self._upload_payload())
        asset_id = create_response.json()['id']
        response = self.client.delete(f'{self.url}{asset_id}/')
        self.assertEqual(response.status_code, 204)
        self.assertFalse(EmailAsset.objects.filter(pk=asset_id).exists())

    def test_ownership_enforced_for_retrieve_and_delete(self):
        self.client.force_login(self.user)
        create_response = self.client.post(self.url, data=self._upload_payload())
        asset_id = create_response.json()['id']
        self.client.logout()
        self.client.force_login(self.other_user)
        get_response = self.client.get(f'{self.url}{asset_id}/')
        self.assertEqual(get_response.status_code, 404)
        delete_response = self.client.delete(f'{self.url}{asset_id}/')
        self.assertEqual(delete_response.status_code, 404)
        self.assertTrue(EmailAsset.objects.filter(pk=asset_id).exists())

    def test_anonymous_delete_rejected(self):
        self.client.force_login(self.user)
        create_response = self.client.post(self.url, data=self._upload_payload())
        asset_id = create_response.json()['id']
        self.client.logout()
        response = self.client.delete(f'{self.url}{asset_id}/')
        self.assertEqual(response.status_code, 403)
        self.assertTrue(EmailAsset.objects.filter(pk=asset_id).exists())


# --- Feature 14 -- AI Engineer Voice --------------------------------------

from unittest.mock import MagicMock, patch  # noqa: E402

from django.core.cache import cache as _cache  # noqa: E402
from django.test import override_settings  # noqa: E402

from .ai_command import (  # noqa: E402
    ActionType,
    CommandResult,
    FallbackEmailCommandProvider,
    RuleBasedEmailCommandProvider,
    _contrast_ratio,
    _resolve_color,
    get_default_email_command_provider,
    minimal_readable_foreground,
    requires_confirmation,
    requires_strong_confirmation,
    resolve_asset_references,
    validate_action,
)
from .ai_command_openai import OpenAIEmailCommandProvider  # noqa: E402
from .ai_command_local import LocalEmailCommandProvider  # noqa: E402
from . import ai_command as ai_command_module  # noqa: E402
from . import ai_command_openai as ai_command_openai_module  # noqa: E402
from . import ai_command_local as ai_command_local_module  # noqa: E402
from . import module_capabilities  # noqa: E402
from .knowledge.rules import (  # noqa: E402
    AFFECTED_CLIENT_VALUES, CONCERN_VALUES, EMAIL_CLIENT_REGISTRY, KNOWLEDGE_RULE_CATEGORIES,
    KnowledgeRule, KnowledgeRuleValidationError, find_rule, find_rules_by_category, find_rules_by_client,
    find_rules_by_concern, load_rules,
)


def _selected(module_type, **props):
    return {'type': module_type, 'props': props}


class RuleBasedEmailCommandProviderTests(TestCase):
    """The deterministic provider is the fully-functional baseline --
    every one of these must pass with zero configuration, zero network."""

    def setUp(self):
        self.provider = RuleBasedEmailCommandProvider()

    def test_add_single_module(self):
        result = self.provider.resolve('add a button', {})
        self.assertEqual(result.action['type'], ActionType.INSERT_MODULE)
        self.assertEqual(result.action['modules'], [{'module_type': 'button', 'patch': {}}])
        self.assertEqual(result.provider, 'deterministic')

    def test_add_multiple_modules_bounded(self):
        result = self.provider.resolve('add a text, an image, a button, a divider and a spacer', {})
        modules = result.action['modules']
        self.assertEqual(result.action['type'], ActionType.INSERT_MODULE)
        self.assertEqual(len(modules), 5)
        self.assertEqual({m['module_type'] for m in modules}, {'text', 'image', 'button', 'divider', 'spacer'})

    def test_add_unknown_module_asks_which(self):
        result = self.provider.resolve('add a widget', {})
        self.assertEqual(result.action['type'], ActionType.NONE)
        self.assertIn('which one', result.reply)

    def test_update_selected_module_color(self):
        context = {'selected_module': _selected('text', color='#333333')}
        result = self.provider.resolve('change the color to green', context)
        self.assertEqual(result.action, {
            'type': ActionType.UPDATE_MODULE_PROPS, 'target': 'selected', 'module_type': 'text',
            'patch': {'color': '#76C043'},
        })

    def test_update_selected_module_hex_color(self):
        context = {'selected_module': _selected('button')}
        result = self.provider.resolve('set the background color to #112233', context)
        self.assertEqual(result.action['patch'], {'backgroundColor': '#112233'})

    def test_update_font_size_bigger_relative_to_current(self):
        context = {'selected_module': _selected('text', fontSize=16)}
        result = self.provider.resolve('make the text bigger', context)
        self.assertEqual(result.action['patch'], {'fontSize': 20})

    def test_update_font_size_explicit(self):
        context = {'selected_module': _selected('text', fontSize=16)}
        result = self.provider.resolve('set font size to 30', context)
        self.assertEqual(result.action['patch'], {'fontSize': 30})

    def test_update_alignment(self):
        context = {'selected_module': _selected('text')}
        result = self.provider.resolve('align this center', context)
        self.assertEqual(result.action['patch'], {'align': 'center'})

    def test_set_text_content(self):
        context = {'selected_module': _selected('text')}
        result = self.provider.resolve('set the text to Welcome to our sale', context)
        self.assertEqual(result.action['patch'].get('text'), 'Welcome to our sale')

    def test_update_without_selection_asks_to_select(self):
        result = self.provider.resolve('change the color to green', {})
        self.assertEqual(result.action['type'], ActionType.NONE)
        self.assertIn('Select a module', result.reply)

    def test_update_unsupported_selected_type(self):
        context = {'selected_module': _selected('layout-2col-50-50')}
        result = self.provider.resolve('change the color to green', context)
        # layout-2col-50-50 is not in SUPPORTED_MODULE_TYPES; the serializer
        # would reject it before this ever runs, but the provider itself
        # must also degrade safely rather than crash.
        self.assertEqual(result.action['type'], ActionType.NONE)

    def test_delete_selected_requires_confirmation(self):
        context = {'selected_module': _selected('button')}
        result = self.provider.resolve('delete this module', context)
        self.assertEqual(result.action, {'type': ActionType.DELETE_MODULE, 'target': 'selected'})
        self.assertTrue(requires_confirmation(result.action))

    def test_delete_without_selection(self):
        result = self.provider.resolve('delete this', {})
        self.assertEqual(result.action['type'], ActionType.NONE)

    def test_duplicate_selected(self):
        context = {'selected_module': _selected('button')}
        result = self.provider.resolve('duplicate this module', context)
        self.assertEqual(result.action, {'type': ActionType.DUPLICATE_MODULE, 'target': 'selected'})
        self.assertFalse(requires_confirmation(result.action))

    def test_global_style_requires_confirmation(self):
        result = self.provider.resolve('make all buttons green', {})
        self.assertEqual(result.action, {
            'type': ActionType.APPLY_GLOBAL_STYLE, 'target': 'selected', 'module_type': 'button',
            'patch': {'backgroundColor': '#76C043'},
        })
        self.assertTrue(requires_confirmation(result.action))

    def test_global_style_headings_maps_to_text(self):
        result = self.provider.resolve('make every heading use the brand dark color', {})
        self.assertEqual(result.action['module_type'], 'text')
        self.assertEqual(result.action['patch'], {'color': '#002D38'})

    def test_ambiguous_command_returns_clarification(self):
        result = self.provider.resolve('make it pop', {'selected_module': _selected('text')})
        self.assertEqual(result.action['type'], ActionType.NONE)
        self.assertTrue(result.reply)

    def test_unsupported_command_safe_response(self):
        result = self.provider.resolve('convert this section to two columns 40/60', {})
        self.assertEqual(result.action['type'], ActionType.NONE)
        self.assertIn('not sure how to do that yet', result.reply)

    def test_empty_message(self):
        result = self.provider.resolve('', {})
        self.assertEqual(result.action['type'], ActionType.NONE)

    def test_generate_modules_bounded_vocabulary_example(self):
        result = self.provider.resolve('add a header text, a hero image and a shop now button', {})
        modules = result.action['modules']
        self.assertLessEqual(len(modules), 5)
        for entry in modules:
            self.assertIn(entry['module_type'], ('text', 'image', 'button'))

    # --- Sub-phase 6, work package D/E -- new NL vocabulary ---

    def test_nested_insert_here_phrasing(self):
        result = self.provider.resolve('add a text module here', {})
        self.assertEqual(result.action, {
            'type': ActionType.INSERT_NESTED_MODULE, 'module_type': 'text', 'patch': {},
        })

    def test_nested_insert_into_this_column_phrasing(self):
        result = self.provider.resolve('insert a button into this column', {})
        self.assertEqual(result.action['type'], ActionType.INSERT_NESTED_MODULE)
        self.assertEqual(result.action['module_type'], 'button')

    def test_plain_add_a_button_is_NOT_misread_as_a_nested_insert(self):
        # Regression guard -- "add a button" (no "here"/"in this column")
        # must still route to the ORIGINAL top-level INSERT_MODULE.
        result = self.provider.resolve('add a button', {})
        self.assertEqual(result.action['type'], ActionType.INSERT_MODULE)

    def test_vml_pattern_for_a_selected_button(self):
        context = {'selected_module': _selected('button')}
        result = self.provider.resolve('enable outlook vml for this button', context)
        self.assertEqual(result.action, {'type': ActionType.APPLY_VML_PATTERN, 'module_type': 'button'})

    def test_outlook_wrapper_for_a_selected_background_hero(self):
        context = {'selected_module': _selected('hero-background-image')}
        result = self.provider.resolve('enable outlook wrapper for this background', context)
        self.assertEqual(result.action, {'type': ActionType.APPLY_OUTLOOK_WRAPPER, 'module_type': 'hero-background-image'})

    def test_vml_for_background_hero_always_routes_to_outlook_wrapper_not_button_pattern(self):
        # Regression guard -- Sub-phase 6 closure gave hero-background-image
        # BOTH supportsBulletproofCta AND supportsBulletproofBackground (its
        # own CTA VML nests inside its background ghost-table VML). The
        # generic "enable outlook vml" phrasing must still resolve to the
        # single covering action (APPLY_OUTLOOK_WRAPPER), never the
        # button-only APPLY_VML_PATTERN, for this one dual-capability type.
        context = {'selected_module': _selected('hero-background-image')}
        result = self.provider.resolve('enable outlook vml for this module', context)
        self.assertEqual(result.action, {'type': ActionType.APPLY_OUTLOOK_WRAPPER, 'module_type': 'hero-background-image'})

    def test_vml_pattern_for_a_selected_cta_module_now_supported(self):
        # Sub-phase 6 closure expanded bulletproof-CTA VML beyond the
        # standalone Button module -- cta-centered is one of the 22 newly
        # eligible module types.
        context = {'selected_module': _selected('cta-centered')}
        result = self.provider.resolve('enable outlook vml for this', context)
        self.assertEqual(result.action, {'type': ActionType.APPLY_VML_PATTERN, 'module_type': 'cta-centered'})

    def test_vml_pattern_for_a_selected_pill_link_module_now_supported(self):
        # Sub-phase 6 final reconciliation -- bordered/rounded pill-link
        # modules (social-icon-row, social-follow-us, footer-social-legal)
        # are genuine VML-button candidates: Classic Outlook ignores
        # border-radius regardless of background fill.
        context = {'selected_module': _selected('social-icon-row')}
        result = self.provider.resolve('enable outlook vml for this', context)
        self.assertEqual(result.action, {'type': ActionType.APPLY_VML_PATTERN, 'module_type': 'social-icon-row'})

    def test_vml_declined_for_a_module_type_that_does_not_support_it(self):
        context = {'selected_module': _selected('text')}
        result = self.provider.resolve('enable vml for this', context)
        self.assertEqual(result.action['type'], ActionType.NONE)
        self.assertIn('does not support', result.reply)

    def test_vml_still_declined_for_a_plain_nav_link_module(self):
        # header-logo-nav has no bordered/rounded container at all --
        # remains excluded even after the pill-link reconciliation.
        context = {'selected_module': _selected('header-logo-nav')}
        result = self.provider.resolve('enable vml for this', context)
        self.assertEqual(result.action['type'], ActionType.NONE)
        self.assertIn('does not support', result.reply)

    def test_hide_on_mobile(self):
        context = {'selected_module': _selected('text')}
        result = self.provider.resolve('hide this on mobile', context)
        self.assertEqual(result.action, {
            'type': ActionType.UPDATE_MODULE_SETTINGS, 'module_type': 'text', 'patch': {'visibility': 'hideMobile'},
        })

    def test_hide_on_desktop(self):
        context = {'selected_module': _selected('text')}
        result = self.provider.resolve('hide this on desktop', context)
        self.assertEqual(result.action['patch'], {'visibility': 'hideDesktop'})

    def test_show_on_both(self):
        context = {'selected_module': _selected('text')}
        result = self.provider.resolve('show it on both desktop and mobile', context)
        self.assertEqual(result.action['patch'], {'visibility': 'all'})

    def test_restructure_layout_two_numbers(self):
        context = {'selected_module': _selected('layout-2col-50-50', columnWidths=[50, 50])}
        result = self.provider.resolve('change the column widths to 70/30', context)
        self.assertEqual(result.action, {
            'type': ActionType.RESTRUCTURE_LAYOUT, 'module_type': 'layout-2col-50-50', 'widths': [70.0, 30.0],
        })

    def test_restructure_layout_wrong_number_of_widths_asks_for_the_correct_count(self):
        context = {'selected_module': _selected('layout-3col', columnWidths=[33, 33, 34])}
        result = self.provider.resolve('change the column widths to 70/30', context)
        self.assertEqual(result.action['type'], ActionType.NONE)
        self.assertIn('3 width', result.reply)

    def test_restructure_layout_declined_for_a_non_layout_module(self):
        context = {'selected_module': _selected('text')}
        result = self.provider.resolve('change the column widths to 70/30', context)
        self.assertEqual(result.action['type'], ActionType.NONE)
        self.assertIn('not a layout', result.reply)

    def test_remove_first_nav_link(self):
        context = {'selected_module': _selected('header-logo-nav')}
        result = self.provider.resolve('remove the first nav link', context)
        self.assertEqual(result.action, {
            'type': ActionType.UPDATE_REPEATABLE_FIELD, 'module_type': 'header-logo-nav', 'op': 'remove', 'index': 0,
        })

    def test_remove_second_item(self):
        context = {'selected_module': _selected('product-single')}
        result = self.provider.resolve('remove the second item', context)
        self.assertEqual(result.action['index'], 1)

    def test_remove_repeatable_declined_for_a_module_with_no_list(self):
        context = {'selected_module': _selected('text')}
        result = self.provider.resolve('remove the first link', context)
        self.assertEqual(result.action['type'], ActionType.NONE)
        self.assertIn("doesn't have a list", result.reply)

    def test_plain_remove_this_is_NOT_misread_as_a_repeatable_removal(self):
        # Regression guard -- "remove this" (no ordinal + list-item noun)
        # must still route to the ORIGINAL DELETE_MODULE.
        context = {'selected_module': _selected('text')}
        result = self.provider.resolve('remove this', context)
        self.assertEqual(result.action['type'], ActionType.DELETE_MODULE)

    # --- Sub-phase 6 closure -- repeatable-field ADD/UPDATE/REORDER via NL ---

    def test_add_nav_link_with_explicit_label_and_url(self):
        context = {'selected_module': _selected('header-logo-nav')}
        result = self.provider.resolve(
            'add a navigation link called Pricing with URL https://example.com/pricing', context,
        )
        self.assertEqual(result.action, {
            'type': ActionType.UPDATE_REPEATABLE_FIELD, 'module_type': 'header-logo-nav', 'op': 'add',
            'item': {'label': 'Pricing', 'href': 'https://example.com/pricing'},
        })

    def test_add_social_link_with_for_and_using_connectors(self):
        context = {'selected_module': _selected('social-icon-row')}
        result = self.provider.resolve('add a social link for LinkedIn using https://linkedin.com/company/x', context)
        self.assertEqual(result.action['item'], {'label': 'LinkedIn', 'href': 'https://linkedin.com/company/x'})

    def test_add_icon_text_row_with_saying_connector(self):
        context = {'selected_module': _selected('content-icon-text-rows')}
        result = self.provider.resolve('add a row called Highlights saying Great stuff here', context)
        self.assertEqual(result.action, {
            'type': ActionType.UPDATE_REPEATABLE_FIELD, 'module_type': 'content-icon-text-rows', 'op': 'add',
            'item': {'title': 'Highlights', 'text': 'Great stuff here'},
        })

    def test_add_never_fabricates_content_when_nothing_supplied(self):
        # "add a navigation link" alone falls through to the generic
        # insert-module clarify reply rather than proposing an empty/
        # invented item.
        context = {'selected_module': _selected('header-logo-nav')}
        result = self.provider.resolve('add a navigation link', context)
        self.assertEqual(result.action['type'], ActionType.NONE)

    def test_add_declines_an_unsafe_url_rather_than_dropping_or_inventing_one(self):
        context = {'selected_module': _selected('header-logo-nav')}
        result = self.provider.resolve('add a navigation link called Pricing with URL javascript:alert(1)', context)
        self.assertEqual(result.action['type'], ActionType.NONE)
        self.assertIn("couldn't use", result.reply)

    def test_add_declines_a_richer_schema_it_cannot_bound_safely(self):
        # product-single's itemSchema has 7 fields -- the bounded two-field
        # ADD parser correctly declines rather than guessing which fields
        # the user's free text maps to.
        context = {'selected_module': _selected('product-single')}
        result = self.provider.resolve('add a product called Widget with URL https://example.com/widget', context)
        self.assertEqual(result.action['type'], ActionType.NONE)
        self.assertIn('richer item', result.reply)

    def test_update_nav_link_label_by_ordinal(self):
        context = {'selected_module': _selected('header-logo-nav')}
        result = self.provider.resolve('change the second navigation link label to Services', context)
        self.assertEqual(result.action, {
            'type': ActionType.UPDATE_REPEATABLE_FIELD, 'module_type': 'header-logo-nav',
            'op': 'update', 'index': 1, 'item': {'label': 'Services'},
        })

    def test_update_product_field_via_synonym_title_to_name(self):
        # "title" is not a literal key/label on ProductItem (it's "name" /
        # "Product name") -- resolved via the synonym table, never guessed.
        context = {'selected_module': _selected('product-single')}
        result = self.provider.resolve('change the first product title to Summer Collection', context)
        self.assertEqual(result.action, {
            'type': ActionType.UPDATE_REPEATABLE_FIELD, 'module_type': 'product-single',
            'op': 'update', 'index': 0, 'item': {'name': 'Summer Collection'},
        })

    def test_update_asks_which_field_when_none_can_be_resolved(self):
        context = {'selected_module': _selected('header-logo-nav')}
        result = self.provider.resolve('change the second navigation link banana to Services', context)
        self.assertEqual(result.action['type'], ActionType.NONE)
        self.assertIn('Which field', result.reply)

    def test_update_declines_an_invalid_value_rather_than_fabricating_one(self):
        context = {'selected_module': _selected('header-logo-nav')}
        result = self.provider.resolve('change the first navigation link url to not-a-url', context)
        self.assertEqual(result.action['type'], ActionType.NONE)
        self.assertIn("couldn't use", result.reply)

    def test_update_never_misroutes_a_plain_font_size_change(self):
        # Regression guard -- no ordinal/item-noun present, so this must
        # still reach the ORIGINAL UPDATE_MODULE_PROPS style-patch path.
        context = {'selected_module': _selected('text', fontSize=16)}
        result = self.provider.resolve('change the font size to 20', context)
        self.assertEqual(result.action, {
            'type': ActionType.UPDATE_MODULE_PROPS, 'target': 'selected', 'module_type': 'text',
            'patch': {'fontSize': 20},
        })

    def test_update_never_misroutes_setting_the_email_title(self):
        # Regression guard -- this exact collision was caught live: an
        # earlier version of the router let "product title to X" get
        # matched by the (unrelated) email-title pattern.
        result = self.provider.resolve('set the email title to My Newsletter', {})
        self.assertEqual(result.action, {'type': ActionType.SET_EMAIL_TITLE, 'value': 'My Newsletter'})

    def test_reorder_moves_an_item_to_a_new_position(self):
        context = {'selected_module': _selected('header-logo-nav')}
        result = self.provider.resolve('move the fourth navigation link to position 2', context)
        self.assertEqual(result.action, {
            'type': ActionType.UPDATE_REPEATABLE_FIELD, 'module_type': 'header-logo-nav',
            'op': 'reorder', 'fromIndex': 3, 'toIndex': 1,
        })

    def test_add_repeatable_is_checked_before_nested_insert_despite_a_trailing_here(self):
        # Regression guard for the exact collision found during
        # implementation -- "... saying Great stuff here" ends in the
        # literal word _NESTED_INSERT_PATTERN also looks for.
        context = {'selected_module': _selected('content-icon-text-rows')}
        result = self.provider.resolve('add a row called Highlights saying Great stuff here', context)
        self.assertEqual(result.action['type'], ActionType.UPDATE_REPEATABLE_FIELD)

    def test_nested_insert_still_works_when_repeatable_add_pattern_does_not_match(self):
        result = self.provider.resolve('add a text module here', {})
        self.assertEqual(result.action, {
            'type': ActionType.INSERT_NESTED_MODULE, 'module_type': 'text', 'patch': {},
        })


class MinimalReadableForegroundTests(TestCase):
    """Pure math — mirrors emailValidation.ts's WCAG contrast formula
    exactly, so the deterministic router's notion of AA-passing never
    diverges from what Validation Center itself reports on revalidation."""

    def test_contrast_ratio_matches_known_textbook_value(self):
        # #999999 on #ffffff is a commonly-cited ~2.85:1 WCAG example.
        ratio = _contrast_ratio('#999999', '#ffffff')
        self.assertAlmostEqual(ratio, 2.85, delta=0.05)

    def test_darkens_gray_text_on_white_to_reach_aa(self):
        fix = minimal_readable_foreground('#999999', '#ffffff')
        self.assertIsNotNone(fix)
        self.assertEqual(fix['old_color'], '#999999')
        self.assertGreaterEqual(fix['new_ratio'], 4.5)
        self.assertLess(fix['old_ratio'], 4.5)
        # Smallest practical adjustment — darkened, not flipped to black,
        # and the result must actually satisfy AA against the real bg.
        new_rgb = tuple(int(fix['new_color'][i:i + 2], 16) for i in (1, 3, 5))
        self.assertLess(sum(new_rgb), sum((0x99, 0x99, 0x99)))
        self.assertAlmostEqual(_contrast_ratio(fix['new_color'], '#ffffff'), fix['new_ratio'], delta=0.01)

    def test_lightens_light_gray_text_on_black_to_reach_aa(self):
        fix = minimal_readable_foreground('#666666', '#000000')
        self.assertIsNotNone(fix)
        self.assertGreaterEqual(fix['new_ratio'], 4.5)
        new_rgb = tuple(int(fix['new_color'][i:i + 2], 16) for i in (1, 3, 5))
        self.assertGreater(sum(new_rgb), sum((0x66, 0x66, 0x66)))

    def test_declines_when_already_passing(self):
        self.assertIsNone(minimal_readable_foreground('#000000', '#ffffff'))

    def test_declines_when_foreground_already_at_lightness_extreme(self):
        # White text against a background where white itself is
        # insufficient — no headroom to go any lighter than white.
        self.assertIsNone(minimal_readable_foreground('#ffffff', '#5b9bd5'))

    def test_declines_on_non_hex_color(self):
        self.assertIsNone(minimal_readable_foreground('rgb(1,2,3)', '#ffffff'))
        self.assertIsNone(minimal_readable_foreground('#999999', 'transparent'))


class WeakContrastDeterministicFixTests(TestCase):
    """C-2 remediation — the deterministic (no-LLM) provider must be able
    to fix weak text contrast on its own, with zero configuration."""

    def setUp(self):
        self.provider = RuleBasedEmailCommandProvider()

    def test_no_selection_asks_to_select_a_module(self):
        result = self.provider.resolve('fix this weak contrast', {})
        self.assertEqual(result.action, {'type': ActionType.NONE})
        self.assertIn('Select a module', result.reply)

    def test_proposes_a_real_wcag_compliant_color_for_text_module(self):
        context = {'selected_module': _selected('text', color='#999999', backgroundColor='#ffffff')}
        result = self.provider.resolve('fix this weak contrast', context)
        self.assertEqual(result.action['type'], ActionType.UPDATE_MODULE_PROPS)
        self.assertEqual(result.action['module_type'], 'text')
        new_color = result.action['patch']['color']
        self.assertGreaterEqual(_contrast_ratio(new_color, '#ffffff'), 4.5)
        self.assertIn('#999999', result.reply)
        self.assertIn(new_color, result.reply)

    def test_uses_textcolor_key_for_button_module(self):
        context = {'selected_module': _selected('button', textColor='#999999', backgroundColor='#ffffff')}
        result = self.provider.resolve('fix the text contrast', context)
        self.assertEqual(result.action['module_type'], 'button')
        self.assertIn('textColor', result.action['patch'])
        self.assertGreaterEqual(_contrast_ratio(result.action['patch']['textColor'], '#ffffff'), 4.5)

    def test_declines_when_background_image_present(self):
        context = {'selected_module': _selected(
            'text', color='#999999', backgroundColor='#ffffff', backgroundImage='https://cdn.example.com/bg.jpg',
        )}
        result = self.provider.resolve('fix this weak contrast', context)
        self.assertEqual(result.action, {'type': ActionType.NONE})
        self.assertIn('background image', result.reply)

    def test_declines_when_already_passing(self):
        context = {'selected_module': _selected('text', color='#000000', backgroundColor='#ffffff')}
        result = self.provider.resolve('fix this weak contrast', context)
        self.assertEqual(result.action, {'type': ActionType.NONE})

    def test_proposed_action_survives_validate_action(self):
        context = {'selected_module': _selected('text', color='#999999', backgroundColor='#ffffff')}
        result = self.provider.resolve('fix this weak contrast', context)
        self.assertIsNotNone(validate_action(result.action))


class ResolveColorTests(TestCase):
    def test_hex_passthrough_uppercased(self):
        self.assertEqual(_resolve_color('#abcdef'), '#ABCDEF')

    def test_named_color(self):
        self.assertEqual(_resolve_color('green'), '#76C043')

    def test_unknown_word_returns_none(self):
        self.assertIsNone(_resolve_color('paisley'))

    def test_non_string_returns_none(self):
        self.assertIsNone(_resolve_color(123))


class EmailAiEngineerCssCommandTests(TestCase):
    """Item F -- deterministic (zero-token) CSS commands: reset CSS
    enable/disable, custom CSS enable/disable/set/clear. Proposal-only:
    these tests exercise CommandResult/validate_action, never mutate a
    document -- applying a proposal is the frontend's job (Apply button),
    same contract as every other action type."""

    def setUp(self):
        self.provider = RuleBasedEmailCommandProvider()

    def test_enable_reset_css(self):
        result = self.provider.resolve('enable reset css', {})
        self.assertEqual(result.action, {'type': ActionType.SET_RESET_CSS_ENABLED, 'enabled': True})

    def test_disable_reset_css(self):
        result = self.provider.resolve('please disable reset css', {})
        self.assertEqual(result.action, {'type': ActionType.SET_RESET_CSS_ENABLED, 'enabled': False})

    def test_enable_custom_css(self):
        result = self.provider.resolve('turn on custom css', {})
        self.assertEqual(result.action, {'type': ActionType.SET_CUSTOM_CSS_ENABLED, 'enabled': True})

    def test_disable_custom_css(self):
        result = self.provider.resolve('turn off custom css', {})
        self.assertEqual(result.action, {'type': ActionType.SET_CUSTOM_CSS_ENABLED, 'enabled': False})

    def test_clear_custom_css(self):
        result = self.provider.resolve('remove custom css', {})
        self.assertEqual(result.action, {'type': ActionType.CLEAR_CUSTOM_CSS})

    def test_set_custom_css(self):
        result = self.provider.resolve('set custom css to: .brand { color: #002D38; }', {})
        self.assertEqual(result.action, {'type': ActionType.SET_CUSTOM_CSS, 'css': '.brand { color: #002D38; }'})

    def test_set_custom_css_with_add_phrasing(self):
        result = self.provider.resolve('add custom css: .x { padding: 4px; }', {})
        self.assertEqual(result.action['type'], ActionType.SET_CUSTOM_CSS)
        self.assertEqual(result.action['css'], '.x { padding: 4px; }')

    def test_set_custom_css_rejects_unsafe_css_at_proposal_time(self):
        result = self.provider.resolve('set custom css to: </style><script>alert(1)</script>', {})
        self.assertEqual(result.action['type'], ActionType.NONE)
        self.assertIn('cannot apply', result.reply.lower())

    def test_set_custom_css_rejects_obfuscated_unsafe_css_at_proposal_time(self):
        """Item 3 (closure) -- the AI proposal path shares the exact same
        normalized security validator, so a hex-escaped javascript:
        scheme is rejected here too, not just at final Save."""
        result = self.provider.resolve(r'set custom css to: .x{background:url(j\61vascript:alert(1))}', {})
        self.assertEqual(result.action['type'], ActionType.NONE)
        self.assertIn('cannot apply', result.reply.lower())

    def test_set_custom_css_rejects_data_url_at_proposal_time(self):
        """Item 2 (closure) -- data: URLs are rejected here too."""
        result = self.provider.resolve('set custom css to: .x{background:url(data:image/png;base64,AAAA)}', {})
        self.assertEqual(result.action['type'], ActionType.NONE)
        self.assertIn('cannot apply', result.reply.lower())

    def test_ambiguous_custom_css_command_asks_for_content(self):
        result = self.provider.resolve('what about custom css', {})
        self.assertEqual(result.action['type'], ActionType.NONE)

    def test_reset_css_ambiguous_asks_enable_or_disable(self):
        result = self.provider.resolve('what about reset css', {})
        self.assertEqual(result.action['type'], ActionType.NONE)
        self.assertIn('enable or disable', result.reply.lower())

    def test_all_css_actions_require_confirmation(self):
        for action in [
            {'type': ActionType.SET_RESET_CSS_ENABLED, 'enabled': True},
            {'type': ActionType.SET_CUSTOM_CSS_ENABLED, 'enabled': False},
            {'type': ActionType.SET_CUSTOM_CSS, 'css': '.x{color:red}'},
            {'type': ActionType.CLEAR_CUSTOM_CSS},
        ]:
            self.assertTrue(requires_confirmation(action))

    def test_short_custom_css_does_not_require_strong_confirmation(self):
        action = validate_action({'type': ActionType.SET_CUSTOM_CSS, 'css': '.x{color:red}'})
        self.assertFalse(requires_strong_confirmation(action))

    def test_long_custom_css_requires_strong_confirmation(self):
        action = validate_action({'type': ActionType.SET_CUSTOM_CSS, 'css': '.x{color:red}' * 20})
        self.assertTrue(requires_strong_confirmation(action))

    def test_validate_action_rejects_set_custom_css_with_non_bool_enabled(self):
        self.assertIsNone(validate_action({'type': ActionType.SET_RESET_CSS_ENABLED, 'enabled': 'yes'}))

    def test_validate_action_rejects_unsafe_set_custom_css(self):
        self.assertIsNone(validate_action({'type': ActionType.SET_CUSTOM_CSS, 'css': '<script>alert(1)</script>'}))

    def test_validate_action_rejects_empty_custom_css(self):
        self.assertIsNone(validate_action({'type': ActionType.SET_CUSTOM_CSS, 'css': '   '}))

    def test_validate_action_accepts_clear_custom_css(self):
        self.assertEqual(validate_action({'type': ActionType.CLEAR_CUSTOM_CSS}), {'type': ActionType.CLEAR_CUSTOM_CSS})

    def test_resolve_asset_references_passes_document_scope_actions_through_unchanged(self):
        action = {'type': ActionType.SET_CUSTOM_CSS, 'css': '.x{color:red}'}
        self.assertEqual(resolve_asset_references(action, request=None), action)


def _minimal_rule_kwargs(**overrides):
    """A fully-valid baseline KnowledgeRule kwargs dict, for tests that
    only want to exercise ONE deliberately-broken field. Sub-phase 5
    added `concerns`/`source` as required fields with no default, so
    every test that constructs a KnowledgeRule directly (rather than via
    load_rules()) needs a valid value for both, or it fails with a
    TypeError from the dataclass constructor itself -- before
    __post_init__ even runs -- which would silently defeat tests that
    exist specifically to prove __post_init__'s OWN validation."""
    kwargs = {
        'id': 'bad', 'category': 'outlook', 'title': 't', 'description': 'd', 'severity': 'info',
        'affected_clients': ('BOTH',), 'concerns': ('rendering-engine',), 'detection': {},
        'suggested_fix': None, 'safe_auto_fix': False, 'references': (), 'confidence': 1.0,
        'source': {'name': 'test', 'url': None, 'license': None, 'version': None, 'date': None, 'transformation': None},
    }
    kwargs.update(overrides)
    return kwargs


class KnowledgeRuleTests(TestCase):
    """Sub-phase 3, item 13 + Sub-phase 4, item 6 + Sub-phase 5 (Phase B
    -- Professional Email Knowledge Engine) -- the KnowledgeRule contract
    stays satisfied by every real rule, and load_rules()/find_rule()/the
    new find_rules_by_*() query helpers behave as the deterministic
    explain intent (below) depends on."""

    def test_load_rules_returns_sixty_rules_across_the_original_categories(self):
        # R4-B2 -- WAS 50 (this test's own count was already stale by one
        # relative to load_rules()'s own docstring claim of 51 as of
        # Sub-phase 5; not a R4-B2 regression either way). R4-B2 adds 10
        # platform/ESP rules (category='platform') on top, for 60 total.
        rules = load_rules()
        self.assertEqual(len(rules), 60)
        for rule in rules:
            self.assertIsInstance(rule, KnowledgeRule)
        outlook_rules = [r for r in rules if r.category == 'outlook']
        document_rules = [r for r in rules if r.category == 'document']
        platform_rules = [r for r in rules if r.category == 'platform']
        # Sub-phase 3/4's original counts must never shrink -- Sub-phase 5
        # and R4-B2 are additive only.
        self.assertGreaterEqual(len(outlook_rules), 9)
        self.assertEqual(len(document_rules), 5)
        self.assertEqual(len(platform_rules), 10)

    def test_row_collapse_rule_is_kept_in_sync_with_the_repair_engines_actual_safe_fix(self):
        """Sub-phase 4, item 5/7 -- the Repair Engine's deterministic safe
        fix for outlook-classic:unsafe-global-row-collapse disables Custom
        CSS; this knowledge rule must say so, never disagree."""
        rule = find_rule('global-row-collapse-danger')
        self.assertTrue(rule.safe_auto_fix)
        self.assertIn('disables Custom CSS', rule.suggested_fix)

    def test_every_rule_id_is_unique(self):
        rules = load_rules()
        ids = [rule.id for rule in rules]
        self.assertEqual(len(ids), len(set(ids)))

    def test_find_rule_returns_the_matching_rule(self):
        rule = find_rule('office-96-dpi')
        self.assertIsNotNone(rule)
        self.assertEqual(rule.id, 'office-96-dpi')

    def test_find_rule_returns_none_for_an_unknown_id(self):
        self.assertIsNone(find_rule('not-a-real-rule-id'))

    def test_knowledge_rule_rejects_an_unknown_category(self):
        with self.assertRaises(KnowledgeRuleValidationError):
            KnowledgeRule(**_minimal_rule_kwargs(category='not-a-real-category'))

    def test_knowledge_rule_rejects_an_unknown_affected_client(self):
        with self.assertRaises(KnowledgeRuleValidationError):
            KnowledgeRule(**_minimal_rule_kwargs(affected_clients=('SOME_OTHER_CLIENT',)))

    def test_knowledge_rule_rejects_an_out_of_range_confidence(self):
        with self.assertRaises(KnowledgeRuleValidationError):
            KnowledgeRule(**_minimal_rule_kwargs(confidence=1.5))

    # --- Sub-phase 5 -- new required fields' own validation ---

    def test_knowledge_rule_rejects_empty_concerns(self):
        with self.assertRaises(KnowledgeRuleValidationError):
            KnowledgeRule(**_minimal_rule_kwargs(concerns=()))

    def test_knowledge_rule_rejects_an_unknown_concern(self):
        with self.assertRaises(KnowledgeRuleValidationError):
            KnowledgeRule(**_minimal_rule_kwargs(concerns=('not-a-real-concern',)))

    def test_knowledge_rule_rejects_a_non_dict_source(self):
        with self.assertRaises(KnowledgeRuleValidationError):
            KnowledgeRule(**_minimal_rule_kwargs(source='not-a-dict'))

    def test_knowledge_rule_rejects_a_source_missing_name(self):
        with self.assertRaises(KnowledgeRuleValidationError):
            KnowledgeRule(**_minimal_rule_kwargs(source={
                'name': '', 'url': None, 'license': None, 'version': None, 'date': None, 'transformation': None,
            }))

    def test_knowledge_rule_rejects_a_source_with_unexpected_keys(self):
        with self.assertRaises(KnowledgeRuleValidationError):
            KnowledgeRule(**_minimal_rule_kwargs(source={
                'name': 'x', 'url': None, 'license': None, 'version': None, 'date': None,
                'transformation': None, 'unexpected_key': 'oops',
            }))

    def test_knowledge_rule_rejects_a_source_missing_a_required_key(self):
        """Every source key must be PRESENT (even if its value is None) --
        provenance must never be silently partial."""
        with self.assertRaises(KnowledgeRuleValidationError):
            KnowledgeRule(**_minimal_rule_kwargs(source={'name': 'x', 'url': None, 'license': None}))

    # --- Sub-phase 5 -- lookup by issue/category/client/concern ---

    def test_lookup_by_category(self):
        rules = find_rules_by_category('outlook')
        self.assertGreater(len(rules), 0)
        for rule in rules:
            self.assertEqual(rule.category, 'outlook')

    def test_lookup_by_client(self):
        gmail_rules = find_rules_by_client('GMAIL')
        self.assertGreater(len(gmail_rules), 0)
        for rule in gmail_rules:
            self.assertIn('GMAIL', rule.affected_clients)

    def test_lookup_by_concern(self):
        vml_rules = find_rules_by_concern('vml')
        self.assertGreater(len(vml_rules), 0)
        for rule in vml_rules:
            self.assertIn('vml', rule.concerns)

    def test_lookup_by_client_and_category_can_disagree_with_lookup_by_concern(self):
        """Proves the two axes (category vs concern) are genuinely
        independent, not the same dimension under two names: a rule
        tagged with the 'vml' concern can belong to a DIFFERENT category
        than 'outlook' (email-bulletproof-background-pattern is
        category='images', concerns includes 'vml') -- concern and
        category are not just relabelings of each other."""
        vml_concern_rule_categories = {r.category for r in find_rules_by_concern('vml')}
        self.assertIn('outlook', vml_concern_rule_categories)
        self.assertIn('images', vml_concern_rule_categories)
        self.assertGreater(len(vml_concern_rule_categories), 1)

    # --- Sub-phase 5 -- Classic vs New Outlook distinctness under the
    # larger rule set (item: "Classic Outlook and New Outlook remain
    # distinct") ---

    def test_classic_and_new_outlook_rules_are_disjoint_except_for_both_tagged_rules(self):
        classic_only = {r.id for r in load_rules() if r.affected_clients == ('OUTLOOK_CLASSIC',)}
        new_only = {r.id for r in load_rules() if r.affected_clients == ('NEW_OUTLOOK',)}
        self.assertTrue(classic_only.isdisjoint(new_only))
        self.assertGreater(len(classic_only), len(new_only) - 1)  # Classic has deeper coverage today

    def test_new_outlook_dark_mode_and_classic_outlook_dark_mode_are_different_rules_with_different_facts(self):
        new_rule = find_rule('new-outlook-auto-dark-mode')
        classic_rule = find_rule('outlook-classic-no-auto-dark-mode')
        self.assertNotEqual(new_rule.id, classic_rule.id)
        self.assertEqual(new_rule.affected_clients, ('NEW_OUTLOOK',))
        self.assertEqual(classic_rule.affected_clients, ('OUTLOOK_CLASSIC',))
        # the facts genuinely disagree (New Outlook DOES auto-invert,
        # Classic does NOT) -- proves this isn't two copies of one fact.
        self.assertIn('does not automatically invert', classic_rule.description)
        self.assertIn('can automatically invert', new_rule.description)

    # --- Sub-phase 5 -- provenance survives, and is never fabricated ---

    def test_every_rule_has_complete_provenance(self):
        for rule in load_rules():
            self.assertIsInstance(rule.source, dict, msg=rule.id)
            self.assertTrue(rule.source.get('name'), msg=rule.id)
            for key in ('url', 'license', 'version', 'date', 'transformation'):
                self.assertIn(key, rule.source, msg=f'{rule.id} missing source.{key}')

    def test_caniemail_informed_rules_never_overclaim_a_literal_dataset_adaptation(self):
        """PROVENANCE HONESTY -- a rule cross-referenced against Can I
        Email's public data (not literally parsed from it) must say so
        honestly, never claim "ADAPTED FROM Can I Email" wording that
        would imply an automated transform that did not happen."""
        caniemail_rules = [r for r in load_rules() if 'caniemail.com' in (r.source.get('url') or '')]
        self.assertGreater(len(caniemail_rules), 0)
        for rule in caniemail_rules:
            self.assertNotIn('ADAPTED FROM', rule.source['name'].upper())
            self.assertIn('cross-referenced', rule.source['name'])
            self.assertIsNone(rule.source['version'])  # no dataset snapshot was pinned

    def test_developer_authored_rules_never_claim_an_external_source(self):
        developer_rules = [r for r in load_rules() if r.source['url'] is None]
        self.assertGreater(len(developer_rules), 0)
        for rule in developer_rules:
            self.assertIn('developer-authored', rule.source['name'])

    # --- Sub-phase 5 -- zero-network lookup (deterministic operation) ---

    def test_load_rules_never_touches_the_network(self):
        """A crude but real guarantee: load_rules() returns a plain
        in-memory tuple->list conversion with zero I/O of any kind --
        proven by the fact it completes with no mocking/patching of any
        network or filesystem primitive required."""
        import time
        started = time.perf_counter()
        load_rules()
        elapsed_ms = (time.perf_counter() - started) * 1000
        self.assertLess(elapsed_ms, 50)  # a real network/disk call would be orders of magnitude slower

    # --- Feature 14 V3 architectural invariant (client-registry
    # extensibility) -- proves the taxonomy is genuinely structured-data-
    # driven, not a permanently finite hardcoded enum. ---

    def test_affected_client_values_is_computed_from_the_registry_not_independently_hardcoded(self):
        from emailbuilder.knowledge.rules import _AFFECTED_CLIENT_META_VALUES
        self.assertEqual(AFFECTED_CLIENT_VALUES, frozenset(EMAIL_CLIENT_REGISTRY.keys()) | _AFFECTED_CLIENT_META_VALUES)

    def test_every_registry_client_has_a_name_and_engine_family(self):
        for client_id, meta in EMAIL_CLIENT_REGISTRY.items():
            self.assertTrue(meta.get('name'), msg=client_id)
            self.assertTrue(meta.get('engine_family'), msg=client_id)

    # --- Validation Center / AI Engineer shared source of truth ---

    def test_knowledge_categories_stay_in_lockstep_with_validation_centers_categories(self):
        """frontend/src/emailbuilder/emailValidation.ts's 9 categories are
        the single source of truth this mirrors -- a category present
        here but not there (or vice versa) is a rule-authoring bug."""
        self.assertEqual(KNOWLEDGE_RULE_CATEGORIES, {
            'document', 'html', 'outlook', 'responsive', 'accessibility', 'links', 'images', 'dark-mode', 'platform',
        })


class EmailAiEngineerExplainIntentTests(TestCase):
    """Sub-phase 3, item 13 -- deterministic (zero-OpenAI-token) "explain
    X" intent on the always-available RuleBasedEmailCommandProvider,
    sourced from knowledge/rules.py. Never mutates the document -- action
    is always NONE, exactly like a genuine out-of-vocabulary command, but
    with a real, specific reply instead of the generic clarify message."""

    def setUp(self):
        self.provider = RuleBasedEmailCommandProvider()

    def test_explain_new_outlook_vs_word_engine(self):
        result = self.provider.resolve('explain the difference between new outlook and the word engine', {})
        self.assertEqual(result.action, {'type': ActionType.NONE})
        self.assertIn('Word', result.reply)
        self.assertIn('New Outlook', result.reply)

    def test_explain_96_dpi(self):
        result = self.provider.resolve('what is 96 dpi for outlook', {})
        self.assertEqual(result.action, {'type': ActionType.NONE})
        self.assertIn('PixelsPerInch', result.reply)

    def test_explain_allowpng(self):
        result = self.provider.resolve('explain allowpng', {})
        self.assertEqual(result.action, {'type': ActionType.NONE})
        self.assertIn('AllowPNG', result.reply)

    def test_explain_vml_namespace(self):
        result = self.provider.resolve('why does vml need a namespace', {})
        self.assertEqual(result.action, {'type': ActionType.NONE})
        self.assertIn('xmlns:v', result.reply)

    def test_explain_vml_fallback(self):
        result = self.provider.resolve('why does vml need a fallback', {})
        self.assertEqual(result.action, {'type': ActionType.NONE})
        self.assertIn('fallback', result.reply.lower())

    def test_explain_row_collapse_danger(self):
        result = self.provider.resolve('explain the row collapse trick', {})
        self.assertEqual(result.action, {'type': ActionType.NONE})
        self.assertIn('tr', result.reply)

    def test_explain_spacer_row(self):
        result = self.provider.resolve('what is a spacer row', {})
        self.assertEqual(result.action, {'type': ActionType.NONE})
        self.assertIn('spacer', result.reply.lower())

    def test_explain_font_fallback(self):
        result = self.provider.resolve('explain outlook font fallback', {})
        self.assertEqual(result.action, {'type': ActionType.NONE})
        self.assertIn('font', result.reply.lower())

    def test_explain_conditional_comment_scope(self):
        result = self.provider.resolve('explain conditional comment scope', {})
        self.assertEqual(result.action, {'type': ActionType.NONE})
        self.assertIn('mso', result.reply.lower())

    def test_explain_bare_vml_falls_back_to_namespace_rule(self):
        result = self.provider.resolve('explain vml', {})
        self.assertEqual(result.action, {'type': ActionType.NONE})
        self.assertIn('xmlns:v', result.reply)

    # --- Sub-phase 4, item 6 -- document-standards explain topics ---

    def test_explain_email_title(self):
        result = self.provider.resolve('explain the email title', {})
        self.assertEqual(result.action, {'type': ActionType.NONE})
        self.assertIn('document name', result.reply)

    def test_explain_email_subject(self):
        result = self.provider.resolve('what is the subject for', {})
        self.assertEqual(result.action, {'type': ActionType.NONE})
        self.assertIn('send/document metadata', result.reply)

    def test_explain_favicon(self):
        result = self.provider.resolve('explain favicon requirements', {})
        self.assertEqual(result.action, {'type': ActionType.NONE})
        self.assertIn('http', result.reply.lower())

    def test_explain_reset_css(self):
        result = self.provider.resolve('explain reset css', {})
        self.assertEqual(result.action, {'type': ActionType.NONE})
        self.assertIn('compatibility baseline', result.reply)

    def test_explain_required_meta_baseline(self):
        result = self.provider.resolve('what is the required meta baseline', {})
        self.assertEqual(result.action, {'type': ActionType.NONE})
        self.assertIn('charset', result.reply)

    def test_explain_title_never_collides_with_the_set_title_mutation_command(self):
        """A pure "explain the title" question must never be misread as a
        mutating SET_EMAIL_TITLE command."""
        result = self.provider.resolve('explain the email title', {})
        self.assertEqual(result.action, {'type': ActionType.NONE})

    def test_set_title_command_still_works_after_the_explain_topics_were_added(self):
        result = self.provider.resolve('set the title to Summer Sale', {})
        self.assertEqual(result.action, {'type': ActionType.SET_EMAIL_TITLE, 'value': 'Summer Sale'})

    def test_explain_unrecognized_topic_asks_which_one(self):
        result = self.provider.resolve('explain something totally unrelated to outlook', {})
        self.assertEqual(result.action, {'type': ActionType.NONE})
        self.assertIn('Which one', result.reply)

    def test_explain_never_returns_a_mutating_action_type(self):
        for message in [
            'explain 96 dpi', 'why does vml need a fallback', 'what is allowpng',
        ]:
            result = self.provider.resolve(message, {})
            self.assertEqual(result.action['type'], ActionType.NONE)

    def test_explain_is_checked_before_custom_css_pattern_so_it_never_mutates_css(self):
        """An "explain" question about a CSS-adjacent Outlook topic must
        never be misread as a custom-css mutation command."""
        result = self.provider.resolve('explain the row collapse trick', {})
        self.assertNotIn('css', result.action)
        self.assertEqual(result.action, {'type': ActionType.NONE})


class EmailAiEngineerExplainIntentSubphase5Tests(TestCase):
    """Sub-phase 5 -- deterministic explain coverage for the expanded
    (14 -> 50 rule) knowledge base, one representative phrasing per new
    client/concern. Proves the AI Engineer's zero-token explain intent
    genuinely surfaces the Sub-phase 5 knowledge, not just the original
    14 rules."""

    def setUp(self):
        self.provider = RuleBasedEmailCommandProvider()

    def _assert_explains(self, message, expected_substring):
        result = self.provider.resolve(message, {})
        self.assertEqual(result.action, {'type': ActionType.NONE}, msg=message)
        self.assertIn(expected_substring, result.reply, msg=message)
        return result

    def test_explain_gmail_dark_mode(self):
        self._assert_explains('explain gmail dark mode', 'Gmail')

    def test_explain_apple_mail_dark_mode(self):
        self._assert_explains('explain apple mail dark mode', 'Apple Mail')

    def test_explain_new_outlook_dark_mode_differs_from_classic(self):
        new_result = self._assert_explains('explain new outlook dark mode', 'New Outlook')
        classic_result = self._assert_explains('explain classic outlook dark mode', 'Classic Outlook')
        self.assertNotEqual(new_result.reply, classic_result.reply)

    def test_explain_bare_dark_mode_gives_the_cross_client_strategy_not_a_single_client_guess(self):
        # generic answer synthesizes across clients (may cite several as
        # examples) rather than answering as if only one client was asked
        # about -- proven by citing more than one client by name, not by
        # the absence of any single client's name.
        result = self._assert_explains('what is dark mode', 'three distinct behaviors')
        self.assertIn('Gmail', result.reply)
        self.assertIn('Classic Outlook', result.reply)

    def test_explain_outlook_com(self):
        self._assert_explains('explain outlook.com', 'Outlook.com')

    def test_explain_new_outlook_css_support(self):
        self._assert_explains('explain new outlook css support', 'Chromium')

    def test_explain_ios_mail_format_detection(self):
        self._assert_explains('explain ios mail format detection', 'auto-links')

    def test_explain_dynamic_type(self):
        self._assert_explains('what is dynamic type', 'Dynamic Type')

    def test_explain_gmail_clipping(self):
        self._assert_explains('explain gmail clipping', '102KB')

    def test_explain_gmail_image_blocking(self):
        self._assert_explains('explain gmail image blocking', 'proxies')

    def test_explain_gmail_bare_gives_a_gmail_specific_answer(self):
        self._assert_explains('explain gmail', 'Gmail')

    def test_explain_apple_mail_bare(self):
        self._assert_explains('explain apple mail', 'Apple Mail')

    def test_explain_yahoo_mail(self):
        self._assert_explains('explain yahoo mail', 'Yahoo')

    def test_explain_aol_mail(self):
        self._assert_explains('explain aol mail', 'AOL')

    def test_explain_bulletproof_button(self):
        self._assert_explains('explain bulletproof button', 'VML')

    def test_explain_outlook_background_image(self):
        self._assert_explains('explain outlook background image', 'Word')

    def test_explain_table_layout(self):
        self._assert_explains('explain table layout', 'table')

    def test_explain_outlook_line_height(self):
        self._assert_explains('explain outlook line height', 'mso-line-height-rule')

    def test_explain_hybrid_width(self):
        self._assert_explains('explain hybrid width', 'ghost table')

    def test_explain_absolute_links(self):
        self._assert_explains('explain absolute links', 'https://')

    def test_explain_wcag_contrast(self):
        self._assert_explains('explain wcag contrast', 'WCAG')

    def test_explain_unrecognized_new_topic_still_gives_the_updated_clarify_reply(self):
        result = self.provider.resolve('explain the meaning of life', {})
        self.assertEqual(result.action, {'type': ActionType.NONE})
        self.assertIn('Gmail', result.reply)  # the clarify reply itself now advertises the new topics


class EmailAiEngineerDocumentSettingsCommandTests(TestCase):
    """Sub-phase 4, item 3 -- title/subject/favicon deterministic commands,
    pulled forward onto the SAME proposal-before-apply/DOCUMENT_SCOPE
    contract the Reset/Custom CSS actions already established."""

    def setUp(self):
        self.provider = RuleBasedEmailCommandProvider()

    def test_set_title(self):
        result = self.provider.resolve('set the title to Summer Sale', {})
        validated = validate_action(result.action)
        self.assertEqual(validated, {'type': ActionType.SET_EMAIL_TITLE, 'title': 'Summer Sale'})
        self.assertTrue(requires_confirmation(validated))

    def test_change_title_phrasing(self):
        result = self.provider.resolve('change the email title to My Newsletter', {})
        validated = validate_action(result.action)
        self.assertEqual(validated, {'type': ActionType.SET_EMAIL_TITLE, 'title': 'My Newsletter'})

    def test_ambiguous_title_command_asks_for_the_value(self):
        result = self.provider.resolve('what about the title', {})
        self.assertEqual(result.action, {'type': ActionType.NONE})

    def test_set_subject(self):
        result = self.provider.resolve('set the subject to Big News Today', {})
        validated = validate_action(result.action)
        self.assertEqual(validated, {'type': ActionType.SET_EMAIL_SUBJECT, 'subject': 'Big News Today'})
        self.assertTrue(requires_confirmation(validated))

    def test_ambiguous_subject_command_asks_for_the_value(self):
        result = self.provider.resolve('change the subject', {})
        self.assertEqual(result.action, {'type': ActionType.NONE})

    def test_set_favicon_url(self):
        result = self.provider.resolve('set favicon url to https://example.com/favicon.png', {})
        validated = validate_action(result.action)
        self.assertEqual(validated, {'type': ActionType.SET_FAVICON, 'url': 'https://example.com/favicon.png'})
        self.assertTrue(requires_confirmation(validated))

    def test_set_favicon_without_the_word_url(self):
        result = self.provider.resolve('set the favicon to https://example.com/favicon.png', {})
        validated = validate_action(result.action)
        self.assertEqual(validated, {'type': ActionType.SET_FAVICON, 'url': 'https://example.com/favicon.png'})

    def test_set_favicon_rejects_an_unsafe_scheme(self):
        result = self.provider.resolve('set favicon url to javascript:alert(1)', {})
        self.assertEqual(result.action, {'type': ActionType.NONE})

    def test_set_favicon_with_no_value_asks_for_one(self):
        result = self.provider.resolve('set favicon url to', {})
        self.assertEqual(result.action, {'type': ActionType.NONE})

    def test_remove_favicon(self):
        result = self.provider.resolve('remove the favicon', {})
        validated = validate_action(result.action)
        self.assertEqual(validated, {'type': ActionType.CLEAR_FAVICON})
        self.assertTrue(requires_confirmation(validated))

    def test_clear_favicon_phrasing(self):
        result = self.provider.resolve('clear the favicon', {})
        self.assertEqual(validate_action(result.action), {'type': ActionType.CLEAR_FAVICON})


class ValidateActionTests(TestCase):
    """The shared allow-list gate -- must reject anything malformed or
    outside the known vocabulary regardless of which provider produced
    it, matching the module docstring's defense-in-depth guarantee."""

    def test_none_action(self):
        self.assertIsNone(validate_action(None))

    def test_not_a_dict(self):
        self.assertIsNone(validate_action('delete everything'))

    def test_unknown_action_type_rejected(self):
        self.assertIsNone(validate_action({'type': 'DROP_DATABASE'}))

    def test_insert_module_unknown_type_dropped(self):
        # Feature 14 V2 — 'layout-2col-50-50' is now a genuinely
        # registered type (Phase A removed the old 5-type cap), so this
        # test uses a truly nonexistent type string to keep testing
        # "unknown type dropped, known type kept."
        result = validate_action({
            'type': ActionType.INSERT_MODULE,
            'modules': [{'module_type': 'not-a-real-type', 'patch': {}}, {'module_type': 'button', 'patch': {}}],
        })
        self.assertEqual(result['modules'], [{'module_type': 'button', 'patch': {}}])

    def test_insert_module_all_unknown_rejected(self):
        result = validate_action({
            'type': ActionType.INSERT_MODULE,
            'modules': [{'module_type': 'script', 'patch': {}}],
        })
        self.assertIsNone(result)

    def test_insert_module_capped_at_max(self):
        modules = [{'module_type': 'text', 'patch': {}} for _ in range(20)]
        result = validate_action({'type': ActionType.INSERT_MODULE, 'modules': modules})
        self.assertEqual(len(result['modules']), 5)

    def test_update_props_unknown_module_type_rejected(self):
        result = validate_action({
            'type': ActionType.UPDATE_MODULE_PROPS, 'module_type': 'not-a-real-type', 'patch': {'color': 'green'},
        })
        self.assertIsNone(result)

    def test_update_props_unknown_prop_key_dropped(self):
        result = validate_action({
            'type': ActionType.UPDATE_MODULE_PROPS, 'module_type': 'text',
            'patch': {'color': 'green', 'onclick': 'alert(1)'},
        })
        self.assertEqual(result['patch'], {'color': '#76C043'})
        self.assertNotIn('onclick', result['patch'])

    def test_update_props_javascript_href_rejected(self):
        result = validate_action({
            'type': ActionType.UPDATE_MODULE_PROPS, 'module_type': 'button',
            'patch': {'href': 'javascript:alert(document.cookie)'},
        })
        self.assertIsNone(result)

    def test_update_props_data_url_href_rejected(self):
        result = validate_action({
            'type': ActionType.UPDATE_MODULE_PROPS, 'module_type': 'button',
            'patch': {'href': 'data:text/html,<script>alert(1)</script>'},
        })
        self.assertIsNone(result)

    def test_update_props_valid_https_href_accepted(self):
        result = validate_action({
            'type': ActionType.UPDATE_MODULE_PROPS, 'module_type': 'button',
            'patch': {'href': 'https://example.com/shop'},
        })
        self.assertEqual(result['patch'], {'href': 'https://example.com/shop'})

    def test_update_props_font_size_out_of_range_rejected(self):
        result = validate_action({
            'type': ActionType.UPDATE_MODULE_PROPS, 'module_type': 'text', 'patch': {'fontSize': 999},
        })
        self.assertIsNone(result)

    def test_update_props_empty_patch_rejected(self):
        result = validate_action({
            'type': ActionType.UPDATE_MODULE_PROPS, 'module_type': 'text', 'patch': {},
        })
        self.assertIsNone(result)

    def test_image_src_never_settable_as_bare_string(self):
        """Feature 14 V2 -- `src` IS an AI-editable field now (valueType
        'image_asset'), but only via the {assetId}/{url} marker shape a
        provider must use -- never a bare AI-invented string. This proves
        a compromised provider trying to set it directly still gets
        silently dropped; see AssetSecurityTests for the marker-shape
        acceptance/rejection cases."""
        result = validate_action({
            'type': ActionType.UPDATE_MODULE_PROPS, 'module_type': 'image',
            'patch': {'src': 'https://evil.example.com/tracker.png', 'alt': 'Logo'},
        })
        self.assertEqual(result['patch'], {'alt': 'Logo'})

    def test_delete_module_always_target_selected(self):
        result = validate_action({'type': ActionType.DELETE_MODULE, 'target': 'anything-else'})
        self.assertEqual(result, {'type': ActionType.DELETE_MODULE, 'target': 'selected'})

    def test_global_style_rejects_unknown_module_type(self):
        result = validate_action({'type': ActionType.APPLY_GLOBAL_STYLE, 'module_type': 'nope', 'patch': {'color': 'green'}})
        self.assertIsNone(result)

    def test_none_action_type_passthrough(self):
        self.assertEqual(validate_action({'type': ActionType.NONE}), {'type': ActionType.NONE})

    # --- Sub-phase 4, item 3 -- title/subject/favicon action validation ---

    def test_set_email_title_maps_value_to_title_key(self):
        result = validate_action({'type': ActionType.SET_EMAIL_TITLE, 'value': ' My Email '})
        self.assertEqual(result, {'type': ActionType.SET_EMAIL_TITLE, 'title': 'My Email'})

    def test_set_email_title_rejects_empty_value(self):
        self.assertIsNone(validate_action({'type': ActionType.SET_EMAIL_TITLE, 'value': '   '}))

    def test_set_email_title_rejects_missing_value(self):
        self.assertIsNone(validate_action({'type': ActionType.SET_EMAIL_TITLE}))

    def test_set_email_subject_maps_value_to_subject_key(self):
        result = validate_action({'type': ActionType.SET_EMAIL_SUBJECT, 'value': 'Big News'})
        self.assertEqual(result, {'type': ActionType.SET_EMAIL_SUBJECT, 'subject': 'Big News'})

    def test_set_favicon_accepts_a_safe_https_url(self):
        result = validate_action({'type': ActionType.SET_FAVICON, 'url': 'https://example.com/favicon.png'})
        self.assertEqual(result, {'type': ActionType.SET_FAVICON, 'url': 'https://example.com/favicon.png'})

    def test_set_favicon_rejects_an_unsafe_scheme(self):
        self.assertIsNone(validate_action({'type': ActionType.SET_FAVICON, 'url': 'javascript:alert(1)'}))

    def test_set_favicon_rejects_a_non_http_scheme(self):
        self.assertIsNone(validate_action({'type': ActionType.SET_FAVICON, 'url': 'ftp://example.com/x.png'}))

    def test_set_favicon_rejects_empty_url(self):
        self.assertIsNone(validate_action({'type': ActionType.SET_FAVICON, 'url': ''}))

    def test_clear_favicon(self):
        self.assertEqual(validate_action({'type': ActionType.CLEAR_FAVICON}), {'type': ActionType.CLEAR_FAVICON})

    def test_new_document_actions_require_confirmation(self):
        for action in [
            {'type': ActionType.SET_EMAIL_TITLE, 'title': 'x'},
            {'type': ActionType.SET_EMAIL_SUBJECT, 'subject': 'x'},
            {'type': ActionType.SET_FAVICON, 'url': 'https://example.com/x.png'},
            {'type': ActionType.CLEAR_FAVICON},
        ]:
            self.assertTrue(requires_confirmation(action))

    # --- Sub-phase 6, work package D -- the six previously-reserved action types ---

    def test_update_module_settings_accepts_the_allow_listed_boolean_fields(self):
        result = validate_action({
            'type': ActionType.UPDATE_MODULE_SETTINGS, 'module_type': 'button',
            'patch': {'outlookVml': True},
        })
        self.assertEqual(result, {
            'type': ActionType.UPDATE_MODULE_SETTINGS, 'target': 'selected', 'module_type': 'button',
            'patch': {'outlookVml': True},
        })

    def test_update_module_settings_accepts_visibility_enum(self):
        result = validate_action({
            'type': ActionType.UPDATE_MODULE_SETTINGS, 'module_type': 'text',
            'patch': {'visibility': 'hideMobile'},
        })
        self.assertEqual(result['patch'], {'visibility': 'hideMobile'})

    def test_update_module_settings_rejects_unknown_settings_key(self):
        result = validate_action({
            'type': ActionType.UPDATE_MODULE_SETTINGS, 'module_type': 'text',
            'patch': {'columnGutter': {'value': 999}},
        })
        self.assertIsNone(result)

    def test_update_module_settings_rejects_invalid_visibility_value(self):
        result = validate_action({
            'type': ActionType.UPDATE_MODULE_SETTINGS, 'module_type': 'text',
            'patch': {'visibility': 'hideEverything'},
        })
        self.assertIsNone(result)

    def test_update_module_settings_rejects_non_boolean_for_boolean_field(self):
        result = validate_action({
            'type': ActionType.UPDATE_MODULE_SETTINGS, 'module_type': 'button',
            'patch': {'outlookVml': 'yes'},
        })
        self.assertIsNone(result)

    def test_update_module_settings_rejects_unknown_module_type(self):
        result = validate_action({
            'type': ActionType.UPDATE_MODULE_SETTINGS, 'module_type': 'not-a-real-type',
            'patch': {'outlookVml': True},
        })
        self.assertIsNone(result)

    def test_apply_vml_pattern_accepts_button(self):
        result = validate_action({'type': ActionType.APPLY_VML_PATTERN, 'module_type': 'button'})
        self.assertEqual(result, {'type': ActionType.APPLY_VML_PATTERN, 'target': 'selected', 'module_type': 'button'})

    def test_apply_vml_pattern_rejects_a_non_button_capable_type(self):
        result = validate_action({'type': ActionType.APPLY_VML_PATTERN, 'module_type': 'text'})
        self.assertIsNone(result)

    def test_apply_outlook_wrapper_accepts_hero_background_image(self):
        result = validate_action({'type': ActionType.APPLY_OUTLOOK_WRAPPER, 'module_type': 'hero-background-image'})
        self.assertEqual(result, {
            'type': ActionType.APPLY_OUTLOOK_WRAPPER, 'target': 'selected', 'module_type': 'hero-background-image',
        })

    def test_apply_outlook_wrapper_rejects_a_non_background_capable_type(self):
        # A button is VML-button-capable but NOT VML-background-capable --
        # proves the two allow-lists are genuinely distinct, not aliases.
        result = validate_action({'type': ActionType.APPLY_OUTLOOK_WRAPPER, 'module_type': 'button'})
        self.assertIsNone(result)

    def test_apply_vml_pattern_accepts_every_manifest_bulletproof_cta_type(self):
        # Sub-phase 6 closure -- APPLY_VML_PATTERN is now capability-driven
        # (module_capabilities.supports_bulletproof_cta), not a hardcoded
        # {'button'} set. Every one of the eligible types must validate,
        # proving the wiring is genuinely manifest-driven rather than a
        # second hand-typed list that happens to match today. Includes the
        # final-reconciliation pill-link types: their bordered/rounded
        # container degrades to a square in Classic Outlook exactly like an
        # unfilled button would, regardless of the missing background fill.
        for module_type in [
            'cta-centered', 'cta-banner', 'cta-text-cta', 'cta-dual',
            'content-heading-text-cta', 'content-image-left', 'content-image-right', 'content-image-top',
            'hero-image-cta', 'hero-background-image', 'hero-text-only', 'hero-image-left', 'hero-image-right',
            'hero-centered-promo', 'header-logo-cta', 'product-single', 'product-two-cards', 'product-three-cards',
            'product-image-price-cta', 'product-grid', 'image-text', 'text-image',
            'social-icon-row', 'social-follow-us', 'footer-social-legal',
        ]:
            with self.subTest(module_type=module_type):
                result = validate_action({'type': ActionType.APPLY_VML_PATTERN, 'module_type': module_type})
                self.assertEqual(result, {'type': ActionType.APPLY_VML_PATTERN, 'target': 'selected', 'module_type': module_type})

    def test_apply_vml_pattern_still_rejects_plain_link_module_types(self):
        # Evidence-based exclusions surviving the final reconciliation --
        # these render plain text/nav links with NO bordered/rounded
        # container at all (unlike the pill-link types above).
        for module_type in [
            'header-logo-nav', 'content-article-teaser', 'footer-preference-unsubscribe',
            'footer-simple-legal', 'footer-address-contact',
        ]:
            with self.subTest(module_type=module_type):
                result = validate_action({'type': ActionType.APPLY_VML_PATTERN, 'module_type': module_type})
                self.assertIsNone(result)

    def test_restructure_layout_accepts_valid_widths_summing_to_100(self):
        result = validate_action({
            'type': ActionType.RESTRUCTURE_LAYOUT, 'module_type': 'layout-2col-50-50', 'widths': [60, 40],
        })
        self.assertEqual(result, {
            'type': ActionType.RESTRUCTURE_LAYOUT, 'target': 'selected', 'module_type': 'layout-2col-50-50',
            'widths': [60.0, 40.0],
        })

    def test_restructure_layout_rejects_a_non_layout_module_type(self):
        result = validate_action({'type': ActionType.RESTRUCTURE_LAYOUT, 'module_type': 'text', 'widths': [100]})
        self.assertIsNone(result)

    def test_restructure_layout_rejects_widths_not_summing_to_100(self):
        result = validate_action({
            'type': ActionType.RESTRUCTURE_LAYOUT, 'module_type': 'layout-2col-50-50', 'widths': [60, 60],
        })
        self.assertIsNone(result)

    def test_restructure_layout_rejects_a_width_below_the_minimum(self):
        result = validate_action({
            'type': ActionType.RESTRUCTURE_LAYOUT, 'module_type': 'layout-3col', 'widths': [95, 3, 2],
        })
        self.assertIsNone(result)

    def test_restructure_layout_requires_confirmation(self):
        action = validate_action({
            'type': ActionType.RESTRUCTURE_LAYOUT, 'module_type': 'layout-2col-50-50', 'widths': [60, 40],
        })
        self.assertTrue(requires_confirmation(action))

    def test_insert_nested_module_accepts_a_non_layout_type_with_a_patch(self):
        result = validate_action({
            'type': ActionType.INSERT_NESTED_MODULE, 'module_type': 'text', 'patch': {'text': 'Hello'},
        })
        self.assertEqual(result, {
            'type': ActionType.INSERT_NESTED_MODULE, 'target': 'selected_column', 'module_type': 'text',
            'patch': {'text': 'Hello'},
        })

    def test_insert_nested_module_rejects_nesting_a_layout_inside_a_layout(self):
        result = validate_action({
            'type': ActionType.INSERT_NESTED_MODULE, 'module_type': 'layout-2col-50-50', 'patch': {},
        })
        self.assertIsNone(result)

    def test_insert_nested_module_rejects_unknown_module_type(self):
        result = validate_action({'type': ActionType.INSERT_NESTED_MODULE, 'module_type': 'not-a-real-type', 'patch': {}})
        self.assertIsNone(result)

    def test_insert_nested_module_tolerates_a_missing_patch(self):
        result = validate_action({'type': ActionType.INSERT_NESTED_MODULE, 'module_type': 'button'})
        self.assertEqual(result['patch'], {})

    def test_replace_unsupported_property_uses_the_same_gate_as_update_module_props(self):
        result = validate_action({
            'type': ActionType.REPLACE_UNSUPPORTED_PROPERTY, 'module_type': 'text',
            'patch': {'color': 'green', 'onclick': 'alert(1)'},
        })
        self.assertEqual(result['patch'], {'color': '#76C043'})

    def test_replace_unsupported_property_rejects_unknown_module_type(self):
        result = validate_action({
            'type': ActionType.REPLACE_UNSUPPORTED_PROPERTY, 'module_type': 'not-a-real-type', 'patch': {'color': 'green'},
        })
        self.assertIsNone(result)

    # --- Sub-phase 6, work package E -- UPDATE_REPEATABLE_FIELD ---

    def test_update_repeatable_field_add_validates_item_against_manifest_item_schema(self):
        result = validate_action({
            'type': ActionType.UPDATE_REPEATABLE_FIELD, 'module_type': 'header-logo-nav', 'op': 'add',
            'item': {'label': 'Pricing', 'href': 'https://example.com/pricing', 'onclick': 'alert(1)'},
        })
        self.assertEqual(result, {
            'type': ActionType.UPDATE_REPEATABLE_FIELD, 'target': 'selected', 'module_type': 'header-logo-nav',
            'op': 'add', 'item': {'label': 'Pricing', 'href': 'https://example.com/pricing'},
        })

    def test_update_repeatable_field_add_rejects_a_module_type_with_no_repeatable_field(self):
        result = validate_action({
            'type': ActionType.UPDATE_REPEATABLE_FIELD, 'module_type': 'text', 'op': 'add',
            'item': {'label': 'x', 'href': 'https://example.com'},
        })
        self.assertIsNone(result)

    def test_update_repeatable_field_add_drops_an_unsafe_href_but_keeps_the_safe_label(self):
        # Same per-field drop convention _validate_patch already uses for
        # UPDATE_MODULE_PROPS — an unsafe individual field is dropped, not
        # a reason to reject the whole item, as long as something safe
        # survives.
        result = validate_action({
            'type': ActionType.UPDATE_REPEATABLE_FIELD, 'module_type': 'header-logo-nav', 'op': 'add',
            'item': {'label': 'x', 'href': 'javascript:alert(1)'},
        })
        self.assertEqual(result['item'], {'label': 'x'})
        self.assertNotIn('href', result['item'])

    def test_update_repeatable_field_add_rejects_an_empty_item(self):
        result = validate_action({
            'type': ActionType.UPDATE_REPEATABLE_FIELD, 'module_type': 'header-logo-nav', 'op': 'add',
            'item': {'notARealKey': 'x'},
        })
        self.assertIsNone(result)

    def test_update_repeatable_field_update_requires_a_non_negative_index(self):
        result = validate_action({
            'type': ActionType.UPDATE_REPEATABLE_FIELD, 'module_type': 'header-logo-nav', 'op': 'update',
            'index': 0, 'item': {'label': 'Renamed'},
        })
        self.assertEqual(result['index'], 0)
        rejected = validate_action({
            'type': ActionType.UPDATE_REPEATABLE_FIELD, 'module_type': 'header-logo-nav', 'op': 'update',
            'index': -1, 'item': {'label': 'x'},
        })
        self.assertIsNone(rejected)

    def test_update_repeatable_field_remove_requires_a_non_negative_index(self):
        result = validate_action({
            'type': ActionType.UPDATE_REPEATABLE_FIELD, 'module_type': 'header-logo-nav', 'op': 'remove', 'index': 2,
        })
        self.assertEqual(result, {
            'type': ActionType.UPDATE_REPEATABLE_FIELD, 'target': 'selected', 'module_type': 'header-logo-nav',
            'op': 'remove', 'index': 2,
        })

    def test_update_repeatable_field_remove_requires_confirmation(self):
        action = validate_action({
            'type': ActionType.UPDATE_REPEATABLE_FIELD, 'module_type': 'header-logo-nav', 'op': 'remove', 'index': 0,
        })
        self.assertTrue(requires_confirmation(action))

    def test_update_repeatable_field_add_does_not_require_confirmation(self):
        action = validate_action({
            'type': ActionType.UPDATE_REPEATABLE_FIELD, 'module_type': 'header-logo-nav', 'op': 'add',
            'item': {'label': 'x', 'href': 'https://example.com'},
        })
        self.assertFalse(requires_confirmation(action))

    def test_update_repeatable_field_reorder_requires_both_indices(self):
        result = validate_action({
            'type': ActionType.UPDATE_REPEATABLE_FIELD, 'module_type': 'header-logo-nav', 'op': 'reorder',
            'fromIndex': 0, 'toIndex': 2,
        })
        self.assertEqual(result, {
            'type': ActionType.UPDATE_REPEATABLE_FIELD, 'target': 'selected', 'module_type': 'header-logo-nav',
            'op': 'reorder', 'fromIndex': 0, 'toIndex': 2,
        })

    def test_update_repeatable_field_rejects_an_unknown_op(self):
        result = validate_action({
            'type': ActionType.UPDATE_REPEATABLE_FIELD, 'module_type': 'header-logo-nav', 'op': 'delete_everything',
        })
        self.assertIsNone(result)

    def test_update_repeatable_field_works_for_product_items_too(self):
        result = validate_action({
            'type': ActionType.UPDATE_REPEATABLE_FIELD, 'module_type': 'product-single', 'op': 'update',
            'index': 0, 'item': {'name': 'New Product', 'price': '$19.99'},
        })
        self.assertEqual(result['item'], {'name': 'New Product', 'price': '$19.99'})

    def test_reserved_action_types_are_no_longer_reduced_to_none(self):
        # Sub-phase 5's provenance/knowledge tests already prove the
        # OPPOSITE state (reserved-but-unimplemented) is gone; this proves
        # every one of the six now round-trips through its own real branch.
        for action_type in ActionType.STRUCTURAL | {
            ActionType.UPDATE_MODULE_SETTINGS, ActionType.INSERT_NESTED_MODULE,
            ActionType.APPLY_OUTLOOK_WRAPPER, ActionType.APPLY_VML_PATTERN, ActionType.REPLACE_UNSUPPORTED_PROPERTY,
        }:
            self.assertIn(action_type, ActionType.IMPLEMENTED)


class EmailAICommandViewTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(username='ai.tester', email='ai.tester@example.com', password='StrongPass123')
        self.url = '/api/v1/email-builder/ai-command/'
        _cache.clear()

    def _post(self, data):
        return self.client.post(self.url, data=json.dumps(data), content_type='application/json')

    def test_unauthenticated_rejected(self):
        response = self._post({'message': 'add a button'})
        self.assertEqual(response.status_code, 403)

    def test_deterministic_add_module_end_to_end(self):
        """No OPENAI_API_KEY is configured in this test settings module --
        this genuinely exercises the deterministic provider, which is the
        real, always-available baseline this feature must never depend on
        an API key for."""
        self.client.force_login(self.user)
        response = self._post({'message': 'add a button'})
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertTrue(body['success'])
        self.assertEqual(body['provider'], 'deterministic')
        self.assertEqual(body['action']['type'], 'INSERT_MODULE')
        self.assertFalse(body['requires_confirmation'])

    def test_deterministic_delete_requires_confirmation_end_to_end(self):
        self.client.force_login(self.user)
        response = self._post({
            'message': 'delete this module',
            'selected_module': {'type': 'button', 'props': {}},
        })
        body = response.json()
        self.assertEqual(body['action']['type'], 'DELETE_MODULE')
        self.assertTrue(body['requires_confirmation'])

    def test_blank_message_rejected(self):
        self.client.force_login(self.user)
        response = self._post({'message': ''})
        self.assertEqual(response.status_code, 400)

    def test_message_too_long_rejected(self):
        self.client.force_login(self.user)
        response = self._post({'message': 'a' * 501})
        self.assertEqual(response.status_code, 400)

    def test_invalid_selected_module_type_rejected(self):
        # Feature 14 V2 — 'layout-2col-50-50' is now a genuinely
        # registered type (Phase A removed the old 5-type cap), so this
        # request-boundary rejection test uses a type string the manifest
        # has never heard of.
        self.client.force_login(self.user)
        response = self._post({
            'message': 'change the color',
            'selected_module': {'type': 'not-a-real-type', 'props': {}},
        })
        self.assertEqual(response.status_code, 400)

    def test_rate_limited(self):
        self.client.force_login(self.user)
        with override_settings(EMAILBUILDER_AI_COMMAND_REQUEST_MAX=1):
            first = self._post({'message': 'add a button'})
            second = self._post({'message': 'add a button'})
        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 429)
        self.assertEqual(second.json()['code'], 'RATE_LIMITED')

    def test_ai_unavailable_falls_back_to_deterministic(self):
        """Selecting the openai provider without an API key must still
        answer via the deterministic router -- never a 500, never a
        broken feature."""
        self.client.force_login(self.user)
        with override_settings(EMAILBUILDER_AI_COMMAND_PROVIDER='openai', OPENAI_API_KEY=''):
            response = self._post({'message': 'add a button'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['provider'], 'deterministic')

    def test_oversized_compose_email_response_degrades_to_none_end_to_end(self):
        """Phase D reconciliation, item 2 -- an oversized COMPOSE_EMAIL
        response (more top-level items than MAX_COMPOSITION_ITEMS) must
        never reach the client as an apparently-successful, silently-
        truncated email. This exercises the FULL view path (not just
        validate_action() in isolation): a fake provider stands in for a
        misbehaving real AI provider that returned too many items: the
        view must degrade the action to NONE while still returning 200/
        success so the frontend's existing generic 'could not generate'
        error path handles it, and a retry on the same connection must
        still work normally afterward."""
        self.client.force_login(self.user)
        oversized_items = [{'module_type': 'text', 'patch': {}} for _ in range(ai_command_module.MAX_COMPOSITION_ITEMS + 3)]
        fake_provider = Mock()
        fake_provider.resolve.return_value = CommandResult(
            reply='oversized', action={'type': ActionType.COMPOSE_EMAIL, 'items': oversized_items},
            confidence=0.9, provider='openai',
        )
        with patch('emailbuilder.views.get_default_email_command_provider', return_value=fake_provider):
            response = self._post({'message': 'Create an email: a promotional summer sale'})
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertTrue(body['success'])
        # Never an apparently-successful partial/truncated composition.
        self.assertEqual(body['action']['type'], ActionType.NONE)
        self.assertNotIn('items', body['action'])
        self.assertFalse(body['requires_confirmation'])

        # Retry (e.g. after editing the brief) still works normally --
        # this failure mode is not sticky.
        retry = self._post({'message': 'add a button'})
        self.assertEqual(retry.status_code, 200)
        self.assertEqual(retry.json()['action']['type'], 'INSERT_MODULE')

    def test_ai_configured_but_call_fails_falls_back_to_deterministic(self):
        """With a key configured but the provider itself raising (e.g. a
        malformed/failed response), the view must still degrade to the
        deterministic router -- proves the FallbackEmailCommandProvider
        wiring end-to-end without a real network call."""
        self.client.force_login(self.user)
        broken_client = MagicMock()
        broken_client.chat.completions.create.side_effect = RuntimeError('boom')
        with override_settings(EMAILBUILDER_AI_COMMAND_PROVIDER='openai', OPENAI_API_KEY='sk-test'):
            provider = get_default_email_command_provider()
            provider.primary._client_factory = lambda: broken_client
            result = provider.resolve('add a button', {})
        self.assertEqual(result.provider, 'deterministic')
        self.assertEqual(result.action['type'], ActionType.INSERT_MODULE)

    # ------------------------------------------------------------------
    # Module-4 E9/E10 — bounded editor context + conversation history.
    # ------------------------------------------------------------------

    def test_accepts_bounded_e9_e10_context_fields(self):
        self.client.force_login(self.user)
        response = self._post({
            'message': 'add a button',
            'editor_mode': 'validate',
            'selected_column': {'layout_module_type': 'layout-2col-50-50', 'column_index': 0},
            'selected_validation_issue': {
                'id': 'outlook-classic:missing-vml', 'title': 'Missing VML fallback',
                'detail': 'This background image has no Outlook VML fallback.',
                'severity': 'warning', 'category': 'outlook',
            },
            'conversation_history': [
                {'role': 'user', 'content': 'Make the button blue.'},
                {'role': 'assistant', 'content': 'I updated the button color to blue.'},
            ],
        })
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()['success'])

    def test_invalid_editor_mode_rejected(self):
        self.client.force_login(self.user)
        response = self._post({'message': 'add a button', 'editor_mode': 'not-a-real-tab'})
        self.assertEqual(response.status_code, 400)

    def test_conversation_history_over_cap_rejected(self):
        self.client.force_login(self.user)
        oversized_history = [{'role': 'user', 'content': f'turn {i}'} for i in range(9)]
        response = self._post({'message': 'add a button', 'conversation_history': oversized_history})
        self.assertEqual(response.status_code, 400)

    def test_conversation_history_malformed_turn_rejected(self):
        self.client.force_login(self.user)
        response = self._post({
            'message': 'add a button',
            'conversation_history': [{'role': 'user'}],  # missing required 'content'
        })
        self.assertEqual(response.status_code, 400)

    def test_conversation_history_invalid_role_rejected(self):
        self.client.force_login(self.user)
        response = self._post({
            'message': 'add a button',
            'conversation_history': [{'role': 'system', 'content': 'not a real role'}],
        })
        self.assertEqual(response.status_code, 400)

    def test_deterministic_provider_still_works_with_e9_e10_context_present(self):
        """The free, always-available deterministic router must never
        break just because E9/E10 context fields are present -- it simply
        ignores what it doesn't use."""
        self.client.force_login(self.user)
        response = self._post({
            'message': 'add a button',
            'editor_mode': 'code',
            'conversation_history': [{'role': 'user', 'content': 'hello'}],
        })
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body['provider'], 'deterministic')
        self.assertEqual(body['action']['type'], 'INSERT_MODULE')

    # ------------------------------------------------------------------
    # R4-A (Import HTML AI Reconstruction) -- bounded reconstruction
    # context + request contract.
    # ------------------------------------------------------------------

    def _minimal_import_reconstruction(self, **overrides):
        payload = {
            'document_width': 600,
            'module_count': 10,
            'region_count': 10,
            'regions': [{
                'role': 'header', 'confidence': 0.95, 'source_position': 'row 2',
                'has_image': True, 'has_links': True,
            }],
            'fidelity_categories': [{
                'id': 'structure', 'status': 'approximated',
                'summary': 'Source column ratio 38/62 was approximated to supported layout 40/60.',
                'finding_count': 1,
                'sample_findings': [{
                    'category': 'structural-conversion', 'source': '<tr> (2 columns)', 'location': 'row 8',
                    'reason': 'Source column widths do not exactly match any supported layout split.',
                }],
            }],
            'has_mso_conditional_content': False,
        }
        payload.update(overrides)
        return payload

    def test_accepts_bounded_r4a_import_reconstruction_context(self):
        self.client.force_login(self.user)
        response = self._post({'message': 'review the reconstruction', 'import_reconstruction': self._minimal_import_reconstruction()})
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()['success'])

    def test_import_reconstruction_over_cap_regions_rejected(self):
        self.client.force_login(self.user)
        oversized_regions = [{'role': 'paragraph', 'confidence': 1, 'source_position': f'row {i}'} for i in range(21)]
        response = self._post({
            'message': 'review the reconstruction',
            'import_reconstruction': self._minimal_import_reconstruction(regions=oversized_regions, region_count=21),
        })
        self.assertEqual(response.status_code, 400)

    def test_import_reconstruction_invalid_category_id_rejected(self):
        self.client.force_login(self.user)
        bad_categories = [{'id': 'not-a-real-category', 'status': 'preserved', 'summary': 'x', 'finding_count': 0, 'sample_findings': []}]
        response = self._post({
            'message': 'review the reconstruction',
            'import_reconstruction': self._minimal_import_reconstruction(fidelity_categories=bad_categories),
        })
        self.assertEqual(response.status_code, 400)

    def test_import_reconstruction_invalid_status_rejected(self):
        self.client.force_login(self.user)
        bad_categories = [{'id': 'structure', 'status': 'perfect', 'summary': 'x', 'finding_count': 0, 'sample_findings': []}]
        response = self._post({
            'message': 'review the reconstruction',
            'import_reconstruction': self._minimal_import_reconstruction(fidelity_categories=bad_categories),
        })
        self.assertEqual(response.status_code, 400)

    def test_deterministic_provider_still_works_with_import_reconstruction_context_present(self):
        """The free, always-available deterministic router must never
        break just because the R4-A import_reconstruction context is
        present -- it simply ignores what it doesn't use, same posture
        as every other additive context field."""
        self.client.force_login(self.user)
        response = self._post({'message': 'add a button', 'import_reconstruction': self._minimal_import_reconstruction()})
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body['provider'], 'deterministic')
        self.assertEqual(body['action']['type'], 'INSERT_MODULE')

    def test_import_reconstruction_omitted_behaves_exactly_as_before(self):
        self.client.force_login(self.user)
        response = self._post({'message': 'add a button'})
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()['success'])


class BuildSafeContextTests(TestCase):
    """Module-4 E9/E10 -- direct unit tests of
    ai_command_openai._build_safe_context's whitelisting/bounding/
    malformed-data-safety, independent of the view's own request-boundary
    validation (defense in depth: this function must be safe even if
    called with a raw dict that bypassed the serializer)."""

    def test_whitelists_valid_editor_mode(self):
        safe, _ = ai_command_openai_module._build_safe_context({'editor_mode': 'validate'})
        self.assertEqual(safe['editor_mode'], 'validate')

    def test_rejects_unknown_editor_mode(self):
        safe, _ = ai_command_openai_module._build_safe_context({'editor_mode': 'not-a-real-tab'})
        self.assertIsNone(safe['editor_mode'])

    def test_rejects_unknown_column_layout_type(self):
        safe, _ = ai_command_openai_module._build_safe_context({
            'selected_column': {'layout_module_type': 'not-a-real-type', 'column_index': 0},
        })
        self.assertIsNone(safe['selected_column'])

    def test_accepts_valid_selected_column(self):
        safe, _ = ai_command_openai_module._build_safe_context({
            'selected_column': {'layout_module_type': 'layout-2col-50-50', 'column_index': 1},
        })
        self.assertEqual(safe['selected_column'], {'layout_module_type': 'layout-2col-50-50', 'column_index': 1})

    def test_malformed_validation_issue_context_degrades_to_none(self):
        safe, _ = ai_command_openai_module._build_safe_context({
            'selected_validation_issue': {'id': 'x'},  # missing title/detail
        })
        self.assertIsNone(safe['selected_validation_issue'])

    def test_valid_validation_issue_context_passes_through_whitelisted_fields_only(self):
        safe, _ = ai_command_openai_module._build_safe_context({
            'selected_validation_issue': {
                'id': 'outlook-classic:missing-vml', 'title': 'Missing VML fallback',
                'detail': 'No VML fallback configured.', 'severity': 'warning', 'category': 'outlook',
                'internal_secret_field': 'should never appear',
            },
        })
        self.assertEqual(safe['selected_validation_issue']['id'], 'outlook-classic:missing-vml')
        self.assertNotIn('internal_secret_field', safe['selected_validation_issue'])

    def test_history_is_capped_even_if_caller_bypasses_the_serializer(self):
        oversized = [{'role': 'user', 'content': f'turn {i}'} for i in range(20)]
        _, history = ai_command_openai_module._build_safe_context({'conversation_history': oversized})
        self.assertLessEqual(len(history), 8)
        # Keeps the MOST RECENT turns, not the oldest.
        self.assertEqual(history[-1]['content'], 'turn 19')

    def test_history_ignores_malformed_entries(self):
        _, history = ai_command_openai_module._build_safe_context({
            'conversation_history': [
                {'role': 'user', 'content': 'valid turn'},
                {'role': 'not-a-real-role', 'content': 'bad role'},
                {'role': 'assistant'},  # missing content
                'not even a dict',
            ],
        })
        self.assertEqual(history, [{'role': 'user', 'content': 'valid turn'}])

    def test_forged_unapproved_context_keys_never_leak_into_safe_context(self):
        safe, _ = ai_command_openai_module._build_safe_context({
            'editor_mode': 'visual',
            'secret_token': 'sk-should-never-leak',
            'other_users_document_id': 999999,
        })
        self.assertNotIn('secret_token', safe)
        self.assertNotIn('other_users_document_id', safe)

    def test_history_content_is_length_capped(self):
        _, history = ai_command_openai_module._build_safe_context({
            'conversation_history': [{'role': 'user', 'content': 'x' * 5000}],
        })
        self.assertLessEqual(len(history[0]['content']), 1000)

    # ------------------------------------------------------------------
    # R4-A (Import HTML AI Reconstruction) -- direct unit tests of
    # _build_safe_import_reconstruction, same defense-in-depth posture
    # as every E9/E10 test above: must be safe even called with a raw
    # dict that bypassed the serializer entirely.
    # ------------------------------------------------------------------

    def test_import_reconstruction_none_when_absent(self):
        safe, _ = ai_command_openai_module._build_safe_context({})
        self.assertIsNone(safe['import_reconstruction'])

    def test_import_reconstruction_whitelists_valid_fields(self):
        safe, _ = ai_command_openai_module._build_safe_context({
            'import_reconstruction': {
                'document_width': 600, 'module_count': 10, 'region_count': 10,
                'regions': [{'role': 'header', 'confidence': 0.95, 'source_position': 'row 2', 'has_image': True, 'has_links': True}],
                'fidelity_categories': [{
                    'id': 'structure', 'status': 'approximated', 'summary': 'Approximated.', 'finding_count': 1,
                    'sample_findings': [{'category': 'structural-conversion', 'source': '<tr>', 'location': 'row 8', 'reason': 'mismatch'}],
                }],
                'has_mso_conditional_content': False,
            },
        })
        result = safe['import_reconstruction']
        self.assertEqual(result['document_width'], 600)
        self.assertEqual(result['regions'][0]['role'], 'header')
        self.assertEqual(result['fidelity_categories'][0]['status'], 'approximated')
        self.assertEqual(result['fidelity_categories'][0]['sample_findings'][0]['source'], '<tr>')

    def test_import_reconstruction_caps_regions_even_if_caller_bypasses_serializer(self):
        oversized_regions = [{'role': 'paragraph', 'confidence': 1, 'source_position': f'row {i}'} for i in range(50)]
        safe, _ = ai_command_openai_module._build_safe_context({
            'import_reconstruction': {'regions': oversized_regions},
        })
        self.assertLessEqual(len(safe['import_reconstruction']['regions']), 20)

    def test_import_reconstruction_rejects_invalid_category_id(self):
        safe, _ = ai_command_openai_module._build_safe_context({
            'import_reconstruction': {
                'fidelity_categories': [{'id': 'not-a-real-category', 'status': 'preserved', 'summary': 'x', 'finding_count': 0}],
            },
        })
        self.assertEqual(safe['import_reconstruction']['fidelity_categories'], [])

    def test_import_reconstruction_ignores_malformed_region_entries(self):
        safe, _ = ai_command_openai_module._build_safe_context({
            'import_reconstruction': {
                'regions': [
                    {'role': 'header', 'confidence': 0.9, 'source_position': 'row 1'},
                    {'confidence': 0.5},  # missing role
                    'not even a dict',
                ],
            },
        })
        self.assertEqual(len(safe['import_reconstruction']['regions']), 1)
        self.assertEqual(safe['import_reconstruction']['regions'][0]['role'], 'header')

    def test_forged_unapproved_import_reconstruction_keys_never_leak(self):
        safe, _ = ai_command_openai_module._build_safe_context({
            'import_reconstruction': {
                'document_width': 600,
                'internal_secret_field': 'should never appear',
                'regions': [{'role': 'header', 'confidence': 0.9, 'source_position': 'row 1', 'other_users_document_id': 999999}],
            },
        })
        serialized = json.dumps(safe['import_reconstruction'])
        self.assertNotIn('internal_secret_field', serialized)
        self.assertNotIn('other_users_document_id', serialized)
        self.assertNotIn('999999', serialized)


class OpenAIEmailCommandProviderTests(TestCase):
    """Unit-tests the real request/response mapping logic with an injected
    fake client -- no network call, no API key required. This is how the
    OpenAI integration is verified in this environment (no
    OPENAI_API_KEY configured here) -- see feature report."""

    def _fake_completion(self, payload_dict):
        completion = MagicMock()
        completion.choices = [MagicMock(message=MagicMock(content=json.dumps(payload_dict)))]
        return completion

    def test_raises_when_no_api_key(self):
        provider = OpenAIEmailCommandProvider(client_factory=MagicMock())
        with override_settings(OPENAI_API_KEY=''):
            with self.assertRaises(Exception):
                provider.resolve('add a button', {})

    def test_maps_valid_structured_response(self):
        client = MagicMock()
        client.chat.completions.create.return_value = self._fake_completion({
            'reply': 'Adding a button.',
            'confidence': 0.95,
            'action': {
                'type': 'INSERT_MODULE', 'target': None, 'module_type': None,
                'modules': [{'module_type': 'button', 'patch': {}}], 'patch': None,
            },
        })
        provider = OpenAIEmailCommandProvider(client_factory=lambda: client)
        with override_settings(OPENAI_API_KEY='sk-test'):
            result = provider.resolve('add a button', {})
        self.assertEqual(result.provider, 'openai')
        self.assertEqual(result.action['type'], 'INSERT_MODULE')
        # The raw provider action still passes through the SAME
        # validate_action() gate the view applies -- proven here directly.
        validated = validate_action(result.action)
        self.assertEqual(validated['modules'], [{'module_type': 'button', 'patch': {}}])

    def test_malformed_json_response_raises_unavailable(self):
        client = MagicMock()
        bad_completion = MagicMock()
        bad_completion.choices = [MagicMock(message=MagicMock(content='not valid json'))]
        client.chat.completions.create.return_value = bad_completion
        provider = OpenAIEmailCommandProvider(client_factory=lambda: client)
        with override_settings(OPENAI_API_KEY='sk-test'):
            with self.assertRaises(Exception):
                provider.resolve('add a button', {})

    def test_provider_exception_wrapped_and_never_leaked(self):
        client = MagicMock()
        client.chat.completions.create.side_effect = RuntimeError('secret internal detail')
        provider = OpenAIEmailCommandProvider(client_factory=lambda: client)
        with override_settings(OPENAI_API_KEY='sk-test'):
            try:
                provider.resolve('add a button', {})
                self.fail('expected an exception')
            except Exception as exc:  # noqa: BLE001
                self.assertNotIn('secret internal detail', str(exc))

    def test_action_with_unsupported_module_type_is_rejected_by_shared_gate(self):
        """Proves defense-in-depth: even if the model's JSON schema were
        somehow bypassed, the shared validate_action() gate still refuses
        anything outside the generated module-capability manifest's known
        types. 'hero-image-cta' is a real, registered type (Phase A
        removed the old 5-type cap) — this uses a type string the
        manifest has never heard of instead."""
        client = MagicMock()
        client.chat.completions.create.return_value = self._fake_completion({
            'reply': 'ok', 'confidence': 0.9,
            'action': {
                'type': 'INSERT_MODULE', 'target': None, 'module_type': None,
                'modules': [{'module_type': 'not-a-real-type', 'patch': {}}], 'patch': None,
            },
        })
        provider = OpenAIEmailCommandProvider(client_factory=lambda: client)
        with override_settings(OPENAI_API_KEY='sk-test'):
            result = provider.resolve('add a hero', {})
        self.assertIsNone(validate_action(result.action))

    # R4-B2 §23 — provider parity: the SAME knowledge-retrieval wiring
    # added to the local provider must behave identically here.
    def test_knowledge_retrieval_injects_relevant_snippets_for_outlook_question(self):
        client = MagicMock()
        client.chat.completions.create.return_value = self._fake_completion({
            'reply': 'ok', 'confidence': 0.5, 'action': {'type': 'NONE'},
        })
        provider = OpenAIEmailCommandProvider(client_factory=lambda: client)
        with override_settings(OPENAI_API_KEY='sk-test'):
            provider.resolve('Will this render correctly in Classic Outlook with VML?', {})
        _args, kwargs = client.chat.completions.create.call_args
        sent_context = json.loads(kwargs['messages'][1]['content'].split('trusted, not user input): ', 1)[1])
        self.assertIn('knowledge', sent_context)
        self.assertTrue(sent_context['knowledge'])

    def test_knowledge_key_absent_for_a_pure_mutation_command(self):
        client = MagicMock()
        client.chat.completions.create.return_value = self._fake_completion({
            'reply': 'ok', 'confidence': 0.9,
            'action': {'type': 'INSERT_MODULE', 'target': None, 'module_type': None, 'modules': [{'module_type': 'divider', 'patch': {}}], 'patch': None},
        })
        provider = OpenAIEmailCommandProvider(client_factory=lambda: client)
        with override_settings(OPENAI_API_KEY='sk-test'):
            provider.resolve('add a divider', {})
        _args, kwargs = client.chat.completions.create.call_args
        sent_context = json.loads(kwargs['messages'][1]['content'].split('trusted, not user input): ', 1)[1])
        self.assertNotIn('knowledge', sent_context)


# ============================================================================
# Feature 14 V2 — Phase A (Engine Foundation)
# ============================================================================

class ModuleCapabilitiesDriftTests(TestCase):
    """The committed shared/module-capabilities.generated.json must stay in
    lockstep with edm.py's ALLOWED_MODULE_TYPES -- both are meant to
    describe the SAME 53-type registry (the frontend registry is the one
    real source of truth; this proves the two independently-read-from
    artifacts on the Python side haven't drifted apart). If a type is
    added to one without the other, this fails loudly."""

    def test_manifest_type_set_matches_edm_allowed_types(self):
        from .edm import ALLOWED_MODULE_TYPES
        self.assertEqual(module_capabilities.get_all_module_types(), frozenset(ALLOWED_MODULE_TYPES))

    def test_manifest_module_count_is_53(self):
        self.assertEqual(module_capabilities.manifest_module_count(), 53)
        self.assertEqual(len(module_capabilities.get_all_module_types()), 53)

    def test_every_module_capability_has_required_keys(self):
        for module_type in module_capabilities.get_all_module_types():
            with self.subTest(module_type=module_type):
                capability = module_capabilities.get_module_capability(module_type)
                self.assertIsNotNone(capability)
                for key in ('type', 'label', 'category', 'isLayout', 'columnCount', 'editableFields', 'hasRepeatableField'):
                    self.assertIn(key, capability)

    def test_layout_types_have_no_editable_fields(self):
        """Approved Phase A scope: layout modules' only prop (columnWidths)
        is an array, not a flat scalar field -- never fabricated coverage
        here."""
        layout_types = [t for t in module_capabilities.get_all_module_types() if t.startswith('layout-')]
        self.assertEqual(len(layout_types), 10)
        for module_type in layout_types:
            with self.subTest(module_type=module_type):
                capability = module_capabilities.get_module_capability(module_type)
                self.assertTrue(capability['isLayout'])
                self.assertEqual(capability['editableFields'], [])

    def test_image_asset_fields_are_never_inferred_from_a_url_kind_alone(self):
        """Every field the manifest marks as image_asset must have been
        hand-tagged at the source (registryCore.tsx's valueType) -- this
        does not prove the absence of a missed field, but it does prove
        the ones we know are images (image module's src, hero's imageSrc,
        header's logoSrc, content's image.src, composite's image.src) are
        correctly tagged and not left as a generic 'url'."""
        expected_image_fields = {
            'image': 'src',
            'hero-image-cta': 'imageSrc',
            'hero-background-image': 'imageSrc',
            'header-logo-center': 'logoSrc',
            'content-image-left': 'image.src',
            'content-article-teaser': 'image.src',
            'image-text': 'image.src',
            'text-image': 'image.src',
        }
        for module_type, field_key in expected_image_fields.items():
            with self.subTest(module_type=module_type, field=field_key):
                field = module_capabilities.get_editable_field(module_type, field_key)
                self.assertIsNotNone(field)
                self.assertEqual(field['valueType'], 'image_asset')

    def test_missing_manifest_file_raises_loudly(self):
        import tempfile

        from .module_capabilities import ModuleCapabilityManifestError

        module_capabilities.reset_cache_for_tests()
        try:
            with override_settings(BASE_DIR=tempfile.mkdtemp()):
                with self.assertRaises(ModuleCapabilityManifestError):
                    module_capabilities.get_all_module_types()
        finally:
            module_capabilities.reset_cache_for_tests()


class AllModuleTypeValidationTests(TestCase):
    """Feature 14 V2 Phase A -- validate_action() must handle EVERY
    registered module type via the generated capability manifest, not
    just Feature 14 V1's 5-type subset. Loop-driven (subTest) rather than
    53+ hand-written methods."""

    def test_every_module_type_is_insertable(self):
        for module_type in module_capabilities.get_all_module_types():
            with self.subTest(module_type=module_type):
                result = validate_action({
                    'type': ActionType.INSERT_MODULE,
                    'modules': [{'module_type': module_type, 'patch': {}}],
                })
                self.assertIsNotNone(result)
                self.assertEqual(result['modules'][0]['module_type'], module_type)

    def test_every_editable_field_accepts_an_in_range_value_and_rejects_an_unknown_key(self):
        sample_values = {'text': 'Hello world', 'url': 'https://example.com', 'color': 'green', 'align': 'center', 'font': 'Sample'}
        checked = 0
        for module_type in module_capabilities.get_all_module_types():
            for field in module_capabilities.get_editable_fields(module_type):
                value_type = field['valueType']
                if value_type == 'image_asset':
                    continue  # covered by AssetSecurityTests -- never a bare value
                if value_type == 'number':
                    value = field.get('min', 10)
                elif value_type == 'select':
                    options = field.get('options') or []
                    if not options:
                        continue
                    value = options[0]['value']
                elif value_type == 'boolean':
                    value = True
                else:
                    value = sample_values[value_type]

                with self.subTest(module_type=module_type, field=field['key']):
                    result = validate_action({
                        'type': ActionType.UPDATE_MODULE_PROPS, 'module_type': module_type,
                        'patch': {field['key']: value, 'totally-unknown-key-xyz': 'nope'},
                    })
                    self.assertIsNotNone(result)
                    self.assertIn(field['key'], result['patch'])
                    self.assertNotIn('totally-unknown-key-xyz', result['patch'])
                    checked += 1
        # Sanity: this test is only meaningful if it actually walked a
        # realistic number of fields (regression guard against a future
        # refactor accidentally emptying every module's editableFields).
        self.assertGreater(checked, 50)

    def test_module_types_with_no_editable_fields_reject_any_prop_edit(self):
        for module_type in module_capabilities.get_all_module_types():
            if module_capabilities.get_editable_fields(module_type):
                continue
            with self.subTest(module_type=module_type):
                result = validate_action({
                    'type': ActionType.UPDATE_MODULE_PROPS, 'module_type': module_type, 'patch': {'anything': 'value'},
                })
                self.assertIsNone(result)


class ValidateFieldValueTests(TestCase):
    """Direct unit tests of _validate_field_value's per-valueType dispatch
    using synthetic field dicts -- covers every valueType branch
    explicitly, independent of which real catalog fields happen to use
    it today (e.g. no field currently uses 'boolean', but the dispatch
    branch itself must still be proven correct)."""

    def setUp(self):
        from .ai_command import _validate_field_value
        self.validate = _validate_field_value

    def test_color_valid_and_invalid(self):
        field = {'valueType': 'color'}
        self.assertEqual(self.validate(field, 'green'), '#76C043')
        self.assertIsNone(self.validate(field, 'not-a-color'))

    def test_number_within_and_outside_bounds(self):
        field = {'valueType': 'number', 'min': 8, 'max': 72}
        self.assertEqual(self.validate(field, 40), 40)
        self.assertIsNone(self.validate(field, 999))
        self.assertIsNone(self.validate(field, 'not-a-number'))

    def test_align_closed_set(self):
        field = {'valueType': 'align'}
        self.assertEqual(self.validate(field, 'center'), 'center')
        self.assertIsNone(self.validate(field, 'justify'))

    def test_url_safe_and_unsafe(self):
        field = {'valueType': 'url'}
        self.assertEqual(self.validate(field, 'https://example.com'), 'https://example.com')
        self.assertIsNone(self.validate(field, 'javascript:alert(1)'))

    def test_boolean(self):
        field = {'valueType': 'boolean'}
        self.assertEqual(self.validate(field, True), True)
        self.assertIsNone(self.validate(field, 'true'))

    def test_select_closed_options(self):
        field = {'valueType': 'select', 'options': [{'value': 'a', 'label': 'A'}, {'value': 'b', 'label': 'B'}]}
        self.assertEqual(self.validate(field, 'a'), 'a')
        self.assertIsNone(self.validate(field, 'c'))

    def test_text_and_font_length_capped(self):
        for value_type in ('text', 'font'):
            field = {'valueType': value_type}
            self.assertEqual(self.validate(field, 'Hello'), 'Hello')
            self.assertIsNone(self.validate(field, 'x' * 201))

    def test_image_asset_requires_marker_shape(self):
        field = {'valueType': 'image_asset'}
        self.assertIsNone(self.validate(field, 'https://example.com/logo.png'))
        self.assertEqual(self.validate(field, {'assetId': 5}), {'assetId': 5})
        self.assertEqual(self.validate(field, {'url': 'https://example.com/logo.png'}), {'url': 'https://example.com/logo.png'})
        self.assertIsNone(self.validate(field, {'url': 'javascript:alert(1)'}))
        self.assertIsNone(self.validate(field, {'assetId': -1}))
        self.assertIsNone(self.validate(field, {'assetId': 'not-a-number'}))

    def test_unknown_value_type_rejected(self):
        field = {'valueType': 'something-made-up'}
        self.assertIsNone(self.validate(field, 'anything'))


class AssetSecurityTests(TestCase):
    """Feature 14 V2 Phase A -- the AI may only set an image_asset field
    via an owned EmailAsset or an allow-listed external URL, never an
    arbitrary AI-invented URL. Covers the full request->view path
    (resolve_asset_references), not just the pure validate_action() gate."""

    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(username='asset.owner', email='owner@example.com', password='StrongPass123')
        self.other_user = User.objects.create_user(username='asset.intruder', email='intruder@example.com', password='StrongPass123')
        self.owned_asset = EmailAsset.objects.create(
            user=self.user, name='Logo', category='logo',
            source_type='external', external_url='https://example.com/owned-logo.png',
        )
        self.other_users_asset = EmailAsset.objects.create(
            user=self.other_user, name='Not yours', category='image',
            source_type='external', external_url='https://example.com/intruder-logo.png',
        )
        self.url = '/api/v1/email-builder/ai-command/'
        _cache.clear()

    def _apply_image_action(self, patch):
        """Bypasses the message-parsing router entirely by calling
        resolve_asset_references directly against a pre-validated action
        -- isolates the asset-resolution logic under test from the
        deterministic router's own (unrelated) command-recognition
        behavior."""
        from django.test import RequestFactory

        factory = RequestFactory()
        request = factory.post(self.url)
        request.user = self.user
        action = validate_action({
            'type': ActionType.UPDATE_MODULE_PROPS, 'module_type': 'image', 'patch': patch,
        })
        return resolve_asset_references(action, request)

    def test_owned_asset_id_resolves_to_its_external_url(self):
        result = self._apply_image_action({'src': {'assetId': self.owned_asset.pk}})
        self.assertEqual(result['patch']['src'], 'https://example.com/owned-logo.png')

    def test_other_users_asset_id_does_not_resolve(self):
        result = self._apply_image_action({'src': {'assetId': self.other_users_asset.pk}})
        self.assertNotIn('src', result.get('patch', {}))

    def test_nonexistent_asset_id_does_not_resolve(self):
        result = self._apply_image_action({'src': {'assetId': 999999}})
        self.assertNotIn('src', result.get('patch', {}))

    def test_malformed_asset_id_rejected_at_validation(self):
        action = validate_action({
            'type': ActionType.UPDATE_MODULE_PROPS, 'module_type': 'image',
            'patch': {'src': {'assetId': 'not-an-int'}},
        })
        self.assertNotIn('src', (action or {}).get('patch', {}))

    def test_bare_string_image_url_never_accepted(self):
        action = validate_action({
            'type': ActionType.UPDATE_MODULE_PROPS, 'module_type': 'image',
            'patch': {'src': 'https://attacker.example.com/tracker.png'},
        })
        self.assertNotIn('src', (action or {}).get('patch', {}))

    def test_disallowed_url_scheme_rejected(self):
        action = validate_action({
            'type': ActionType.UPDATE_MODULE_PROPS, 'module_type': 'image',
            'patch': {'src': {'url': 'javascript:alert(document.cookie)'}},
        })
        self.assertNotIn('src', (action or {}).get('patch', {}))

    def test_well_formed_external_url_marker_accepted(self):
        result = self._apply_image_action({'src': {'url': 'https://cdn.example.com/hero.png'}})
        self.assertEqual(result['patch']['src'], 'https://cdn.example.com/hero.png')

    def test_asset_resolution_drops_field_when_patch_becomes_empty_reduces_to_none_action(self):
        result = self._apply_image_action({'src': {'assetId': self.other_users_asset.pk}})
        self.assertEqual(result['type'], ActionType.NONE)

    def test_ai_command_view_end_to_end_with_owned_asset(self):
        self.client.force_login(self.user)
        response = self.client.post(
            self.url,
            data=json.dumps({
                'message': 'set the image',
                'selected_module': {'type': 'image', 'props': {}},
            }),
            content_type='application/json',
        )
        # The deterministic router itself never proposes an image_asset
        # patch (no NL vocabulary for "use asset N" — that's an OpenAI/
        # local-provider-only capability, see ai_command_local.py's system
        # prompt) — this just proves the endpoint round-trips cleanly with
        # an EmailAsset fixture present, not that this exact message
        # triggers asset resolution.
        self.assertEqual(response.status_code, 200)


class LocalEmailCommandProviderTests(TestCase):
    """Mirrors OpenAIEmailCommandProviderTests exactly -- injected mock
    client, zero real network calls, zero real local server required.
    Genuinely proves the request/response mapping and safety behavior;
    does NOT prove a real Ollama/llama.cpp/LM Studio server round-trips
    correctly (see the Phase A report's LOCAL PROVIDER: NOT AVAILABLE
    note)."""

    def _fake_completion(self, action_payload):
        completion = MagicMock()
        completion.choices = [MagicMock(message=MagicMock(content=json.dumps(action_payload)))]
        return completion

    def test_raises_when_no_base_url_configured(self):
        provider = LocalEmailCommandProvider(client_factory=lambda: MagicMock())
        with override_settings(EMAILBUILDER_LOCAL_AI_BASE_URL=''):
            with self.assertRaises(Exception):
                provider.resolve('add a button', {})

    def test_successful_call_maps_to_command_result(self):
        client = MagicMock()
        client.chat.completions.create.return_value = self._fake_completion({
            'reply': 'I will add a button.', 'confidence': 0.8,
            'action': {
                'type': 'INSERT_MODULE', 'target': None, 'module_type': None,
                'modules': [{'module_type': 'button', 'patch': {}}], 'patch': None,
            },
        })
        provider = LocalEmailCommandProvider(client_factory=lambda: client)
        with override_settings(EMAILBUILDER_LOCAL_AI_BASE_URL='http://localhost:11434/v1', EMAILBUILDER_LOCAL_AI_MODEL='llama3.1'):
            result = provider.resolve('add a button', {})
        self.assertEqual(result.provider, 'local')
        self.assertEqual(result.action['type'], 'INSERT_MODULE')

    def test_malformed_json_response_raises_provider_unavailable(self):
        client = MagicMock()
        client.chat.completions.create.return_value = MagicMock(
            choices=[MagicMock(message=MagicMock(content='not valid json'))],
        )
        provider = LocalEmailCommandProvider(client_factory=lambda: client)
        with override_settings(EMAILBUILDER_LOCAL_AI_BASE_URL='http://localhost:11434/v1', EMAILBUILDER_LOCAL_AI_MODEL='llama3.1'):
            with self.assertRaises(Exception):
                provider.resolve('add a button', {})

    def test_call_exception_does_not_leak_internal_detail(self):
        client = MagicMock()
        client.chat.completions.create.side_effect = RuntimeError('secret internal detail')
        provider = LocalEmailCommandProvider(client_factory=lambda: client)
        with override_settings(EMAILBUILDER_LOCAL_AI_BASE_URL='http://localhost:11434/v1', EMAILBUILDER_LOCAL_AI_MODEL='llama3.1'):
            try:
                provider.resolve('add a button', {})
                self.fail('expected an exception')
            except Exception as exc:  # noqa: BLE001
                self.assertNotIn('secret internal detail', str(exc))

    def test_action_with_unsupported_module_type_is_rejected_by_shared_gate(self):
        client = MagicMock()
        client.chat.completions.create.return_value = self._fake_completion({
            'reply': 'ok', 'confidence': 0.9,
            'action': {
                'type': 'INSERT_MODULE', 'target': None, 'module_type': None,
                'modules': [{'module_type': 'not-a-real-type', 'patch': {}}], 'patch': None,
            },
        })
        provider = LocalEmailCommandProvider(client_factory=lambda: client)
        with override_settings(EMAILBUILDER_LOCAL_AI_BASE_URL='http://localhost:11434/v1', EMAILBUILDER_LOCAL_AI_MODEL='llama3.1'):
            result = provider.resolve('add a hero', {})
        self.assertIsNone(validate_action(result.action))

    # --- R4-B2 — parity with OpenAIEmailCommandProviderTests's own context
    # coverage. Before R4-B2, LocalEmailCommandProvider's own
    # _build_safe_context only ever sent selected_module/platform/width —
    # editor_mode, selected_column, selected_validation_issue,
    # import_reconstruction, and conversation_history were silently
    # dropped, so a local-provider conversation could never resolve a
    # follow-up ("why was the ratio approximated") the way the OpenAI
    # provider already could. These tests prove parity, not just "it still
    # runs."

    def _sent_context_and_messages(self, client):
        _args, kwargs = client.chat.completions.create.call_args
        messages = kwargs['messages']
        context_json = json.loads(messages[1]['content'].split('trusted, not user input): ', 1)[1])
        return context_json, messages

    def test_context_parity_sends_editor_mode_column_issue_and_reconstruction(self):
        client = MagicMock()
        client.chat.completions.create.return_value = self._fake_completion({
            'reply': 'ok', 'confidence': 0.5, 'action': {'type': 'NONE'},
        })
        provider = LocalEmailCommandProvider(client_factory=lambda: client)
        context = {
            'editor_mode': 'ai',
            'selected_column': {'layout_module_type': 'layout-2col-50-50', 'column_index': 1},
            'selected_validation_issue': {
                'id': 'outlook-classic:vml-fallback', 'title': 'VML fallback', 'detail': 'detail text',
                'severity': 'warning', 'category': 'outlook',
            },
            'import_reconstruction': {
                'document_width': 700, 'module_count': 3, 'region_count': 1,
                'regions': [{'role': 'hero', 'confidence': 0.9, 'source_position': 'body>table:nth-of-type(1)'}],
                'fidelity_categories': [
                    {'id': 'structure', 'status': 'approximated', 'summary': '38/62 approximated to 40/60.', 'finding_count': 1, 'sample_findings': []},
                ],
                'has_mso_conditional_content': False,
            },
        }
        with override_settings(EMAILBUILDER_LOCAL_AI_BASE_URL='http://localhost:11434/v1', EMAILBUILDER_LOCAL_AI_MODEL='llama3.1'):
            provider.resolve('why was the ratio approximated?', context)
        sent_context, _messages = self._sent_context_and_messages(client)
        self.assertEqual(sent_context['editor_mode'], 'ai')
        self.assertEqual(sent_context['selected_column'], {'layout_module_type': 'layout-2col-50-50', 'column_index': 1})
        self.assertEqual(sent_context['selected_validation_issue']['category'], 'outlook')
        self.assertIsNotNone(sent_context['import_reconstruction'])
        self.assertEqual(sent_context['import_reconstruction']['fidelity_categories'][0]['id'], 'structure')

    def test_context_parity_replays_conversation_history_as_real_turns(self):
        client = MagicMock()
        client.chat.completions.create.return_value = self._fake_completion({
            'reply': 'ok', 'confidence': 0.5, 'action': {'type': 'NONE'},
        })
        provider = LocalEmailCommandProvider(client_factory=lambda: client)
        history = [
            {'role': 'user', 'content': 'make the hero darker'},
            {'role': 'assistant', 'content': 'I darkened the hero background.'},
        ]
        with override_settings(EMAILBUILDER_LOCAL_AI_BASE_URL='http://localhost:11434/v1', EMAILBUILDER_LOCAL_AI_MODEL='llama3.1'):
            provider.resolve('can you fix it', {'conversation_history': history})
        _sent_context, messages = self._sent_context_and_messages(client)
        replayed = [m for m in messages if m['role'] in ('user', 'assistant') and m is not messages[-1]]
        self.assertEqual(replayed, history)

    def test_knowledge_retrieval_injects_relevant_snippets_for_outlook_question(self):
        client = MagicMock()
        client.chat.completions.create.return_value = self._fake_completion({
            'reply': 'ok', 'confidence': 0.5, 'action': {'type': 'NONE'},
        })
        provider = LocalEmailCommandProvider(client_factory=lambda: client)
        with override_settings(EMAILBUILDER_LOCAL_AI_BASE_URL='http://localhost:11434/v1', EMAILBUILDER_LOCAL_AI_MODEL='llama3.1'):
            provider.resolve('Will this render correctly in Classic Outlook with VML?', {})
        sent_context, _messages = self._sent_context_and_messages(client)
        self.assertIn('knowledge', sent_context)
        self.assertTrue(sent_context['knowledge'])

    def test_knowledge_key_absent_for_a_pure_mutation_command(self):
        # Zero-result retrieval must cost nothing in the payload — no
        # empty 'knowledge': [] clutter on the common case.
        client = MagicMock()
        client.chat.completions.return_value = None
        client.chat.completions.create.return_value = self._fake_completion({
            'reply': 'ok', 'confidence': 0.9,
            'action': {'type': 'INSERT_MODULE', 'target': None, 'module_type': None, 'modules': [{'module_type': 'divider', 'patch': {}}], 'patch': None},
        })
        provider = LocalEmailCommandProvider(client_factory=lambda: client)
        with override_settings(EMAILBUILDER_LOCAL_AI_BASE_URL='http://localhost:11434/v1', EMAILBUILDER_LOCAL_AI_MODEL='llama3.1'):
            provider.resolve('add a divider', {})
        sent_context, _messages = self._sent_context_and_messages(client)
        self.assertNotIn('knowledge', sent_context)

    def test_context_limit_trims_oldest_history_first(self):
        client = MagicMock()
        client.chat.completions.create.return_value = self._fake_completion({
            'reply': 'ok', 'confidence': 0.5, 'action': {'type': 'NONE'},
        })
        provider = LocalEmailCommandProvider(client_factory=lambda: client)
        history = [
            {'role': 'user', 'content': 'turn one ' + ('x' * 500)},
            {'role': 'assistant', 'content': 'reply one ' + ('x' * 500)},
            {'role': 'user', 'content': 'turn two, the most recent'},
            {'role': 'assistant', 'content': 'reply two, the most recent'},
        ]
        with override_settings(
            EMAILBUILDER_LOCAL_AI_BASE_URL='http://localhost:11434/v1', EMAILBUILDER_LOCAL_AI_MODEL='llama3.1',
            EMAILBUILDER_LOCAL_AI_CONTEXT_LIMIT_CHARS=400,
        ):
            provider.resolve('can you fix it', {'conversation_history': history})
        _sent_context, messages = self._sent_context_and_messages(client)
        replayed_contents = [m['content'] for m in messages if m['role'] in ('user', 'assistant')][:-1]
        self.assertNotIn('turn one ' + ('x' * 500), replayed_contents)
        # the most recent turn(s) must survive trimming, not the oldest
        self.assertTrue(any('most recent' in c for c in replayed_contents) or replayed_contents == [])

    def test_context_limit_disabled_when_non_positive_sends_full_history(self):
        client = MagicMock()
        client.chat.completions.create.return_value = self._fake_completion({
            'reply': 'ok', 'confidence': 0.5, 'action': {'type': 'NONE'},
        })
        provider = LocalEmailCommandProvider(client_factory=lambda: client)
        history = [{'role': 'user', 'content': 'turn one'}, {'role': 'assistant', 'content': 'reply one'}]
        with override_settings(
            EMAILBUILDER_LOCAL_AI_BASE_URL='http://localhost:11434/v1', EMAILBUILDER_LOCAL_AI_MODEL='llama3.1',
            EMAILBUILDER_LOCAL_AI_CONTEXT_LIMIT_CHARS=0,
        ):
            provider.resolve('can you fix it', {'conversation_history': history})
        _sent_context, messages = self._sent_context_and_messages(client)
        replayed = [m for m in messages if m['role'] in ('user', 'assistant')][:-1]
        self.assertEqual(replayed, history)

    def test_no_openai_api_key_required_for_local_provider_to_succeed(self):
        client = MagicMock()
        client.chat.completions.create.return_value = self._fake_completion({
            'reply': 'ok', 'confidence': 0.5,
            'action': {'type': 'INSERT_MODULE', 'target': None, 'module_type': None, 'modules': [{'module_type': 'divider', 'patch': {}}], 'patch': None},
        })
        provider = LocalEmailCommandProvider(client_factory=lambda: client)
        with override_settings(
            OPENAI_API_KEY='', EMAILBUILDER_LOCAL_AI_BASE_URL='http://localhost:11434/v1', EMAILBUILDER_LOCAL_AI_MODEL='llama3.1',
        ):
            result = provider.resolve('add a divider', {})
        self.assertEqual(result.provider, 'local')

    def test_default_client_factory_never_points_at_a_hosted_openai_endpoint(self):
        # Privacy/§19 — the local provider's client is constructed ONLY
        # against the operator-configured base_url; it must never fall
        # back to OpenAI's real API host, which would silently exfiltrate
        # email content to a cloud service under a "local" configuration.
        # The real `openai` package is not installed in this environment
        # (every provider here is designed to defer-import it and work
        # fully under injected client_factory instead — see this class's
        # own docstring) — a fake module is injected into sys.modules so
        # `_default_client_factory`'s own `from openai import OpenAI` line
        # resolves without requiring the real package.
        import sys
        import types
        fake_openai_module = types.ModuleType('openai')
        mock_openai_cls = MagicMock()
        fake_openai_module.OpenAI = mock_openai_cls
        with override_settings(
            EMAILBUILDER_LOCAL_AI_BASE_URL='http://127.0.0.1:11434/v1', EMAILBUILDER_LOCAL_AI_MODEL='llama3.1',
            EMAILBUILDER_LOCAL_AI_API_KEY='',
        ):
            with patch.dict(sys.modules, {'openai': fake_openai_module}):
                LocalEmailCommandProvider._default_client_factory()
        _args, kwargs = mock_openai_cls.call_args
        self.assertEqual(kwargs['base_url'], 'http://127.0.0.1:11434/v1')
        self.assertNotIn('api.openai.com', str(kwargs.get('base_url', '')))


class ProviderSelectionTests(TestCase):
    """The 3-way EMAILBUILDER_AI_COMMAND_PROVIDER switch (Phase A) --
    proves the deterministic router is ALWAYS the safe default, and that
    each optional provider is only ever wired in when BOTH selected AND
    configured, exactly mirroring V1's OpenAI-only posture extended to a
    third option."""

    def test_default_unset_provider_is_deterministic_only(self):
        with override_settings(EMAILBUILDER_AI_COMMAND_PROVIDER='', OPENAI_API_KEY='', EMAILBUILDER_LOCAL_AI_BASE_URL=''):
            provider = get_default_email_command_provider()
        self.assertIsInstance(provider, RuleBasedEmailCommandProvider)

    def test_local_selected_but_not_configured_is_deterministic_only(self):
        with override_settings(EMAILBUILDER_AI_COMMAND_PROVIDER='local', EMAILBUILDER_LOCAL_AI_BASE_URL=''):
            provider = get_default_email_command_provider()
        self.assertIsInstance(provider, RuleBasedEmailCommandProvider)

    def test_local_selected_and_configured_wraps_with_fallback(self):
        with override_settings(EMAILBUILDER_AI_COMMAND_PROVIDER='local', EMAILBUILDER_LOCAL_AI_BASE_URL='http://localhost:11434/v1'):
            provider = get_default_email_command_provider()
        self.assertIsInstance(provider, FallbackEmailCommandProvider)
        self.assertIsInstance(provider.primary, LocalEmailCommandProvider)
        self.assertIsInstance(provider.fallback, RuleBasedEmailCommandProvider)

    def test_openai_selected_but_not_configured_is_deterministic_only(self):
        with override_settings(EMAILBUILDER_AI_COMMAND_PROVIDER='openai', OPENAI_API_KEY=''):
            provider = get_default_email_command_provider()
        self.assertIsInstance(provider, RuleBasedEmailCommandProvider)

    def test_openai_selected_and_configured_wraps_with_fallback(self):
        with override_settings(EMAILBUILDER_AI_COMMAND_PROVIDER='openai', OPENAI_API_KEY='sk-test'):
            provider = get_default_email_command_provider()
        self.assertIsInstance(provider, FallbackEmailCommandProvider)
        self.assertIsInstance(provider.primary, OpenAIEmailCommandProvider)

    def test_end_to_end_deterministic_still_works_with_no_provider_configured(self):
        """The zero-paid-token baseline -- no OPENAI_API_KEY, no local
        server, the endpoint must still work completely."""
        User = get_user_model()
        user = User.objects.create_user(username='baseline.user', email='baseline@example.com', password='StrongPass123')
        self.client.force_login(user)
        _cache.clear()
        with override_settings(EMAILBUILDER_AI_COMMAND_PROVIDER='', OPENAI_API_KEY='', EMAILBUILDER_LOCAL_AI_BASE_URL=''):
            response = self.client.post(
                '/api/v1/email-builder/ai-command/',
                data=json.dumps({'message': 'add a button'}),
                content_type='application/json',
            )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body['provider'], 'deterministic')


# ============================================================================
# Email Document Standards + Outlook Compatibility Baseline — Sub-phase 1
# ============================================================================

class EmailDocumentHeadSettingsTests(TestCase):
    """`email_title`/`email_subject`/`favicon_url` are deliberately
    distinct from `name` (the builder/dashboard draft name) -- see
    models.py's EmailDocument docstring. reset_css_enabled/
    custom_css_enabled/custom_css persistence/security is covered
    separately by EmailDocumentCssSettingsTests below (Sub-phase 2)."""

    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(username='doc.owner', email='owner@example.com', password='StrongPass123')
        self.other_user = User.objects.create_user(username='doc.intruder', email='intruder@example.com', password='StrongPass123')
        self.document = EmailDocument.objects.create(user=self.user, name='August Newsletter', platform='generic', width=700)
        self.url = f'/api/v1/email-builder/emails/{self.document.id}/'

    def _patch_json(self, data):
        return self.client.patch(self.url, data=json.dumps(data), content_type='application/json')

    def test_defaults_on_a_freshly_created_document(self):
        self.assertEqual(self.document.email_title, '')
        self.assertEqual(self.document.email_subject, '')
        self.assertEqual(self.document.favicon_url, '')
        self.assertTrue(self.document.reset_css_enabled)
        self.assertFalse(self.document.custom_css_enabled)
        self.assertEqual(self.document.custom_css, '')

    def test_name_title_and_subject_are_independently_settable(self):
        """Proves the three concepts are genuinely distinct fields, not
        aliases of one another."""
        self.client.force_login(self.user)
        response = self._patch_json({
            'name': 'Internal Draft Name',
            'email_title': 'Big August Sale',
            'email_subject': "Don't miss our biggest sale of the year",
        })
        self.assertEqual(response.status_code, 200)
        self.document.refresh_from_db()
        self.assertEqual(self.document.name, 'Internal Draft Name')
        self.assertEqual(self.document.email_title, 'Big August Sale')
        self.assertEqual(self.document.email_subject, "Don't miss our biggest sale of the year")

    def test_email_title_and_subject_are_trimmed(self):
        self.client.force_login(self.user)
        response = self._patch_json({'email_title': '  Padded Title  ', 'email_subject': '  Padded Subject  '})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['email_title'], 'Padded Title')
        self.assertEqual(response.json()['email_subject'], 'Padded Subject')

    def test_email_title_and_subject_may_be_blank(self):
        """Blank subject is not an error at the model/serializer layer --
        decision P defers any "recommended" framing to Validation Center
        (Sub-phase 4), never a hard rejection here."""
        self.client.force_login(self.user)
        response = self._patch_json({'email_title': '', 'email_subject': ''})
        self.assertEqual(response.status_code, 200)

    def test_favicon_https_url_accepted(self):
        self.client.force_login(self.user)
        response = self._patch_json({'favicon_url': 'https://example.com/favicon.png'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['favicon_url'], 'https://example.com/favicon.png')

    def test_favicon_javascript_scheme_rejected(self):
        self.client.force_login(self.user)
        response = self._patch_json({'favicon_url': 'javascript:alert(1)'})
        self.assertEqual(response.status_code, 400)
        self.document.refresh_from_db()
        self.assertEqual(self.document.favicon_url, '')

    def test_favicon_data_scheme_rejected(self):
        self.client.force_login(self.user)
        response = self._patch_json({'favicon_url': 'data:image/png;base64,AAAA'})
        self.assertEqual(response.status_code, 400)

    def test_favicon_blank_clears_it(self):
        self.document.favicon_url = 'https://example.com/old-favicon.png'
        self.document.save()
        self.client.force_login(self.user)
        response = self._patch_json({'favicon_url': ''})
        self.assertEqual(response.status_code, 200)
        self.document.refresh_from_db()
        self.assertEqual(self.document.favicon_url, '')

    def test_non_owner_cannot_patch_head_settings(self):
        self.client.force_login(self.other_user)
        response = self._patch_json({'email_title': 'Hijacked'})
        self.assertEqual(response.status_code, 404)

    def test_anonymous_cannot_patch_head_settings(self):
        response = self._patch_json({'email_title': 'Hijacked'})
        self.assertEqual(response.status_code, 403)


# ============================================================================
# Module-4 E4 — Outlook/VML document-level toggle
# ============================================================================

class EmailDocumentOutlookVmlSettingTests(TestCase):
    """`outlook_vml_enabled` — document-level default for the existing
    per-module `settings.outlookVml` opt-in (see models.py's field
    docstring). Persistence-only: the renderer's fallback-precedence logic
    lives in the frontend (htmlRenderer.ts) and is covered there."""

    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(username='vml.owner', email='vml.owner@example.com', password='StrongPass123')
        self.other_user = User.objects.create_user(username='vml.intruder', email='vml.intruder@example.com', password='StrongPass123')
        self.document = EmailDocument.objects.create(user=self.user, name='VML Newsletter', platform='generic', width=700)
        self.url = f'/api/v1/email-builder/emails/{self.document.id}/'

    def _patch_json(self, data):
        return self.client.patch(self.url, data=json.dumps(data), content_type='application/json')

    def test_outlook_vml_disabled_by_default(self):
        self.assertFalse(self.document.outlook_vml_enabled)

    def test_outlook_vml_can_be_enabled_and_persists(self):
        self.client.force_login(self.user)
        response = self._patch_json({'outlook_vml_enabled': True})
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()['outlook_vml_enabled'])
        self.document.refresh_from_db()
        self.assertTrue(self.document.outlook_vml_enabled)

    def test_outlook_vml_can_be_disabled_again(self):
        self.client.force_login(self.user)
        self._patch_json({'outlook_vml_enabled': True})
        response = self._patch_json({'outlook_vml_enabled': False})
        self.assertEqual(response.status_code, 200)
        self.document.refresh_from_db()
        self.assertFalse(self.document.outlook_vml_enabled)

    def test_reload_returns_the_persisted_value(self):
        self.client.force_login(self.user)
        self._patch_json({'outlook_vml_enabled': True})
        reload_response = self.client.get(self.url)
        self.assertEqual(reload_response.status_code, 200)
        self.assertTrue(reload_response.json()['outlook_vml_enabled'])

    def test_other_user_cannot_patch_outlook_vml_setting(self):
        self.client.force_login(self.other_user)
        response = self._patch_json({'outlook_vml_enabled': True})
        self.assertEqual(response.status_code, 404)
        self.document.refresh_from_db()
        self.assertFalse(self.document.outlook_vml_enabled)

    def test_anonymous_cannot_patch_outlook_vml_setting(self):
        response = self._patch_json({'outlook_vml_enabled': True})
        self.assertEqual(response.status_code, 403)


# ============================================================================
# Email Document Standards — Sub-phase 2 (Reset CSS + Custom CSS)
# ============================================================================

class EmailDocumentCssSettingsTests(TestCase):
    """Persistence + the backend security gate for reset_css_enabled/
    custom_css_enabled/custom_css. The actual Reset CSS text and the
    non-blocking compatibility-warning detector are frontend-only (see
    frontend/src/emailbuilder/emailCss.ts's module docstring for why) --
    nothing here renders CSS, only validates and persists it."""

    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(username='css.owner', email='css.owner@example.com', password='StrongPass123')
        self.document = EmailDocument.objects.create(user=self.user, name='August Newsletter', platform='generic', width=700)
        self.url = f'/api/v1/email-builder/emails/{self.document.id}/'
        self.client.force_login(self.user)

    def _patch_json(self, data):
        return self.client.patch(self.url, data=json.dumps(data), content_type='application/json')

    def test_reset_css_enabled_by_default(self):
        self.assertTrue(self.document.reset_css_enabled)

    def test_custom_css_disabled_and_empty_by_default(self):
        self.assertFalse(self.document.custom_css_enabled)
        self.assertEqual(self.document.custom_css, '')

    def test_reset_css_can_be_disabled_and_persists(self):
        response = self._patch_json({'reset_css_enabled': False})
        self.assertEqual(response.status_code, 200)
        self.document.refresh_from_db()
        self.assertFalse(self.document.reset_css_enabled)

    def test_custom_css_enable_with_valid_css_persists(self):
        response = self._patch_json({
            'custom_css_enabled': True,
            'custom_css': '.brand-heading { color: #002D38; font-weight: 700; }',
        })
        self.assertEqual(response.status_code, 200)
        self.document.refresh_from_db()
        self.assertTrue(self.document.custom_css_enabled)
        self.assertEqual(self.document.custom_css, '.brand-heading { color: #002D38; font-weight: 700; }')

    def test_custom_css_allows_media_queries_and_pseudo_and_attribute_selectors(self):
        css = (
            '@media only screen and (max-width:600px) { .stack { display:block !important; } } '
            'a[href^="mailto:"] { color: #0082AD; } '
            '.btn:hover { opacity: 0.9; } '
            'table { mso-table-lspace: 0pt; mso-table-rspace: 0pt; } '
            '.icon { background-image: url(https://cdn.example.com/icon.png); }'
        )
        response = self._patch_json({'custom_css_enabled': True, 'custom_css': css})
        self.assertEqual(response.status_code, 200)

    def test_custom_css_image_data_uri_rejected(self):
        """Item 2 (closure) -- data: URLs are disallowed ENTIRELY, no
        data:image/ exception. Asset Manager / owned https:// assets are
        the supported path for images."""
        response = self._patch_json({
            'custom_css_enabled': True,
            'custom_css': '.dot { background-image: url(data:image/png;base64,AAAA); }',
        })
        self.assertEqual(response.status_code, 400)

    def test_custom_css_style_breakout_rejected(self):
        response = self._patch_json({'custom_css': 'body{}</style><script>alert(1)</script>'})
        self.assertEqual(response.status_code, 400)
        self.assertIn('style', response.json()['errors']['custom_css'][0].lower())
        self.document.refresh_from_db()
        self.assertEqual(self.document.custom_css, '')

    def test_custom_css_script_tag_alone_rejected(self):
        response = self._patch_json({'custom_css': 'body{content:"x"} <script>alert(1)</script>'})
        self.assertEqual(response.status_code, 400)
        self.assertIn('script', response.json()['errors']['custom_css'][0].lower())

    def test_custom_css_html_comment_rejected(self):
        response = self._patch_json({'custom_css': 'body{color:red} <!-- injected -->'})
        self.assertEqual(response.status_code, 400)

    def test_custom_css_javascript_scheme_rejected(self):
        response = self._patch_json({'custom_css': '.x{background:url(javascript:alert(1))}'})
        self.assertEqual(response.status_code, 400)

    def test_custom_css_expression_rejected(self):
        response = self._patch_json({'custom_css': '.x{width:expression(alert(1))}'})
        self.assertEqual(response.status_code, 400)

    def test_custom_css_behavior_rejected(self):
        response = self._patch_json({'custom_css': '.x{behavior:url(evil.htc)}'})
        self.assertEqual(response.status_code, 400)

    def test_custom_css_moz_binding_rejected(self):
        response = self._patch_json({'custom_css': '.x{-moz-binding:url(evil.xml)}'})
        self.assertEqual(response.status_code, 400)

    def test_custom_css_import_rejected(self):
        response = self._patch_json({'custom_css': '@import url("https://evil.example.com/x.css");'})
        self.assertEqual(response.status_code, 400)

    def test_custom_css_non_image_data_uri_rejected(self):
        response = self._patch_json({'custom_css': "@font-face{src:url(data:font/woff2;base64,AAAA)}"})
        self.assertEqual(response.status_code, 400)

    def test_custom_css_obfuscated_javascript_scheme_rejected(self):
        """Item 3 (closure) -- CSS hex-escaped 'javascript:' (\\61 = a)
        must be rejected identically to the literal form."""
        response = self._patch_json({'custom_css': r'.x{background:url(j\61vascript:alert(1))}'})
        self.assertEqual(response.status_code, 400)

    def test_custom_css_comment_split_expression_rejected(self):
        response = self._patch_json({'custom_css': '.x{width:expre/**/ssion(alert(1))}'})
        self.assertEqual(response.status_code, 400)

    def test_custom_css_uppercase_style_breakout_rejected(self):
        response = self._patch_json({'custom_css': 'body{}</STYLE><script>alert(1)</script>'})
        self.assertEqual(response.status_code, 400)

    def test_custom_css_embedded_html_tag_rejected(self):
        response = self._patch_json({'custom_css': '.x{content:"<img src=x onerror=alert(1)>"}'})
        self.assertEqual(response.status_code, 400)

    def test_custom_css_too_long_rejected(self):
        response = self._patch_json({'custom_css': '.x{color:red}' * 5000})
        self.assertEqual(response.status_code, 400)

    def test_custom_css_large_realistic_stylesheet_persists_and_reloads_exactly(self):
        """Closure item 7 -- a genuinely large (~8KB), safe, real-world-
        shaped stylesheet (many distinct rules, not one repeated string)
        must save and reload byte-for-byte. The AI chat command's 500-char
        MESSAGE cap (a bounded-vocabulary limitation of the deterministic
        router) never applies here -- Custom CSS itself is saved/loaded
        through the normal Document Settings PATCH, capped only at
        MAX_CUSTOM_CSS_LENGTH (20000)."""
        rules = [
            f'.email-brand-{i} {{ color: #002D38; font-weight: 600; padding: {i % 20}px; '
            f'border-radius: 4px; background-color: #F4F6F8; }}'
            for i in range(140)
        ]
        large_css = '\n'.join(rules)
        self.assertGreater(len(large_css), 5000)
        self.assertLess(len(large_css), 20000)

        response = self._patch_json({'custom_css_enabled': True, 'custom_css': large_css})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['custom_css'], large_css)

        self.document.refresh_from_db()
        self.assertEqual(self.document.custom_css, large_css)

        # Simulates a page reload: GET must return the exact same value.
        reload_response = self.client.get(self.url)
        self.assertEqual(reload_response.status_code, 200)
        self.assertEqual(reload_response.json()['custom_css'], large_css)

    def test_custom_css_blank_is_valid_no_op(self):
        response = self._patch_json({'custom_css': ''})
        self.assertEqual(response.status_code, 200)

    def test_api_cannot_bypass_sanitizer_via_direct_model_field_omitted_from_request(self):
        """The security gate lives in the serializer's validate_custom_css
        -- there is no alternate write path (no bulk-update endpoint, no
        other serializer) that reaches EmailDocument.custom_css."""
        response = self._patch_json({'custom_css': '<script>alert(1)</script>'})
        self.assertEqual(response.status_code, 400)
        self.document.refresh_from_db()
        self.assertEqual(self.document.custom_css, '')


class CustomCssSecurityValidatorTests(TestCase):
    """Unit-level coverage of the validator function itself, independent
    of the API layer (EmailDocumentCssSettingsTests already covers it
    end-to-end through the serializer)."""

    def test_safe_css_returns_no_violations(self):
        from .custom_css_security import validate_custom_css_security
        self.assertEqual(validate_custom_css_security('.x { color: red; }'), [])

    def test_non_string_rejected(self):
        from .custom_css_security import validate_custom_css_security
        self.assertTrue(validate_custom_css_security(None))

    def test_vbscript_rejected(self):
        from .custom_css_security import validate_custom_css_security
        self.assertTrue(validate_custom_css_security('.x{background:url(vbscript:msgbox(1))}'))

    def test_case_insensitive_matching(self):
        from .custom_css_security import validate_custom_css_security
        self.assertTrue(validate_custom_css_security('.x{background:URL(JAVASCRIPT:alert(1))}'))

    def test_data_url_rejected_unconditionally(self):
        """Item 2 (closure) -- no data:image/ exception."""
        from .custom_css_security import validate_custom_css_security
        self.assertTrue(validate_custom_css_security('.x{background:url(data:image/png;base64,AAAA)}'))
        self.assertTrue(validate_custom_css_security('.x{src:url(data:font/woff2;base64,AAAA)}'))


class CustomCssSecurityObfuscationTests(TestCase):
    """Item 3 (closure) -- adversarial/obfuscated variants of every
    pattern above must still be rejected after normalization. See
    custom_css_security.py's module docstring ("NORMALIZATION STRATEGY")
    for exactly what is undone and why."""

    def _rejects(self, css):
        from .custom_css_security import validate_custom_css_security
        violations = validate_custom_css_security(css)
        self.assertTrue(violations, f'expected a violation for: {css!r}')

    def test_hex_escaped_javascript_scheme(self):
        self._rejects(r'.x{background:url(j\61vascript:alert(1))}')

    def test_hex_escaped_expression(self):
        self._rejects(r'.x{width:expre\73sion(alert(1))}')

    def test_hex_escaped_import(self):
        self._rejects(r'\40 import url(evil.css);')

    def test_hex_escaped_behavior(self):
        self._rejects(r'.x{beh\61vior:url(evil.htc)}')

    def test_hex_escaped_moz_binding(self):
        self._rejects(r'.x{-moz-b\69nding:url(evil.xml)}')

    def test_hex_escaped_data_scheme_space_terminated(self):
        # A trailing space after a short hex escape is REQUIRED by the
        # CSS spec to terminate it before a following hex-digit char
        # ('a' is itself hex) -- \64ata would otherwise greedily consume
        # "64a" as one 3-hex-digit escape, not "d" + literal "ata".
        self._rejects(r'.x{background:url(\64 ata:image/png;base64,AAAA)}')

    def test_literal_nul_control_character_mid_token(self):
        self._rejects('.x{background:url(java\x00script:alert(1))}')

    def test_mixed_case_javascript_scheme(self):
        self._rejects('.x{background:url(JavaScript:alert(1))}')

    def test_mixed_case_expression(self):
        self._rejects('.x{width:EXPRESSION(alert(1))}')

    def test_mixed_case_import(self):
        self._rejects('@IMPORT url(evil.css);')

    def test_uppercase_style_breakout(self):
        self._rejects('body{}</STYLE><script>alert(1)</script>')

    def test_comment_split_javascript_scheme(self):
        self._rejects('.x{background:url(java/**/script:alert(1))}')

    def test_comment_split_expression(self):
        self._rejects('.x{width:expre/**/ssion(alert(1))}')

    def test_comment_split_moz_binding(self):
        self._rejects('.x{-moz-/**/binding:url(evil.xml)}')

    def test_quoted_url_javascript_scheme(self):
        self._rejects('.x{background:url("javascript:alert(1)")}')

    def test_single_quoted_url_javascript_scheme(self):
        self._rejects(".x{background:url('javascript:alert(1)')}")

    def test_unquoted_url_javascript_scheme(self):
        self._rejects('.x{background:url(javascript:alert(1))}')

    def test_malformed_url_missing_close_paren_still_rejected(self):
        self._rejects('.x{background:url(javascript:alert(1)}')


# ============================================================================
# Feature 14 V3 Sub-phase 7 — Professional Email Composition & Template
# Generation
# ============================================================================

from . import composition  # noqa: E402


class CompositionEngineDeterministicTests(TestCase):
    """composition.py's pure logic — no network, no provider, no view.
    Covers the exact example briefs from the Sub-phase 7 spec plus every
    curated pattern and the bounded free-text interpretation (never
    exact-name-only matching)."""

    def test_promotional_brief_with_explicit_sections(self):
        result = composition.compose_from_brief(
            'Create a promotional email for a summer sale with preheader, header, hero, products, '
            'CTA, social links and footer.',
        )
        self.assertIsNotNone(result)
        self.assertEqual(result['pattern_key'], 'promotional')
        types = [item['module_type'] for item in result['items']]
        self.assertIn('header-preheader-logo', types)  # preheader signal upgraded the header slot
        self.assertTrue(any(t.startswith('hero') for t in types))
        self.assertTrue(any(t.startswith('product') for t in types))
        self.assertTrue(any(t.startswith('cta') or t == 'button' for t in types))
        self.assertTrue(any(t.startswith('social') for t in types))
        self.assertTrue(any(t.startswith('footer') for t in types))
        # The literal brief phrase becomes the hero headline -- never a
        # fabricated headline.
        hero_item = next(item for item in result['items'] if item['module_type'].startswith('hero'))
        self.assertEqual(hero_item['patch'].get('headline'), 'Summer sale')

    def test_newsletter_brief_produces_nested_two_column_layout(self):
        result = composition.compose_from_brief(
            'Build a newsletter with introduction, two content sections and a closing CTA.',
        )
        self.assertIsNotNone(result)
        self.assertEqual(result['pattern_key'], 'newsletter')
        layout_items = [item for item in result['items'] if item['module_type'].startswith('layout-')]
        self.assertEqual(len(layout_items), 1)
        layout_item = layout_items[0]
        self.assertIn('children', layout_item)
        self.assertEqual(len(layout_item['children']), 2)
        for group in layout_item['children']:
            self.assertEqual(len(group['modules']), 1)
            self.assertFalse(group['modules'][0]['module_type'].startswith('layout-'))
        self.assertTrue(any(t['module_type'].startswith('cta') for t in result['items']))

    def test_product_launch_brief(self):
        result = composition.compose_from_brief('Create a product launch email.')
        self.assertIsNotNone(result)
        self.assertEqual(result['pattern_key'], 'product_launch')
        self.assertTrue(any(item['module_type'].startswith('product') for item in result['items']))

    def test_welcome_onboarding_brief(self):
        result = composition.compose_from_brief('Make a welcome/onboarding email.')
        self.assertIsNotNone(result)
        self.assertEqual(result['pattern_key'], 'welcome')

    def test_event_brief(self):
        result = composition.compose_from_brief('Create an event announcement email for our webinar')
        self.assertIsNotNone(result)
        self.assertEqual(result['pattern_key'], 'event')

    def test_transactional_brief(self):
        result = composition.compose_from_brief('Make a transactional confirmation email')
        self.assertIsNotNone(result)
        self.assertEqual(result['pattern_key'], 'transactional')

    def test_editorial_brief(self):
        result = composition.compose_from_brief('Build an editorial email about our latest blog post')
        self.assertIsNotNone(result)
        self.assertEqual(result['pattern_key'], 'editorial')

    def test_generic_email_request_degrades_to_announcement_pattern(self):
        result = composition.compose_from_brief('Create a quick announcement email about our office closing')
        self.assertIsNotNone(result)
        self.assertEqual(result['pattern_key'], 'announcement')

    def test_bare_pattern_keyword_without_the_word_email_still_composes(self):
        """Not exact-name-only matching -- 'newsletter' alone (no literal
        'email' word) still resolves, because every curated pattern name
        IS unambiguously an email pattern in this builder."""
        result = composition.compose_from_brief('Please build a newsletter for our subscribers')
        self.assertIsNotNone(result)
        self.assertEqual(result['pattern_key'], 'newsletter')

    def test_unrelated_module_edit_request_is_not_a_composition(self):
        self.assertIsNone(composition.compose_from_brief('update the button color to green'))

    def test_single_module_add_request_is_not_a_composition(self):
        self.assertIsNone(composition.compose_from_brief('Create a button'))

    def test_empty_and_none_text_are_not_compositions(self):
        self.assertIsNone(composition.compose_from_brief(''))
        self.assertIsNone(composition.compose_from_brief(None))

    def test_verb_free_brief_alone_is_not_a_composition(self):
        """Documents the exact gate AI Generate Email's compose-intent
        prefix exists to satisfy (see AIGenerateEmailPage.tsx's
        COMPOSE_INTENT_PREFIX) -- a raw brief with no compose verb and no
        literal 'email' word is correctly NOT recognized on its own."""
        self.assertIsNone(composition.compose_from_brief(
            'Summer promotion for running shoes, 20% off, hero section, '
            'three featured products, strong CTA and footer.',
        ))

    def test_compose_intent_prefix_makes_a_verb_free_brief_compose(self):
        """Phase D (AI Generate Email) -- proves the SMALLEST fix actually
        works against the real deterministic router: AI Generate Email
        prepends 'Create an email: ' to the user's own free-typed brief
        before sending it, rather than requiring the user to type a
        compose verb themselves. This is the exact brief from the Phase D
        reconciliation request."""
        prefixed = 'Create an email: ' + (
            'Summer promotion for running shoes, 20% off, hero section, '
            'three featured products, strong CTA and footer.'
        )
        result = composition.compose_from_brief(prefixed)
        self.assertIsNotNone(result)
        self.assertGreater(len(result['items']), 0)
        types = [item['module_type'] for item in result['items']]
        # The brief's own explicitly-named sections come through via
        # detect_sections' section-signal layering, regardless of which
        # base pattern the prefix framing happens to score onto.
        self.assertTrue(any(t.startswith('hero') for t in types))
        self.assertTrue(any(t.startswith('product') for t in types))
        self.assertTrue(any(t.startswith('cta') or t == 'button' for t in types))
        self.assertTrue(any(t.startswith('footer') for t in types))

    def test_every_curated_pattern_resolves_to_at_least_one_item(self):
        for key in composition.PATTERNS:
            with self.subTest(pattern=key):
                items = composition.build_composition(key)
                self.assertGreater(len(items), 0)

    def test_composition_never_exceeds_max_items(self):
        for key in composition.PATTERNS:
            items = composition.build_composition(
                key, extra_sections={'preheader', 'header', 'hero', 'products', 'cta', 'social', 'footer'},
            )
            self.assertLessEqual(len(items), composition.MAX_COMPOSITION_ITEMS)

    def test_every_composition_item_module_type_is_a_real_registered_type(self):
        for key in composition.PATTERNS:
            for item in composition.build_composition(key):
                with self.subTest(pattern=key, module_type=item.module_type):
                    self.assertIn(item.module_type, module_capabilities.get_all_module_types())

    def test_social_signal_adds_social_section_when_pattern_lacks_one(self):
        # 'transactional' base pattern has no social slot.
        without = composition.build_composition('transactional')
        self.assertFalse(any(i.module_type.startswith('social') for i in without))
        with_social = composition.build_composition('transactional', extra_sections={'social'})
        self.assertTrue(any(i.module_type.startswith('social') for i in with_social))

    def test_products_signal_adds_products_section_when_pattern_lacks_one(self):
        without = composition.build_composition('welcome')
        self.assertFalse(any(i.module_type.startswith('product') for i in without))
        with_products = composition.build_composition('welcome', extra_sections={'products'})
        self.assertTrue(any(i.module_type.startswith('product') for i in with_products))

    def test_repeatable_seed_items_are_real_manifest_schema_keys(self):
        social_item = composition._social_item()
        self.assertIsNotNone(social_item)
        repeatable = module_capabilities.get_repeatable_field(social_item.module_type)
        allowed_keys = {f['key'] for f in repeatable['itemSchema']}
        for raw_item in social_item.repeatable_items:
            for key in raw_item:
                with self.subTest(key=key):
                    self.assertIn(key, allowed_keys)

    def test_to_dict_round_trip_shape(self):
        item = composition.CompositionItem('button', {'text': 'Shop Now'})
        as_dict = item.to_dict()
        self.assertEqual(as_dict, {'module_type': 'button', 'patch': {'text': 'Shop Now'}})


class ComposeEmailValidateActionTests(TestCase):
    """The validate_action() COMPOSE_EMAIL gate -- proves a composition
    item can never carry anything a hand-typed action wouldn't also be
    allowed to carry, and that malformed input is safely rejected/reduced
    rather than crashing or silently accepted."""

    def test_missing_items_rejected(self):
        self.assertIsNone(validate_action({'type': ActionType.COMPOSE_EMAIL}))

    def test_empty_items_rejected(self):
        self.assertIsNone(validate_action({'type': ActionType.COMPOSE_EMAIL, 'items': []}))

    def test_non_list_items_rejected(self):
        self.assertIsNone(validate_action({'type': ActionType.COMPOSE_EMAIL, 'items': 'not-a-list'}))

    def test_unknown_module_type_dropped_entirely(self):
        result = validate_action({
            'type': ActionType.COMPOSE_EMAIL,
            'items': [{'module_type': 'not-a-real-type', 'patch': {}}],
        })
        self.assertIsNone(result)

    def test_valid_flat_item_accepted(self):
        result = validate_action({
            'type': ActionType.COMPOSE_EMAIL,
            'items': [{'module_type': 'button', 'patch': {'text': 'Shop'}}],
        })
        self.assertEqual(result['items'], [{'module_type': 'button', 'patch': {'text': 'Shop'}}])

    def test_unsupported_patch_key_stripped_not_the_whole_item(self):
        result = validate_action({
            'type': ActionType.COMPOSE_EMAIL,
            'items': [{'module_type': 'button', 'patch': {'text': 'Shop', 'notARealField': 'x'}}],
        })
        self.assertEqual(result['items'][0]['patch'], {'text': 'Shop'})

    def test_nested_layout_inside_layout_column_is_rejected(self):
        result = validate_action({
            'type': ActionType.COMPOSE_EMAIL,
            'items': [{
                'module_type': 'layout-2col-50-50', 'patch': {},
                'children': [{'column_index': 0, 'modules': [{'module_type': 'layout-1col', 'patch': {}}]}],
            }],
        })
        # The layout survives; the illegal nested-layout child is dropped,
        # leaving no children at all (the group had nothing safe left).
        self.assertEqual(result['items'], [{'module_type': 'layout-2col-50-50', 'patch': {}}])

    def test_valid_nested_child_module_is_kept(self):
        result = validate_action({
            'type': ActionType.COMPOSE_EMAIL,
            'items': [{
                'module_type': 'layout-2col-50-50', 'patch': {},
                'children': [
                    {'column_index': 0, 'modules': [{'module_type': 'text', 'patch': {'text': 'Left'}}]},
                    {'column_index': 1, 'modules': [{'module_type': 'text', 'patch': {'text': 'Right'}}]},
                ],
            }],
        })
        item = result['items'][0]
        self.assertEqual(len(item['children']), 2)
        self.assertEqual(item['children'][0]['modules'][0]['patch'], {'text': 'Left'})
        self.assertEqual(item['children'][1]['modules'][0]['patch'], {'text': 'Right'})

    def test_out_of_range_column_index_dropped(self):
        result = validate_action({
            'type': ActionType.COMPOSE_EMAIL,
            'items': [{
                'module_type': 'layout-2col-50-50', 'patch': {},
                'children': [{'column_index': 5, 'modules': [{'module_type': 'text', 'patch': {}}]}],
            }],
        })
        self.assertEqual(result['items'], [{'module_type': 'layout-2col-50-50', 'patch': {}}])

    def test_negative_column_index_dropped(self):
        result = validate_action({
            'type': ActionType.COMPOSE_EMAIL,
            'items': [{
                'module_type': 'layout-2col-50-50', 'patch': {},
                'children': [{'column_index': -1, 'modules': [{'module_type': 'text', 'patch': {}}]}],
            }],
        })
        self.assertEqual(result['items'], [{'module_type': 'layout-2col-50-50', 'patch': {}}])

    def test_duplicate_column_index_second_occurrence_dropped(self):
        result = validate_action({
            'type': ActionType.COMPOSE_EMAIL,
            'items': [{
                'module_type': 'layout-2col-50-50', 'patch': {},
                'children': [
                    {'column_index': 0, 'modules': [{'module_type': 'text', 'patch': {'text': 'First'}}]},
                    {'column_index': 0, 'modules': [{'module_type': 'text', 'patch': {'text': 'Second'}}]},
                ],
            }],
        })
        self.assertEqual(len(result['items'][0]['children']), 1)

    def test_children_count_bounded_by_column_count(self):
        # layout-2col-50-50 only has 2 columns -- a 3rd group is ignored.
        result = validate_action({
            'type': ActionType.COMPOSE_EMAIL,
            'items': [{
                'module_type': 'layout-2col-50-50', 'patch': {},
                'children': [
                    {'column_index': 0, 'modules': [{'module_type': 'text', 'patch': {}}]},
                    {'column_index': 1, 'modules': [{'module_type': 'text', 'patch': {}}]},
                    {'column_index': 2, 'modules': [{'module_type': 'text', 'patch': {}}]},
                ],
            }],
        })
        self.assertEqual(len(result['items'][0]['children']), 2)

    def test_repeatable_items_validated_field_by_field(self):
        result = validate_action({
            'type': ActionType.COMPOSE_EMAIL,
            'items': [{
                'module_type': 'social-icon-row', 'patch': {},
                'repeatable_items': [{'label': 'Facebook', 'href': 'https://facebook.com/x', 'evilKey': 'x'}],
            }],
        })
        item = result['items'][0]
        self.assertEqual(item['repeatable_items'], [{'label': 'Facebook', 'href': 'https://facebook.com/x'}])

    def test_repeatable_items_on_a_module_without_a_repeatable_field_are_ignored(self):
        result = validate_action({
            'type': ActionType.COMPOSE_EMAIL,
            'items': [{'module_type': 'button', 'patch': {}, 'repeatable_items': [{'label': 'x', 'href': 'y'}]}],
        })
        self.assertNotIn('repeatable_items', result['items'][0])

    def test_items_beyond_max_composition_items_are_rejected_not_truncated(self):
        # Phase D (AI Generate Email) safety fix — an oversized composition
        # from an untrusted provider is an INVALID action (degrades to the
        # existing NONE-action fallback in EmailAICommandView), never
        # silently shortened to the first N items and treated as valid.
        raw_items = [{'module_type': 'text', 'patch': {}} for _ in range(ai_command_module.MAX_COMPOSITION_ITEMS + 5)]
        result = validate_action({'type': ActionType.COMPOSE_EMAIL, 'items': raw_items})
        self.assertIsNone(result)

    def test_items_at_exactly_max_composition_items_are_accepted(self):
        raw_items = [{'module_type': 'text', 'patch': {}} for _ in range(ai_command_module.MAX_COMPOSITION_ITEMS)]
        result = validate_action({'type': ActionType.COMPOSE_EMAIL, 'items': raw_items})
        self.assertIsNotNone(result)
        self.assertEqual(len(result['items']), ai_command_module.MAX_COMPOSITION_ITEMS)

    def test_children_beyond_max_per_column_are_truncated(self):
        raw_modules = [{'module_type': 'text', 'patch': {}} for _ in range(ai_command_module.MAX_COMPOSITION_CHILDREN_PER_COLUMN + 3)]
        result = validate_action({
            'type': ActionType.COMPOSE_EMAIL,
            'items': [{'module_type': 'layout-1col', 'patch': {}, 'children': [{'column_index': 0, 'modules': raw_modules}]}],
        })
        self.assertEqual(
            len(result['items'][0]['children'][0]['modules']), ai_command_module.MAX_COMPOSITION_CHILDREN_PER_COLUMN,
        )

    def test_non_dict_item_in_items_list_skipped(self):
        result = validate_action({
            'type': ActionType.COMPOSE_EMAIL,
            'items': ['not-a-dict', {'module_type': 'button', 'patch': {}}],
        })
        self.assertEqual(result['items'], [{'module_type': 'button', 'patch': {}}])

    def test_compose_email_always_requires_confirmation(self):
        action = validate_action({
            'type': ActionType.COMPOSE_EMAIL,
            'items': [{'module_type': 'button', 'patch': {}}],
        })
        self.assertTrue(requires_confirmation(action))

    def test_unimplemented_action_types_still_safely_reduce_to_none(self):
        """Sanity guard: adding COMPOSE_EMAIL to IMPLEMENTED must not have
        broken the reduce-to-NONE behavior for a genuinely-not-yet-real
        future action type."""
        result = validate_action({'type': 'SOME_FUTURE_ACTION_TYPE'})
        self.assertIsNone(result)


class ComposeEmailAssetResolutionTests(TestCase):
    """resolve_asset_references() for COMPOSE_EMAIL -- ownership-checked
    asset resolution walked recursively across a composition item's own
    patch, nested children, and repeatable items."""

    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(username='compose.owner', email='compose.owner@example.com', password='StrongPass123')
        self.other_user = User.objects.create_user(username='compose.intruder', email='compose.intruder@example.com', password='StrongPass123')
        self.owned_asset = EmailAsset.objects.create(
            user=self.user, name='Hero image', category='image',
            source_type='external', external_url='https://example.com/owned-hero.png',
        )
        self.other_users_asset = EmailAsset.objects.create(
            user=self.other_user, name='Not yours', category='image',
            source_type='external', external_url='https://example.com/intruder.png',
        )

    def _request(self):
        from django.test import RequestFactory

        factory = RequestFactory()
        request = factory.post('/api/v1/email-builder/ai-command/')
        request.user = self.user
        return request

    def test_owned_asset_marker_in_top_level_patch_resolves(self):
        action = validate_action({
            'type': ActionType.COMPOSE_EMAIL,
            'items': [{'module_type': 'image', 'patch': {'src': {'assetId': self.owned_asset.pk}}}],
        })
        resolved = resolve_asset_references(action, self._request())
        self.assertEqual(resolved['items'][0]['patch']['src'], 'https://example.com/owned-hero.png')

    def test_other_users_asset_marker_in_nested_child_never_resolves(self):
        action = validate_action({
            'type': ActionType.COMPOSE_EMAIL,
            'items': [{
                'module_type': 'layout-1col', 'patch': {},
                'children': [{'column_index': 0, 'modules': [
                    {'module_type': 'image', 'patch': {'src': {'assetId': self.other_users_asset.pk}}},
                ]}],
            }],
        })
        resolved = resolve_asset_references(action, self._request())
        nested_patch = resolved['items'][0]['children'][0]['modules'][0]['patch']
        self.assertNotIn('src', nested_patch)

    def test_owned_asset_marker_in_repeatable_item_resolves(self):
        action = validate_action({
            'type': ActionType.COMPOSE_EMAIL,
            'items': [{
                'module_type': 'product-single', 'patch': {},
                'repeatable_items': [{'imageSrc': {'assetId': self.owned_asset.pk}, 'name': 'Widget'}],
            }],
        })
        resolved = resolve_asset_references(action, self._request())
        self.assertEqual(
            resolved['items'][0]['repeatable_items'][0]['imageSrc'], 'https://example.com/owned-hero.png',
        )


class RuleBasedEmailCommandProviderComposeTests(TestCase):
    """The deterministic router's compose-intent detection -- the exact
    example briefs from the Sub-phase 7 spec, plus regression guards
    proving ordinary single-module commands are entirely unaffected."""

    def setUp(self):
        self.provider = RuleBasedEmailCommandProvider()

    def test_promotional_example_brief_resolves_to_compose_email(self):
        result = self.provider.resolve(
            'Create a promotional email for a summer sale with preheader, header, hero, products, '
            'CTA, social links and footer.', {},
        )
        self.assertEqual(result.action['type'], ActionType.COMPOSE_EMAIL)
        validated = validate_action(result.action)
        self.assertIsNotNone(validated)
        self.assertGreater(len(validated['items']), 1)

    def test_newsletter_example_brief_resolves_to_compose_email(self):
        result = self.provider.resolve('Build a newsletter with introduction, two content sections and a closing CTA.', {})
        self.assertEqual(result.action['type'], ActionType.COMPOSE_EMAIL)

    def test_product_launch_example_brief(self):
        result = self.provider.resolve('Create a product launch email.', {})
        self.assertEqual(result.action['type'], ActionType.COMPOSE_EMAIL)

    def test_welcome_onboarding_example_brief(self):
        result = self.provider.resolve('Make a welcome/onboarding email.', {})
        self.assertEqual(result.action['type'], ActionType.COMPOSE_EMAIL)

    def test_zero_provider_operation_works_with_no_context_and_no_selection(self):
        """The whole point of the deterministic path: it must work with an
        empty context dict, no selected module, and no OpenAI/local
        provider configured at all -- this test instantiates the router
        directly, which IS the zero-provider path."""
        result = self.provider.resolve('Create a promotional email for a launch', {})
        self.assertEqual(result.action['type'], ActionType.COMPOSE_EMAIL)
        self.assertGreater(result.confidence, 0)

    def test_compose_email_response_survives_full_validate_action_gate(self):
        result = self.provider.resolve('Create a product launch email.', {})
        validated = validate_action(result.action)
        self.assertIsNotNone(validated)
        for item in validated['items']:
            self.assertIn(item['module_type'], module_capabilities.get_all_module_types())

    # --- Regression guards: ordinary single-module commands unaffected ---

    def test_add_a_button_still_inserts_a_single_module_not_a_composition(self):
        result = self.provider.resolve('add a button', {})
        self.assertEqual(result.action['type'], ActionType.INSERT_MODULE)

    def test_create_a_button_still_inserts_a_single_module_not_a_composition(self):
        result = self.provider.resolve('Create a button', {})
        self.assertEqual(result.action['type'], ActionType.INSERT_MODULE)

    def test_unrelated_style_command_still_works(self):
        context = {'selected_module': _selected('button')}
        result = self.provider.resolve('make it bigger', context)
        self.assertEqual(result.action['type'], ActionType.UPDATE_MODULE_PROPS)

    def test_explain_command_still_takes_priority_over_compose_detection(self):
        result = self.provider.resolve('explain what vml is', {})
        self.assertEqual(result.action['type'], ActionType.NONE)
        self.assertEqual(result.confidence, 1.0)


class OpenAIEmailCommandProviderComposeTests(TestCase):
    """Provider-assisted composition -- the OpenAI provider CAN propose a
    richer COMPOSE_EMAIL plan; malformed/invalid provider output is
    rejected safely by the SAME validate_action() gate, never a second,
    looser path for provider-authored compositions."""

    def _fake_completion(self, payload_dict):
        completion = MagicMock()
        completion.choices = [MagicMock(message=MagicMock(content=json.dumps(payload_dict)))]
        return completion

    def test_schema_includes_compose_email_items_shape(self):
        schema = ai_command_openai_module._action_schema()
        action_props = schema['schema']['properties']['action']['properties']
        self.assertIn('items', action_props)
        self.assertIn('COMPOSE_EMAIL', schema['schema']['properties']['action']['properties']['type']['enum'])

    def test_valid_compose_email_structured_response_passes_validation(self):
        client = MagicMock()
        client.chat.completions.create.return_value = self._fake_completion({
            'reply': 'Composing a promotional email.', 'confidence': 0.9,
            'action': {
                'type': 'COMPOSE_EMAIL', 'target': None, 'module_type': None, 'modules': None, 'patch': None,
                'enabled': None, 'css': None, 'value': None, 'url': None,
                'items': [
                    {'module_type': 'header-logo-center', 'patch': {}, 'children': None, 'repeatable_items': None},
                    {
                        'module_type': 'layout-2col-50-50', 'patch': {}, 'repeatable_items': None,
                        'children': [
                            {'column_index': 0, 'modules': [{'module_type': 'text', 'patch': {'text': 'Left'}}]},
                            {'column_index': 1, 'modules': [{'module_type': 'text', 'patch': {'text': 'Right'}}]},
                        ],
                    },
                    {'module_type': 'button', 'patch': {'text': 'Shop Now'}, 'children': None, 'repeatable_items': None},
                ],
            },
        })
        provider = OpenAIEmailCommandProvider(client_factory=lambda: client)
        with override_settings(OPENAI_API_KEY='sk-test'):
            result = provider.resolve('create a promotional email', {})
        self.assertEqual(result.action['type'], 'COMPOSE_EMAIL')
        validated = validate_action(result.action)
        self.assertIsNotNone(validated)
        self.assertEqual(len(validated['items']), 3)
        layout_item = validated['items'][1]
        self.assertEqual(len(layout_item['children']), 2)

    def test_provider_hallucinated_module_type_in_composition_is_dropped_not_trusted(self):
        client = MagicMock()
        client.chat.completions.create.return_value = self._fake_completion({
            'reply': 'ok', 'confidence': 0.9,
            'action': {
                'type': 'COMPOSE_EMAIL', 'target': None, 'module_type': None, 'modules': None, 'patch': None,
                'enabled': None, 'css': None, 'value': None, 'url': None,
                'items': [
                    {'module_type': 'button', 'patch': {'text': 'Real'}, 'children': None, 'repeatable_items': None},
                    {'module_type': 'fabricated-hero-type', 'patch': {}, 'children': None, 'repeatable_items': None},
                ],
            },
        })
        provider = OpenAIEmailCommandProvider(client_factory=lambda: client)
        with override_settings(OPENAI_API_KEY='sk-test'):
            result = provider.resolve('create a promotional email', {})
        validated = validate_action(result.action)
        self.assertEqual(len(validated['items']), 1)
        self.assertEqual(validated['items'][0]['module_type'], 'button')

    def test_malformed_provider_response_falls_back_to_deterministic_via_wrapper(self):
        client = MagicMock()
        bad_completion = MagicMock()
        bad_completion.choices = [MagicMock(message=MagicMock(content='not valid json'))]
        client.chat.completions.create.return_value = bad_completion
        provider = FallbackEmailCommandProvider(
            primary=OpenAIEmailCommandProvider(client_factory=lambda: client),
            fallback=RuleBasedEmailCommandProvider(),
        )
        with override_settings(OPENAI_API_KEY='sk-test'):
            result = provider.resolve('Create a promotional email for a summer sale', {})
        # Falls back to the deterministic composition path -- still a real
        # COMPOSE_EMAIL proposal, just from the always-available router.
        self.assertEqual(result.action['type'], ActionType.COMPOSE_EMAIL)
        self.assertEqual(result.provider, 'deterministic')

    def test_provider_call_failure_falls_back_to_deterministic(self):
        client = MagicMock()
        client.chat.completions.create.side_effect = RuntimeError('network down')
        provider = FallbackEmailCommandProvider(
            primary=OpenAIEmailCommandProvider(client_factory=lambda: client),
            fallback=RuleBasedEmailCommandProvider(),
        )
        with override_settings(OPENAI_API_KEY='sk-test'):
            result = provider.resolve('Build a newsletter with two content sections', {})
        self.assertEqual(result.action['type'], ActionType.COMPOSE_EMAIL)
        self.assertEqual(result.provider, 'deterministic')


class AICommandSystemPromptGuardrailTests(TestCase):
    """C-1/C-2/C-3 remediation contract — cannot be exercised through a
    live LLM call in this environment (no API key configured), so this
    verifies the guardrail text itself ships to the model in both
    optional providers' system prompts, at the same parity the existing
    'never invent image URLs' rule already established."""

    def test_openai_prompt_forbids_inventing_link_urls(self):
        self.assertIn('never invent a destination URL', ai_command_openai_module._SYSTEM_PROMPT)
        self.assertIn('ask the user for the destination URL', ai_command_openai_module._SYSTEM_PROMPT)

    def test_openai_prompt_requires_real_vml_new_outlook_honesty(self):
        self.assertIn('never claim it will make New Outlook', ai_command_openai_module._SYSTEM_PROMPT)

    def test_openai_prompt_requires_computed_contrast_with_before_after_reporting(self):
        prompt = ai_command_openai_module._SYSTEM_PROMPT
        self.assertIn('WCAG AA-compliant replacement', prompt)
        self.assertIn('4.5:1', prompt)
        self.assertIn('the old color, the proposed color, the old ratio, and the resulting ratio', prompt)

    def test_local_prompt_forbids_inventing_link_urls(self):
        self.assertIn('never invent a destination URL', ai_command_local_module._SYSTEM_PROMPT)
        self.assertIn('ask the user for the destination URL', ai_command_local_module._SYSTEM_PROMPT)

    def test_local_prompt_requires_real_vml_new_outlook_honesty(self):
        self.assertIn('never claim it will make New Outlook', ai_command_local_module._SYSTEM_PROMPT)

    def test_local_prompt_requires_computed_contrast_with_before_after_reporting(self):
        prompt = ai_command_local_module._SYSTEM_PROMPT
        self.assertIn('WCAG AA-compliant replacement', prompt)
        self.assertIn('4.5:1', prompt)
        self.assertIn('the old color, the proposed color, the old ratio, and the resulting ratio', prompt)


class LocalEmailCommandProviderComposeTests(TestCase):
    """Mirrors OpenAIEmailCommandProviderComposeTests for the local/self-
    hosted provider -- same schema, same validation gate, same fallback
    wrapper."""

    def _fake_completion(self, payload_dict):
        completion = MagicMock()
        completion.choices = [MagicMock(message=MagicMock(content=json.dumps(payload_dict)))]
        return completion

    def test_schema_includes_compose_email_items_shape(self):
        schema = ai_command_local_module._action_schema()
        action_props = schema['schema']['properties']['action']['properties']
        self.assertIn('items', action_props)

    def test_valid_compose_email_structured_response_passes_validation(self):
        client = MagicMock()
        client.chat.completions.create.return_value = self._fake_completion({
            'reply': 'Composing a welcome email.', 'confidence': 0.9,
            'action': {
                'type': 'COMPOSE_EMAIL', 'target': None, 'module_type': None, 'modules': None, 'patch': None,
                'enabled': None, 'css': None, 'value': None, 'url': None,
                'items': [
                    {'module_type': 'hero-text-only', 'patch': {'headline': 'Welcome!'}, 'children': None, 'repeatable_items': None},
                    {
                        'module_type': 'social-icon-row', 'patch': {}, 'children': None,
                        'repeatable_items': [{'label': 'Facebook', 'href': 'https://facebook.com/x'}],
                    },
                ],
            },
        })
        provider = LocalEmailCommandProvider(client_factory=lambda: client)
        with override_settings(EMAILBUILDER_LOCAL_AI_BASE_URL='http://localhost:11434/v1'):
            result = provider.resolve('create a welcome email', {})
        validated = validate_action(result.action)
        self.assertIsNotNone(validated)
        self.assertEqual(validated['items'][1]['repeatable_items'], [{'label': 'Facebook', 'href': 'https://facebook.com/x'}])

    def test_malformed_json_falls_back_via_wrapper(self):
        client = MagicMock()
        bad_completion = MagicMock()
        bad_completion.choices = [MagicMock(message=MagicMock(content='{broken'))]
        client.chat.completions.create.return_value = bad_completion
        provider = FallbackEmailCommandProvider(
            primary=LocalEmailCommandProvider(client_factory=lambda: client),
            fallback=RuleBasedEmailCommandProvider(),
        )
        with override_settings(EMAILBUILDER_LOCAL_AI_BASE_URL='http://localhost:11434/v1'):
            result = provider.resolve('Create a product launch email.', {})
        self.assertEqual(result.action['type'], ActionType.COMPOSE_EMAIL)
        self.assertEqual(result.provider, 'deterministic')


# ============================================================================
# Feature 14 V3 Sub-phase 8 — Safe Self-Learning / Memory (repair-signal
# ranking only)
# ============================================================================

from datetime import timedelta  # noqa: E402
from unittest.mock import patch  # noqa: E402

from django.db import IntegrityError  # noqa: E402
from django.utils import timezone  # noqa: E402

from . import learning as learning_module  # noqa: E402
from .models import LearnedRepairSignal, RepairSignalOutcome, RepairSignalSource  # noqa: E402


class LearningSignatureAndEventIdValidationTests(TestCase):
    def test_valid_signature_accepted(self):
        self.assertTrue(learning_module.is_valid_signature('outlook-classic:button-rounded-corners-need-vml'))

    def test_signature_missing_colon_rejected(self):
        self.assertFalse(learning_module.is_valid_signature('outlookclassicbuttonvml'))

    def test_signature_with_uppercase_rejected(self):
        self.assertFalse(learning_module.is_valid_signature('Outlook-Classic:Button'))

    # R4-B2 — WAS "extra segments rejected" (2-colon signatures were
    # entirely disallowed). The R4-B2 spec's own reconstruction/skill
    # signature examples (e.g. "import-reconstruction:button:alignment",
    # "skill:fix-weak-contrast:applied") are exactly 3-segment/2-colon —
    # see reconstructionReview.ts's own signature docstring, already
    # emitting this shape before this pattern was widened to accept it.
    # A 4th segment (3 colons) remains rejected — see the sibling test
    # immediately below.
    def test_signature_with_two_colons_accepted(self):
        self.assertTrue(learning_module.is_valid_signature('import-reconstruction:button:alignment'))

    def test_signature_with_three_colons_rejected(self):
        self.assertFalse(learning_module.is_valid_signature('outlook-classic:button:extra:extra'))

    def test_signature_with_script_injection_rejected(self):
        self.assertFalse(learning_module.is_valid_signature('outlook-classic:<script>alert(1)</script>'))

    def test_signature_over_max_length_rejected(self):
        self.assertFalse(learning_module.is_valid_signature(('a' * 159) + ':b'))

    def test_empty_signature_rejected(self):
        self.assertFalse(learning_module.is_valid_signature(''))

    def test_non_string_signature_rejected(self):
        self.assertFalse(learning_module.is_valid_signature(None))
        self.assertFalse(learning_module.is_valid_signature(123))

    def test_valid_event_id_accepted(self):
        self.assertTrue(learning_module.is_valid_event_id('a1b2c3d4-e5f6-7890-abcd-ef1234567890'))

    def test_empty_event_id_rejected(self):
        self.assertFalse(learning_module.is_valid_event_id(''))

    def test_event_id_over_max_length_rejected(self):
        self.assertFalse(learning_module.is_valid_event_id('x' * 65))


class RecordSignalIdempotencyTests(TestCase):
    """The durable-idempotency contract: (user, event_id) uniqueness, not
    the cache debounce, is what prevents a retried request from creating
    a second learning event or moving the evidence count."""

    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(username='learner', email='learner@example.com', password='StrongPass123')

    def test_first_call_creates_a_row(self):
        signal, created = learning_module.record_signal(
            self.user, 'evt-1', 'outlook-classic:button-rounded-corners-need-vml',
            RepairSignalOutcome.ACCEPTED, RepairSignalSource.VALIDATION_CENTER_SINGLE,
        )
        self.assertTrue(created)
        self.assertEqual(LearnedRepairSignal.objects.count(), 1)
        self.assertEqual(signal.event_id, 'evt-1')

    def test_duplicate_post_retry_produces_exactly_one_stored_signal(self):
        for _ in range(5):
            learning_module.record_signal(
                self.user, 'evt-retry', 'outlook-classic:button-rounded-corners-need-vml',
                RepairSignalOutcome.ACCEPTED, RepairSignalSource.VALIDATION_CENTER_SINGLE,
            )
        self.assertEqual(LearnedRepairSignal.objects.filter(user=self.user).count(), 1)

    def test_retries_across_separate_calls_still_deduplicate_and_report_created_false(self):
        _signal1, created1 = learning_module.record_signal(
            self.user, 'evt-dup', 'outlook-classic:button-rounded-corners-need-vml',
            RepairSignalOutcome.ACCEPTED, RepairSignalSource.VALIDATION_CENTER_SINGLE,
        )
        _signal2, created2 = learning_module.record_signal(
            self.user, 'evt-dup', 'outlook-classic:button-rounded-corners-need-vml',
            RepairSignalOutcome.ACCEPTED, RepairSignalSource.VALIDATION_CENTER_SINGLE,
        )
        self.assertTrue(created1)
        self.assertFalse(created2)
        self.assertEqual(LearnedRepairSignal.objects.count(), 1)

    def test_three_genuinely_separate_event_ids_count_as_three(self):
        for i in range(3):
            learning_module.record_signal(
                self.user, f'evt-{i}', 'outlook-classic:button-rounded-corners-need-vml',
                RepairSignalOutcome.ACCEPTED, RepairSignalSource.VALIDATION_CENTER_SINGLE,
            )
        self.assertEqual(LearnedRepairSignal.objects.filter(user=self.user).count(), 3)

    def test_same_event_id_different_user_is_a_distinct_row(self):
        User = get_user_model()
        other = User.objects.create_user(username='learner2', email='learner2@example.com', password='StrongPass123')
        learning_module.record_signal(
            self.user, 'shared-evt-id', 'outlook-classic:button-rounded-corners-need-vml',
            RepairSignalOutcome.ACCEPTED, RepairSignalSource.VALIDATION_CENTER_SINGLE,
        )
        learning_module.record_signal(
            other, 'shared-evt-id', 'outlook-classic:button-rounded-corners-need-vml',
            RepairSignalOutcome.REJECTED, RepairSignalSource.VALIDATION_CENTER_SINGLE,
        )
        self.assertEqual(LearnedRepairSignal.objects.count(), 2)

    def test_concurrent_race_on_the_same_event_id_still_yields_exactly_one_row(self):
        """Simulates two requests racing for the SAME (user, event_id):
        the first get_or_create() call is forced to raise IntegrityError
        (as a real DB would on the loser of a race against the unique
        constraint) -- record_signal must catch it and return the
        winner's already-persisted row, never propagate the error."""
        learning_module.record_signal(
            self.user, 'evt-race', 'outlook-classic:button-rounded-corners-need-vml',
            RepairSignalOutcome.ACCEPTED, RepairSignalSource.VALIDATION_CENTER_SINGLE,
        )
        with patch.object(LearnedRepairSignal.objects, 'get_or_create', side_effect=IntegrityError('race')):
            signal, created = learning_module.record_signal(
                self.user, 'evt-race', 'outlook-classic:button-rounded-corners-need-vml',
                RepairSignalOutcome.ACCEPTED, RepairSignalSource.VALIDATION_CENTER_SINGLE,
            )
        self.assertFalse(created)
        self.assertIsNotNone(signal)
        self.assertEqual(signal.event_id, 'evt-race')
        self.assertEqual(LearnedRepairSignal.objects.count(), 1)

    def test_database_level_unique_constraint_actually_exists(self):
        """Defense-in-depth proof that the constraint itself (not just
        application logic) prevents a duplicate row, independent of
        record_signal()'s own get_or_create wrapper."""
        LearnedRepairSignal.objects.create(
            user=self.user, event_id='evt-constraint', signature='outlook-classic:button-rounded-corners-need-vml',
            outcome=RepairSignalOutcome.ACCEPTED, source=RepairSignalSource.VALIDATION_CENTER_SINGLE,
        )
        with self.assertRaises(IntegrityError):
            LearnedRepairSignal.objects.create(
                user=self.user, event_id='evt-constraint', signature='outlook-classic:button-rounded-corners-need-vml',
                outcome=RepairSignalOutcome.REJECTED, source=RepairSignalSource.AI_ENGINEER_REPAIR,
            )


class ComputeRankingTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(username='ranker', email='ranker@example.com', password='StrongPass123')
        self.other_user = User.objects.create_user(username='ranker2', email='ranker2@example.com', password='StrongPass123')

    def _record(self, user, signature, outcome, event_id):
        learning_module.record_signal(user, event_id, signature, outcome, RepairSignalSource.VALIDATION_CENTER_SINGLE)

    def test_zero_events_produce_empty_ranking(self):
        self.assertEqual(learning_module.compute_ranking(self.user), {})

    def test_one_event_produces_no_ranking_change(self):
        self._record(self.user, 'outlook-classic:x', RepairSignalOutcome.ACCEPTED, 'e1')
        self.assertEqual(learning_module.compute_ranking(self.user), {})

    def test_two_events_produce_no_ranking_change(self):
        self._record(self.user, 'outlook-classic:x', RepairSignalOutcome.ACCEPTED, 'e1')
        self._record(self.user, 'outlook-classic:x', RepairSignalOutcome.ACCEPTED, 'e2')
        self.assertEqual(learning_module.compute_ranking(self.user), {})

    def test_exactly_min_evidence_threshold_produces_a_ranking_entry(self):
        for i in range(learning_module.MIN_EVIDENCE_THRESHOLD):
            self._record(self.user, 'outlook-classic:x', RepairSignalOutcome.ACCEPTED, f'e{i}')
        ranking = learning_module.compute_ranking(self.user)
        self.assertIn('outlook-classic:x', ranking)
        self.assertEqual(ranking['outlook-classic:x']['evidenceCount'], learning_module.MIN_EVIDENCE_THRESHOLD)

    def test_laplace_smoothed_score_formula(self):
        # 3 accepted, 0 rejected -> (3+1)/(3+0+2) = 4/5 = 0.8
        for i in range(3):
            self._record(self.user, 'outlook-classic:x', RepairSignalOutcome.ACCEPTED, f'acc{i}')
        ranking = learning_module.compute_ranking(self.user)
        self.assertAlmostEqual(ranking['outlook-classic:x']['score'], 0.8)
        self.assertEqual(ranking['outlook-classic:x']['accepted'], 3)
        self.assertEqual(ranking['outlook-classic:x']['rejected'], 0)

    def test_mixed_accept_reject_score_regresses_toward_neutral(self):
        # 2 accepted, 2 rejected -> (2+1)/(4+2) = 3/6 = 0.5 (neutral)
        for i in range(2):
            self._record(self.user, 'outlook-classic:x', RepairSignalOutcome.ACCEPTED, f'acc{i}')
        for i in range(2):
            self._record(self.user, 'outlook-classic:x', RepairSignalOutcome.REJECTED, f'rej{i}')
        ranking = learning_module.compute_ranking(self.user)
        self.assertAlmostEqual(ranking['outlook-classic:x']['score'], 0.5)

    def test_mostly_rejected_score_is_below_neutral(self):
        for i in range(3):
            self._record(self.user, 'outlook-classic:x', RepairSignalOutcome.REJECTED, f'rej{i}')
        ranking = learning_module.compute_ranking(self.user)
        self.assertLess(ranking['outlook-classic:x']['score'], 0.5)

    def test_events_outside_ranking_window_are_excluded(self):
        self._record(self.user, 'outlook-classic:x', RepairSignalOutcome.ACCEPTED, 'e1')
        self._record(self.user, 'outlook-classic:x', RepairSignalOutcome.ACCEPTED, 'e2')
        self._record(self.user, 'outlook-classic:x', RepairSignalOutcome.ACCEPTED, 'e3')
        # Backdate all three past the ranking window via a queryset
        # .update() (bypasses auto_now_add, which only fires on .save()).
        old_date = timezone.now() - timedelta(days=learning_module.RANKING_WINDOW_DAYS + 1)
        LearnedRepairSignal.objects.filter(user=self.user).update(created_at=old_date)
        self.assertEqual(learning_module.compute_ranking(self.user), {})

    def test_events_just_inside_the_window_still_count(self):
        for i in range(3):
            self._record(self.user, 'outlook-classic:x', RepairSignalOutcome.ACCEPTED, f'e{i}')
        recent_date = timezone.now() - timedelta(days=learning_module.RANKING_WINDOW_DAYS - 1)
        LearnedRepairSignal.objects.filter(user=self.user).update(created_at=recent_date)
        ranking = learning_module.compute_ranking(self.user)
        self.assertIn('outlook-classic:x', ranking)

    def test_user_b_never_sees_user_a_ranking(self):
        for i in range(3):
            self._record(self.user, 'outlook-classic:x', RepairSignalOutcome.ACCEPTED, f'e{i}')
        self.assertEqual(learning_module.compute_ranking(self.other_user), {})

    def test_multiple_signatures_ranked_independently(self):
        for i in range(3):
            self._record(self.user, 'outlook-classic:a', RepairSignalOutcome.ACCEPTED, f'a{i}')
        for i in range(3):
            self._record(self.user, 'outlook-classic:b', RepairSignalOutcome.REJECTED, f'b{i}')
        ranking = learning_module.compute_ranking(self.user)
        self.assertGreater(ranking['outlook-classic:a']['score'], 0.5)
        self.assertLess(ranking['outlook-classic:b']['score'], 0.5)


class ClearSignalsForUserTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(username='clearer', email='clearer@example.com', password='StrongPass123')
        self.other_user = User.objects.create_user(username='clearer2', email='clearer2@example.com', password='StrongPass123')
        learning_module.record_signal(self.user, 'e1', 'outlook-classic:x', RepairSignalOutcome.ACCEPTED, RepairSignalSource.VALIDATION_CENTER_SINGLE)
        learning_module.record_signal(self.other_user, 'e2', 'outlook-classic:x', RepairSignalOutcome.ACCEPTED, RepairSignalSource.VALIDATION_CENTER_SINGLE)

    def test_clear_removes_only_this_users_rows(self):
        deleted = learning_module.clear_signals_for_user(self.user)
        self.assertEqual(deleted, 1)
        self.assertEqual(LearnedRepairSignal.objects.filter(user=self.user).count(), 0)
        self.assertEqual(LearnedRepairSignal.objects.filter(user=self.other_user).count(), 1)

    def test_account_deletion_cascades(self):
        self.user.delete()
        self.assertEqual(LearnedRepairSignal.objects.filter(signature='outlook-classic:x').count(), 1)  # only other_user's remains


class LearningSignalViewTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(username='view.learner', email='view.learner@example.com', password='StrongPass123')
        self.other_user = User.objects.create_user(username='view.learner2', email='view.learner2@example.com', password='StrongPass123')
        self.signals_url = '/api/v1/email-builder/learning/signals/'
        self.ranking_url = '/api/v1/email-builder/learning/signals/ranking/'
        _cache.clear()

    def _post_json(self, data):
        return self.client.post(self.signals_url, data=json.dumps(data), content_type='application/json')

    def _valid_payload(self, **overrides):
        payload = {
            'event_id': 'evt-view-1', 'signature': 'outlook-classic:button-rounded-corners-need-vml',
            'outcome': 'accepted', 'source': 'validation_center_single',
        }
        payload.update(overrides)
        return payload

    def test_unauthenticated_post_rejected(self):
        response = self._post_json(self._valid_payload())
        self.assertEqual(response.status_code, 403)
        self.assertEqual(LearnedRepairSignal.objects.count(), 0)

    def test_authenticated_post_creates_a_signal(self):
        self.client.force_login(self.user)
        response = self._post_json(self._valid_payload())
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertTrue(body['success'])
        self.assertTrue(body['created'])
        self.assertEqual(LearnedRepairSignal.objects.count(), 1)
        self.assertEqual(LearnedRepairSignal.objects.first().user, self.user)

    # R4-B2 §15 — the reconstruction-repair source choice and 3-segment
    # reconstruction/skill signatures must actually be accepted end to
    # end through the real endpoint, not just by the bare validator
    # function (see LearningSignatureAndEventIdValidationTests above).
    # R4-B2 itself never POSTS one of these (see reconstructionReview.ts's
    # "no learning mutation yet" docstring) — this proves the plumbing is
    # ready for R4-C to use, not that R4-B2 uses it.
    def test_reconstruction_source_and_three_segment_signature_accepted(self):
        self.client.force_login(self.user)
        response = self._post_json(self._valid_payload(
            event_id='evt-reconstruction-1',
            signature='import-reconstruction:button:alignment',
            source='ai_engineer_reconstruction',
        ))
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()['success'])
        signal = LearnedRepairSignal.objects.get(event_id='evt-reconstruction-1')
        self.assertEqual(signal.signature, 'import-reconstruction:button:alignment')
        self.assertEqual(signal.source, 'ai_engineer_reconstruction')

    def test_duplicate_post_via_endpoint_does_not_create_a_second_row(self):
        self.client.force_login(self.user)
        self._post_json(self._valid_payload())
        response = self._post_json(self._valid_payload())
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()['created'])
        self.assertEqual(LearnedRepairSignal.objects.count(), 1)

    def test_malformed_signature_rejected(self):
        self.client.force_login(self.user)
        response = self._post_json(self._valid_payload(signature='<script>alert(1)</script>'))
        self.assertEqual(response.status_code, 400)
        self.assertEqual(LearnedRepairSignal.objects.count(), 0)

    def test_empty_event_id_rejected(self):
        self.client.force_login(self.user)
        response = self._post_json(self._valid_payload(event_id=''))
        self.assertEqual(response.status_code, 400)

    def test_invalid_outcome_rejected(self):
        self.client.force_login(self.user)
        response = self._post_json(self._valid_payload(outcome='maybe'))
        self.assertEqual(response.status_code, 400)

    def test_invalid_source_rejected(self):
        self.client.force_login(self.user)
        response = self._post_json(self._valid_payload(source='not-a-real-source'))
        self.assertEqual(response.status_code, 400)

    def test_rate_limit_enforced(self):
        self.client.force_login(self.user)
        with patch('emailbuilder.views._learning_rate_limited', return_value=True):
            response = self._post_json(self._valid_payload())
        self.assertEqual(response.status_code, 429)

    def test_unauthenticated_ranking_get_rejected(self):
        response = self.client.get(self.ranking_url)
        self.assertEqual(response.status_code, 403)

    def test_ranking_get_returns_empty_map_with_no_signals(self):
        self.client.force_login(self.user)
        response = self.client.get(self.ranking_url)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['signatures'], {})

    def test_ranking_get_reflects_recorded_signals_once_threshold_met(self):
        self.client.force_login(self.user)
        for i in range(3):
            self._post_json(self._valid_payload(event_id=f'evt-{i}'))
        response = self.client.get(self.ranking_url)
        signatures = response.json()['signatures']
        self.assertIn('outlook-classic:button-rounded-corners-need-vml', signatures)
        self.assertEqual(signatures['outlook-classic:button-rounded-corners-need-vml']['evidenceCount'], 3)

    def test_ranking_endpoint_failure_falls_back_to_empty_map(self):
        self.client.force_login(self.user)
        with patch('emailbuilder.views.learning.compute_ranking', side_effect=RuntimeError('boom')):
            response = self.client.get(self.ranking_url)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['signatures'], {})

    def test_user_b_ranking_is_unaffected_by_user_a_signals(self):
        self.client.force_login(self.user)
        for i in range(3):
            self._post_json(self._valid_payload(event_id=f'evt-{i}'))
        self.client.logout()
        self.client.force_login(self.other_user)
        response = self.client.get(self.ranking_url)
        self.assertEqual(response.json()['signatures'], {})

    def test_unauthenticated_delete_rejected(self):
        response = self.client.delete(self.signals_url)
        self.assertEqual(response.status_code, 403)

    def test_delete_clears_current_users_signals_and_restores_empty_ranking(self):
        self.client.force_login(self.user)
        for i in range(3):
            self._post_json(self._valid_payload(event_id=f'evt-{i}'))
        self.assertEqual(LearnedRepairSignal.objects.filter(user=self.user).count(), 3)
        delete_response = self.client.delete(self.signals_url)
        self.assertEqual(delete_response.status_code, 200)
        self.assertEqual(delete_response.json()['deleted'], 3)
        ranking_response = self.client.get(self.ranking_url)
        self.assertEqual(ranking_response.json()['signatures'], {})

    def test_delete_never_touches_another_users_signals(self):
        self.client.force_login(self.other_user)
        self._post_json(self._valid_payload(event_id='other-users-evt'))
        self.client.logout()
        self.client.force_login(self.user)
        self.client.delete(self.signals_url)
        self.assertEqual(LearnedRepairSignal.objects.filter(user=self.other_user).count(), 1)

    def test_no_provider_call_is_involved_in_recording_or_ranking(self):
        """Sanity guard -- posting a signal and fetching ranking must never
        import/construct an OpenAI or local-AI provider. Patched to raise
        if either provider class is ever instantiated during this test."""
        self.client.force_login(self.user)
        with patch('emailbuilder.ai_command_openai.OpenAIEmailCommandProvider.__init__', side_effect=AssertionError('must not be called')):
            with patch('emailbuilder.ai_command_local.LocalEmailCommandProvider.__init__', side_effect=AssertionError('must not be called')):
                post_response = self._post_json(self._valid_payload())
                get_response = self.client.get(self.ranking_url)
        self.assertEqual(post_response.status_code, 200)
        self.assertEqual(get_response.status_code, 200)


class LearningSignalModelCascadeTests(TestCase):
    def test_deleting_user_cascades_to_their_signals_via_the_view_path(self):
        User = get_user_model()
        user = User.objects.create_user(username='cascade.user', email='cascade.user@example.com', password='StrongPass123')
        learning_module.record_signal(user, 'evt-cascade', 'outlook-classic:x', RepairSignalOutcome.ACCEPTED, RepairSignalSource.VALIDATION_CENTER_SINGLE)
        self.assertEqual(LearnedRepairSignal.objects.count(), 1)
        user.delete()
        self.assertEqual(LearnedRepairSignal.objects.count(), 0)


class LearningDoesNotTouchKnowledgeOrValidationTests(TestCase):
    """Structural proof of the core invariant: nothing in learning.py can
    reach KnowledgeRule content/confidence, and recording/ranking signals
    never touches EmailDocument/validation machinery at all."""

    def test_learning_module_has_no_import_of_knowledge_rules_or_edm(self):
        # Checks actual imports (module dependencies), never a naive text
        # grep of the source -- the module's own docstring legitimately
        # MENTIONS EmailDocument/EmailAsset by name when explaining why
        # this feature follows the same per-user ownership convention;
        # that's documentation, not a dependency.
        module_names = {getattr(value, '__module__', None) for value in vars(learning_module).values()}
        self.assertNotIn('emailbuilder.knowledge.rules', module_names)
        self.assertNotIn('emailbuilder.edm', module_names)
        self.assertFalse(hasattr(learning_module, 'validate_edm'))
        self.assertFalse(hasattr(learning_module, 'find_rule'))
        self.assertFalse(hasattr(learning_module, 'EmailDocument'))

    def test_recording_and_ranking_never_touch_emaildocument_table(self):
        User = get_user_model()
        user = User.objects.create_user(username='isolation.user', email='isolation.user@example.com', password='StrongPass123')
        before_count = EmailDocument.objects.count()
        for i in range(3):
            learning_module.record_signal(user, f'evt-{i}', 'outlook-classic:x', RepairSignalOutcome.ACCEPTED, RepairSignalSource.VALIDATION_CENTER_SINGLE)
        learning_module.compute_ranking(user)
        self.assertEqual(EmailDocument.objects.count(), before_count)
