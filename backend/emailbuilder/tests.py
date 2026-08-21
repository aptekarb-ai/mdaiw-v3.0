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
            'layout-6col', 'header-logo-nav', 'hero-background-image', 'content-quote',
            'product-three-cards', 'cta-dual', 'social-follow-us', 'footer-preference-unsubscribe',
        ]:
            content = {'version': 1, 'modules': [_module(module_type=module_type)]}
            response = self._patch_json({'content': content})
            self.assertEqual(response.status_code, 200, module_type)

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
