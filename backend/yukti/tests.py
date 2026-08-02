import json

from django.core.cache import cache
from django.test import Client, TestCase, override_settings

from .intents import ActionType, Intent
from .providers import RuleBasedIntentProvider
from .views import _validate_action


class RuleBasedIntentProviderTests(TestCase):
    """Direct tests against the provider — no HTTP involved."""

    def setUp(self):
        self.provider = RuleBasedIntentProvider()

    def test_open_registration_intent(self):
        result = self.provider.resolve('Help me register as a new employee', {'route': '/register'})
        self.assertEqual(result['intent'], Intent.OPEN_REGISTRATION)
        self.assertEqual(result['action'], {'type': ActionType.NAVIGATE, 'target': '/register'})

    def test_open_login_intent(self):
        result = self.provider.resolve('Take me to the login page', {})
        self.assertEqual(result['intent'], Intent.OPEN_LOGIN)
        self.assertEqual(result['action']['target'], '/login')

    def test_fill_registration_field_employee_id_requires_confirmation(self):
        result = self.provider.resolve('My employee ID is MDAIW 1042', {'route': '/register'})
        self.assertEqual(result['intent'], Intent.FILL_REGISTRATION_FIELD)
        self.assertTrue(result['requires_confirmation'])
        self.assertEqual(result['action'], {'type': ActionType.FILL_FIELD, 'field': 'employee_id', 'value': 'MDAIW-1042'})

    def test_fill_registration_field_first_name_no_confirmation_required(self):
        result = self.provider.resolve('My first name is Brahmesh', {})
        self.assertEqual(result['intent'], Intent.FILL_REGISTRATION_FIELD)
        self.assertFalse(result['requires_confirmation'])
        self.assertEqual(result['action']['field'], 'first_name')
        self.assertEqual(result['action']['value'], 'Brahmesh')

    def test_go_to_registration_step(self):
        result = self.provider.resolve('go to step 2', {})
        self.assertEqual(result['intent'], Intent.GO_TO_REGISTRATION_STEP)
        self.assertEqual(result['action'], {'type': ActionType.GO_TO_STEP, 'step': 2})

    def test_navigate_module(self):
        result = self.provider.resolve('open dashboard', {})
        self.assertEqual(result['intent'], Intent.NAVIGATE_MODULE)
        self.assertEqual(result['action']['target'], '/dashboard')

    def test_cancel_current_action(self):
        result = self.provider.resolve('cancel', {})
        self.assertEqual(result['intent'], Intent.CANCEL_CURRENT_ACTION)
        self.assertEqual(result['action'], {'type': ActionType.CANCEL})

    def test_start_face_login_intent(self):
        result = self.provider.resolve('sign in with my face', {})
        self.assertEqual(result['intent'], Intent.START_FACE_LOGIN)
        self.assertEqual(result['action'], {'type': ActionType.START_FACE_LOGIN})

    def test_explain_face_login_intent(self):
        result = self.provider.resolve('what is face recognition', {})
        self.assertEqual(result['intent'], Intent.EXPLAIN_FACE_LOGIN)
        self.assertIsNone(result['action'])

    def test_login_help_intent(self):
        # "Help me sign in" is itself an explicit login request — it now
        # resolves to OPEN_LOGIN + NAVIGATE, not a username-focus nudge.
        # EXPLAIN_PASSWORD_LOGIN's only remaining trigger is the password
        # guard (see test_password_mention_never_produces_fill_action).
        result = self.provider.resolve('help me sign in', {})
        self.assertEqual(result['intent'], Intent.OPEN_LOGIN)
        self.assertEqual(result['action'], {'type': ActionType.NAVIGATE, 'target': '/login'})

    def test_open_login_from_registration_context(self):
        result = self.provider.resolve('Can you help me to login', {'route': '/register'})
        self.assertEqual(result['intent'], Intent.OPEN_LOGIN)
        self.assertEqual(result['action'], {'type': ActionType.NAVIGATE, 'target': '/login'})

    def test_all_required_login_phrases_resolve_to_open_login(self):
        phrases = [
            'Help me login',
            'Can you help me to login',
            'Open login',
            'Take me to the login page',
            'I want to sign in',
        ]
        for phrase in phrases:
            with self.subTest(phrase=phrase):
                result = self.provider.resolve(phrase, {'route': '/register'})
                self.assertEqual(result['intent'], Intent.OPEN_LOGIN)
                self.assertFalse(result['requires_confirmation'])
                self.assertEqual(result['action'], {'type': ActionType.NAVIGATE, 'target': '/login'})

    def test_explicit_login_intent_wins_over_registration_page_context(self):
        on_register = self.provider.resolve('Can you help me to login', {'route': '/register'})
        no_context = self.provider.resolve('Can you help me to login', {})
        self.assertEqual(on_register['intent'], Intent.OPEN_LOGIN)
        self.assertEqual(on_register, no_context)

    def test_general_help_contextual_on_register_route(self):
        result = self.provider.resolve('help', {'route': '/register'})
        self.assertEqual(result['intent'], Intent.GENERAL_HELP)
        self.assertIn('password', result['spoken_response'].lower())

    def test_general_help_contextual_on_login_route(self):
        result = self.provider.resolve('help', {'route': '/login'})
        self.assertEqual(result['intent'], Intent.GENERAL_HELP)

    def test_unknown_intent_fallback(self):
        result = self.provider.resolve('purple monkey dishwasher', {})
        self.assertEqual(result['intent'], Intent.UNKNOWN)
        self.assertIsNone(result['action'])

    def test_empty_message_fallback(self):
        result = self.provider.resolve('', {})
        self.assertEqual(result['intent'], Intent.UNKNOWN)

    def test_password_mention_never_produces_fill_action(self):
        result = self.provider.resolve('my password is hunter2', {})
        self.assertEqual(result['intent'], Intent.EXPLAIN_PASSWORD_LOGIN)
        self.assertIsNone(result['action'])

    def test_password_question_redacted_to_generic_explanation(self):
        result = self.provider.resolve('what is my password', {})
        self.assertEqual(result['intent'], Intent.EXPLAIN_PASSWORD_LOGIN)
        self.assertNotIn('hunter2', result['spoken_response'])

    def test_confirm_password_mention_also_guarded(self):
        result = self.provider.resolve('set my confirm password to hunter2', {})
        self.assertEqual(result['intent'], Intent.EXPLAIN_PASSWORD_LOGIN)
        self.assertIsNone(result['action'])

    def test_no_action_type_can_authenticate(self):
        # Structural guarantee: the ActionType enum simply has no member that
        # could execute login/registration/enrollment — there is nothing to
        # accidentally return.
        dangerous = {'AUTHENTICATE', 'LOGIN', 'SUBMIT_LOGIN', 'ACTIVATE_ACCOUNT', 'EXECUTE'}
        self.assertFalse(dangerous & set(ActionType.values))


class ActionValidationTests(TestCase):
    """Defense-in-depth: the view must reject an unsafe action even if a
    (future, buggy, or compromised) provider returned one."""

    def test_valid_navigate_action_passes(self):
        self.assertEqual(
            _validate_action({'type': ActionType.NAVIGATE, 'target': '/dashboard'}),
            {'type': ActionType.NAVIGATE, 'target': '/dashboard'},
        )

    def test_navigate_to_unlisted_route_rejected(self):
        self.assertIsNone(_validate_action({'type': ActionType.NAVIGATE, 'target': '/admin/secret'}))

    def test_navigate_to_external_url_rejected(self):
        self.assertIsNone(
            _validate_action({'type': ActionType.NAVIGATE, 'target': 'https://evil.example.com'})
        )

    def test_fill_field_password_rejected(self):
        self.assertIsNone(
            _validate_action({'type': ActionType.FILL_FIELD, 'field': 'password', 'value': 'x'})
        )

    def test_fill_field_confirm_password_rejected(self):
        self.assertIsNone(
            _validate_action({'type': ActionType.FILL_FIELD, 'field': 'confirm_password', 'value': 'x'})
        )

    def test_fill_field_unknown_field_rejected(self):
        self.assertIsNone(
            _validate_action({'type': ActionType.FILL_FIELD, 'field': 'encryption_key', 'value': 'x'})
        )

    def test_focus_login_password_field_rejected(self):
        self.assertIsNone(_validate_action({'type': ActionType.FOCUS_FIELD, 'field': 'password'}))

    def test_go_to_step_out_of_range_rejected(self):
        self.assertIsNone(_validate_action({'type': ActionType.GO_TO_STEP, 'step': 9}))

    def test_unrecognized_action_type_rejected(self):
        self.assertIsNone(_validate_action({'type': 'DELETE_ACCOUNT'}))

    def test_none_action_passes_through(self):
        self.assertIsNone(_validate_action(None))


class IntentEndpointTests(TestCase):
    def setUp(self):
        cache.clear()

    def _post(self, message, context=None, client=None):
        client = client or self.client
        return client.post(
            '/api/v1/yukti/intent/',
            data=json.dumps({'message': message, 'context': context or {}}),
            content_type='application/json',
        )

    def test_safe_response_structure(self):
        response = self._post('Help me register as a new employee', {'route': '/register'})
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(
            set(body.keys()),
            {'success', 'intent', 'confidence', 'requires_confirmation', 'spoken_response', 'action', 'language'},
        )
        self.assertTrue(body['success'])
        self.assertEqual(body['intent'], 'OPEN_REGISTRATION')
        self.assertEqual(body['action'], {'type': 'NAVIGATE', 'target': '/register'})

    def test_missing_message_rejected(self):
        response = self.client.post(
            '/api/v1/yukti/intent/', data=json.dumps({}), content_type='application/json'
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()['code'], 'MESSAGE_REQUIRED')

    def test_blank_message_rejected(self):
        response = self._post('   ')
        self.assertEqual(response.status_code, 400)

    def test_password_message_never_returns_fill_action(self):
        response = self._post('my password is hunter2')
        body = response.json()
        self.assertEqual(body['intent'], 'EXPLAIN_PASSWORD_LOGIN')
        self.assertIsNone(body['action'])
        self.assertNotIn('hunter2', json.dumps(body))

    def test_unknown_message_safe_fallback(self):
        response = self._post('purple monkey dishwasher')
        body = response.json()
        self.assertEqual(body['intent'], 'UNKNOWN')
        self.assertIsNone(body['action'])

    def test_face_login_guidance_returns_start_action(self):
        response = self._post('sign in with my face')
        body = response.json()
        self.assertEqual(body['intent'], 'START_FACE_LOGIN')
        self.assertEqual(body['action'], {'type': 'START_FACE_LOGIN'})

    def test_navigation_target_is_allow_listed(self):
        response = self._post('open dashboard')
        body = response.json()
        self.assertIn(body['action']['target'], [
            '/login', '/register', '/face-login', '/dashboard', '/profile', '/settings',
            '/employees', '/performance', '/recognition', '/landing-pages', '/email-builder',
            '/personal-finance', '/ai-assistants', '/reports', '/administration',
        ])

    def test_csrf_enforced(self):
        csrf_client = Client(enforce_csrf_checks=True)
        response = self._post('help', client=csrf_client)
        self.assertEqual(response.status_code, 403)

    @override_settings(YUKTI_INTENT_MAX_REQUESTS=3, YUKTI_INTENT_WINDOW_SECONDS=60)
    def test_rate_limiting(self):
        for _ in range(3):
            response = self._post('help')
            self.assertEqual(response.status_code, 200)
        limited = self._post('help')
        self.assertEqual(limited.status_code, 429)
        self.assertEqual(limited.json()['code'], 'RATE_LIMITED')

    def test_registration_help_intent_via_endpoint(self):
        response = self._post('help', {'route': '/register'})
        body = response.json()
        self.assertEqual(body['intent'], 'GENERAL_HELP')

    def test_open_login_from_register_route_returns_exact_structured_response(self):
        response = self._post('Can you help me to login', {'route': '/register'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json(),
            {
                'success': True,
                'intent': 'OPEN_LOGIN',
                'confidence': 0.9,
                'requires_confirmation': False,
                'spoken_response': 'Opening the sign-in page.',
                'action': {'type': 'NAVIGATE', 'target': '/login'},
                'language': None,
            },
        )

    def test_no_authentication_endpoint_is_ever_called_by_this_view(self):
        # The intent endpoint must never create a session. A message that a
        # naive implementation might route straight to "log the user in"
        # should still leave the caller unauthenticated.
        self._post('submit login')
        me = self.client.get('/api/v1/auth/me/')
        self.assertFalse(me.json()['authenticated'])


# ---- AI provider (yukti/ai_provider.py) ----


class _FakeMessage:
    def __init__(self, content):
        self.content = content


class _FakeChoice:
    def __init__(self, content):
        self.message = _FakeMessage(content)


class _FakeCompletion:
    def __init__(self, content):
        self.choices = [_FakeChoice(content)]


class _FakeCompletions:
    def __init__(self, parent):
        self._parent = parent

    def create(self, **kwargs):
        self._parent.calls.append(kwargs)
        if self._parent.exception is not None:
            raise self._parent.exception
        return _FakeCompletion(json.dumps(self._parent.response_json))


class _FakeChat:
    def __init__(self, parent):
        self.completions = _FakeCompletions(parent)


class FakeOpenAIClient:
    """Stands in for `openai.OpenAI` — no real network call is ever made in
    these tests, satisfying "mock provider calls in automated tests"."""

    def __init__(self, response_json=None, exception=None):
        self.response_json = response_json or {
            'reply': 'Opening the sign-in page.',
            'language': 'en-IN',
            'intent': 'OPEN_LOGIN',
            'confidence': 0.9,
            'requires_confirmation': False,
            'action': {'type': 'NAVIGATE', 'target': '/login', 'field': None, 'value': None, 'step': None},
        }
        self.exception = exception
        self.calls = []
        self.chat = _FakeChat(self)


@override_settings(OPENAI_API_KEY='test-key-not-real', YUKTI_AI_PROVIDER='openai')
class AIProviderTests(TestCase):
    """Direct tests against OpenAIYuktiProvider — no HTTP involved."""

    def setUp(self):
        cache.clear()
        from .ai_provider import OpenAIYuktiProvider

        self.OpenAIYuktiProvider = OpenAIYuktiProvider

    def test_password_like_message_never_reaches_the_client(self):
        fake_client = FakeOpenAIClient()
        provider = self.OpenAIYuktiProvider(client_factory=lambda: fake_client)

        result = provider.resolve('my password is hunter2', {'route': '/login'})

        self.assertEqual(fake_client.calls, [])
        self.assertEqual(result['intent'], Intent.EXPLAIN_PASSWORD_LOGIN)
        self.assertIn('please type your password directly', result['spoken_response'])

    @override_settings(OPENAI_API_KEY='')
    def test_raises_unavailable_when_no_api_key_configured(self):
        from .ai_provider import AIProviderUnavailable

        provider = self.OpenAIYuktiProvider(client_factory=lambda: FakeOpenAIClient())
        with self.assertRaises(AIProviderUnavailable):
            provider.resolve('hello', {'route': '/'})

    def test_successful_structured_response_is_parsed(self):
        fake_client = FakeOpenAIClient()
        provider = self.OpenAIYuktiProvider(client_factory=lambda: fake_client)

        result = provider.resolve('help me sign in', {'route': '/login'})

        self.assertEqual(result['intent'], Intent.OPEN_LOGIN)
        self.assertEqual(result['spoken_response'], 'Opening the sign-in page.')
        self.assertEqual(result['language'], 'en-IN')
        self.assertEqual(result['action'], {'type': ActionType.NAVIGATE, 'target': '/login'})

    def test_malformed_json_raises_unavailable(self):
        from .ai_provider import AIProviderUnavailable

        fake_client = FakeOpenAIClient()
        fake_client.chat.completions.create = lambda **kwargs: _FakeCompletion('not valid json{{{')
        provider = self.OpenAIYuktiProvider(client_factory=lambda: fake_client)

        with self.assertRaises(AIProviderUnavailable):
            provider.resolve('hello', {'route': '/'})

    def test_provider_exception_raises_unavailable(self):
        from .ai_provider import AIProviderUnavailable

        fake_client = FakeOpenAIClient(exception=RuntimeError('network exploded'))
        provider = self.OpenAIYuktiProvider(client_factory=lambda: fake_client)

        with self.assertRaises(AIProviderUnavailable):
            provider.resolve('hello', {'route': '/'})

    def test_unsafe_action_type_is_dropped(self):
        fake_client = FakeOpenAIClient(
            response_json={
                'reply': 'ok',
                'language': 'en-IN',
                'intent': 'GENERAL_HELP',
                'confidence': 0.5,
                'requires_confirmation': False,
                'action': {
                    'type': 'DELETE_EVERYTHING',
                    'target': None,
                    'field': None,
                    'value': None,
                    'step': None,
                },
            }
        )
        provider = self.OpenAIYuktiProvider(client_factory=lambda: fake_client)

        result = provider.resolve('hello', {'route': '/'})

        self.assertIsNone(result['action'])

    def test_ai_facing_action_names_map_to_internal_action_types(self):
        fake_client = FakeOpenAIClient(
            response_json={
                'reply': 'Opening Face Recognition sign-in.',
                'language': 'en-IN',
                'intent': 'START_FACE_LOGIN',
                'confidence': 0.9,
                'requires_confirmation': False,
                'action': {'type': 'OPEN_FACE_LOGIN', 'target': None, 'field': None, 'value': None, 'step': None},
            }
        )
        provider = self.OpenAIYuktiProvider(client_factory=lambda: fake_client)

        result = provider.resolve('sign me in with my face', {'route': '/login'})

        self.assertEqual(result['action'], {'type': ActionType.START_FACE_LOGIN})

    def test_rate_limited_raises_unavailable_without_calling_the_client(self):
        from .ai_provider import AIProviderUnavailable

        fake_client = FakeOpenAIClient()
        provider = self.OpenAIYuktiProvider(client_factory=lambda: fake_client)
        context = {'route': '/', '_rate_limit_identifier': '203.0.113.9'}

        with override_settings(YUKTI_AI_MAX_REQUESTS_PER_WINDOW=1):
            provider.resolve('hello', context)  # first call consumes the one allowed slot
            with self.assertRaises(AIProviderUnavailable):
                provider.resolve('hello again', context)

        # Only the first call should have reached the (fake) network client.
        self.assertEqual(len(fake_client.calls), 1)

    def test_safe_context_never_includes_forbidden_fields_even_if_supplied(self):
        from .ai_provider import build_safe_context

        malicious_context = {
            'route': '/register',
            'password': 'hunter2',
            'camera_frame': 'data:image/jpeg;base64,...',
            'embedding': [0.1, 0.2, 0.3],
            'csrf_token': 'abc',
            'session_id': 'xyz',
        }

        safe = build_safe_context(malicious_context)

        for forbidden in ('password', 'camera_frame', 'embedding', 'csrf_token', 'session_id'):
            self.assertNotIn(forbidden, safe)

    def test_safe_context_includes_current_route_and_page_name(self):
        from .ai_provider import build_safe_context

        safe = build_safe_context({'route': '/register', 'registration_step': 3})
        self.assertEqual(safe['route'], '/register')
        self.assertEqual(safe['page_name'], 'Registration')
        self.assertEqual(safe['registration_step'], 3)


class FallbackYuktiProviderTests(TestCase):
    def test_falls_back_to_deterministic_when_primary_unavailable(self):
        from .ai_provider import AIProviderUnavailable
        from .providers import FallbackYuktiProvider, RuleBasedIntentProvider

        class _AlwaysUnavailable:
            def resolve(self, message, context):
                raise AIProviderUnavailable('boom')

        provider = FallbackYuktiProvider(primary=_AlwaysUnavailable(), fallback=RuleBasedIntentProvider())
        result = provider.resolve('open login', {'route': '/'})

        self.assertEqual(result['intent'], Intent.OPEN_LOGIN)

    def test_uses_primary_when_available(self):
        from .providers import FallbackYuktiProvider, RuleBasedIntentProvider

        class _AlwaysAnswers:
            def resolve(self, message, context):
                return {
                    'intent': Intent.GENERAL_HELP,
                    'confidence': 0.99,
                    'requires_confirmation': False,
                    'spoken_response': 'from primary',
                    'action': None,
                    'language': 'en-IN',
                }

        provider = FallbackYuktiProvider(primary=_AlwaysAnswers(), fallback=RuleBasedIntentProvider())
        result = provider.resolve('anything', {'route': '/'})

        self.assertEqual(result['spoken_response'], 'from primary')


class GetDefaultProviderTests(TestCase):
    @override_settings(YUKTI_AI_PROVIDER='', OPENAI_API_KEY='')
    def test_returns_rule_based_provider_when_ai_not_configured(self):
        from .providers import RuleBasedIntentProvider, get_default_provider

        self.assertIsInstance(get_default_provider(), RuleBasedIntentProvider)

    @override_settings(YUKTI_AI_PROVIDER='openai', OPENAI_API_KEY='test-key')
    def test_returns_fallback_wrapper_when_ai_configured(self):
        from .providers import FallbackYuktiProvider, get_default_provider

        self.assertIsInstance(get_default_provider(), FallbackYuktiProvider)

    @override_settings(YUKTI_AI_PROVIDER='openai', OPENAI_API_KEY='')
    def test_missing_api_key_still_falls_back_to_rule_based_only(self):
        from .providers import RuleBasedIntentProvider, get_default_provider

        self.assertIsInstance(get_default_provider(), RuleBasedIntentProvider)


@override_settings(OPENAI_API_KEY='test-key-not-real', YUKTI_AI_PROVIDER='openai')
class IntentEndpointWithAIProviderTests(TestCase):
    """End-to-end HTTP tests with the AI provider selected, its network
    call replaced by FakeOpenAIClient — proves the whole pipeline (view,
    provider selection, structured-response validation, allow-list) works
    together, not just each piece in isolation."""

    def setUp(self):
        cache.clear()
        from .ai_provider import OpenAIYuktiProvider

        self._patcher = None
        self.OpenAIYuktiProvider = OpenAIYuktiProvider

    def tearDown(self):
        if self._patcher is not None:
            self._patcher.stop()

    def _patch_client(self, fake_client):
        from unittest.mock import patch

        self._patcher = patch.object(
            self.OpenAIYuktiProvider, '_default_client_factory', return_value=fake_client
        )
        self._patcher.start()

    def _post(self, message, route='/'):
        return self.client.post(
            '/api/v1/yukti/intent/',
            data=json.dumps({'message': message, 'context': {'route': route}}),
            content_type='application/json',
        )

    def test_full_flow_uses_ai_provider_response_when_configured(self):
        fake_client = FakeOpenAIClient()
        self._patch_client(fake_client)

        response = self._post('please help me sign in')

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body['intent'], 'OPEN_LOGIN')
        self.assertEqual(body['action'], {'type': 'NAVIGATE', 'target': '/login'})
        self.assertEqual(len(fake_client.calls), 1)

    def test_falls_back_to_deterministic_router_when_ai_call_fails(self):
        fake_client = FakeOpenAIClient(exception=RuntimeError('provider down'))
        self._patch_client(fake_client)

        # The deterministic router itself would answer this with OPEN_LOGIN —
        # proving the *real* fallback chain answered, not just the view's
        # own generic safe-fallback text.
        response = self._post('can you help me to login')

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body['intent'], 'OPEN_LOGIN')
        self.assertEqual(body['action'], {'type': 'NAVIGATE', 'target': '/login'})

    def test_arbitrary_navigation_target_is_rejected(self):
        fake_client = FakeOpenAIClient(
            response_json={
                'reply': 'Sure, opening that.',
                'language': 'en-IN',
                'intent': 'GENERAL_HELP',
                'confidence': 0.9,
                'requires_confirmation': False,
                'action': {
                    'type': 'NAVIGATE',
                    'target': 'https://evil.example.com/steal',
                    'field': None,
                    'value': None,
                    'step': None,
                },
            }
        )
        self._patch_client(fake_client)

        response = self._post('take me somewhere')

        self.assertIsNone(response.json()['action'])

    def test_javascript_url_navigation_target_is_rejected(self):
        fake_client = FakeOpenAIClient(
            response_json={
                'reply': 'ok',
                'language': 'en-IN',
                'intent': 'GENERAL_HELP',
                'confidence': 0.9,
                'requires_confirmation': False,
                'action': {
                    'type': 'NAVIGATE',
                    'target': 'javascript:alert(1)',
                    'field': None,
                    'value': None,
                    'step': None,
                },
            }
        )
        self._patch_client(fake_client)

        response = self._post('go there')

        self.assertIsNone(response.json()['action'])

    def test_multilingual_response_passes_through_unchanged(self):
        fake_client = FakeOpenAIClient(
            response_json={
                'reply': 'लॉगिन पेज खोल रहा हूँ।',
                'language': 'hi-IN',
                'intent': 'OPEN_LOGIN',
                'confidence': 0.9,
                'requires_confirmation': False,
                'action': {'type': 'NAVIGATE', 'target': '/login', 'field': None, 'value': None, 'step': None},
            }
        )
        self._patch_client(fake_client)

        response = self._post('मुझे लॉगिन करना है')

        body = response.json()
        self.assertEqual(body['language'], 'hi-IN')
        self.assertEqual(body['spoken_response'], 'लॉगिन पेज खोल रहा हूँ।')

    def test_unknown_application_question_is_handled_honestly(self):
        fake_client = FakeOpenAIClient(
            response_json={
                'reply': (
                    "I specialize in helping with Digital AI Workspace, so I can't help with that, "
                    'but I can help you sign in, register, or find your way around here.'
                ),
                'language': 'en-IN',
                'intent': 'UNKNOWN',
                'confidence': 0.4,
                'requires_confirmation': False,
                'action': {'type': 'NONE', 'target': None, 'field': None, 'value': None, 'step': None},
            }
        )
        self._patch_client(fake_client)

        response = self._post("what's the weather today")

        body = response.json()
        self.assertIsNone(body['action'])
        self.assertIn('Digital AI Workspace', body['spoken_response'])

    def test_current_route_context_is_sent_to_the_provider(self):
        fake_client = FakeOpenAIClient()
        self._patch_client(fake_client)

        self._post('explain this page', route='/register')

        sent_messages = fake_client.calls[0]['messages']
        context_message = next(m['content'] for m in sent_messages if 'Current application context' in m['content'])
        self.assertIn('/register', context_message)
        self.assertIn('Registration', context_message)

    def test_password_redacted_before_any_provider_call_end_to_end(self):
        fake_client = FakeOpenAIClient()
        self._patch_client(fake_client)

        response = self._post('my password is hunter2')

        self.assertEqual(fake_client.calls, [])
        self.assertNotIn('hunter2', json.dumps(response.json()))
        self.assertEqual(response.json()['intent'], 'EXPLAIN_PASSWORD_LOGIN')

    def test_api_key_never_appears_in_the_response(self):
        fake_client = FakeOpenAIClient()
        self._patch_client(fake_client)

        response = self._post('hello')

        self.assertNotIn('test-key-not-real', json.dumps(response.json()))

    def test_rate_limiting_falls_back_without_erroring(self):
        fake_client = FakeOpenAIClient()
        self._patch_client(fake_client)

        with override_settings(YUKTI_AI_MAX_REQUESTS_PER_WINDOW=1):
            first = self._post('help me sign in')
            second = self._post('help me sign in')

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        # Second request exceeded the AI provider's own budget and must have
        # been served by the deterministic fallback instead of erroring.
        self.assertEqual(len(fake_client.calls), 1)
        self.assertEqual(second.json()['intent'], 'OPEN_LOGIN')
