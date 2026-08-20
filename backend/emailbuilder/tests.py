import json

from django.contrib.auth import get_user_model
from django.test import TestCase

from .models import EmailDocument


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
