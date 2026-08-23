import io
import json

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from django.test.client import BOUNDARY, MULTIPART_CONTENT, encode_multipart

from PIL import Image

from .models import EmailAsset, EmailDocument, SavedEmailModule


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


def _column(column_id='col-a', modules=None, background='', valign='top'):
    return {
        'id': column_id,
        'modules': modules if modules is not None else [],
        'settings': {
            'desktop': {'paddingTop': 0, 'paddingRight': 0, 'paddingBottom': 0, 'paddingLeft': 0},
            'mobile': {},
            'backgroundColor': background,
            'verticalAlign': valign,
        },
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

from unittest.mock import MagicMock  # noqa: E402

from django.core.cache import cache as _cache  # noqa: E402
from django.test import override_settings  # noqa: E402

from .ai_command import (  # noqa: E402
    ActionType,
    FallbackEmailCommandProvider,
    RuleBasedEmailCommandProvider,
    _resolve_color,
    get_default_email_command_provider,
    requires_confirmation,
    resolve_asset_references,
    validate_action,
)
from .ai_command_openai import OpenAIEmailCommandProvider  # noqa: E402
from .ai_command_local import LocalEmailCommandProvider  # noqa: E402
from . import module_capabilities  # noqa: E402


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


class ResolveColorTests(TestCase):
    def test_hex_passthrough_uppercased(self):
        self.assertEqual(_resolve_color('#abcdef'), '#ABCDEF')

    def test_named_color(self):
        self.assertEqual(_resolve_color('green'), '#76C043')

    def test_unknown_word_returns_none(self):
        self.assertIsNone(_resolve_color('paisley'))

    def test_non_string_returns_none(self):
        self.assertIsNone(_resolve_color(123))


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
