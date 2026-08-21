import json

from django.contrib.auth import get_user_model
from django.test import TestCase

from .models import EmailDocument, SavedEmailModule


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
