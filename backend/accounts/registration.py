from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.validators import validate_email
from django.utils import timezone
from django.utils.dateparse import parse_date

from employees.models import EmployeeProfile, employee_id_validator, phone_validator
from employees.validators import validate_profile_photo

User = get_user_model()


def _present(value):
    return bool(value and value.strip())


def _add(errors, field, message):
    errors.setdefault(field, []).append(message)


class RegistrationData:
    """Validated, cleaned registration input ready for atomic creation."""

    def __init__(self):
        self.username = ''
        self.password = ''
        self.work_email = ''
        self.first_name = ''
        self.last_name = ''
        self.employee_id = ''
        self.designation = ''
        self.department = ''
        self.location = ''
        self.manager_name = ''
        self.date_of_joining = None
        self.phone = ''
        self.date_of_birth = None
        self.profile_photo = None


def validate_registration(post_data, files):
    """Validate raw multipart registration input.

    Returns (errors, cleaned) where errors is a dict of field -> list of
    messages (empty if valid) and cleaned is a populated RegistrationData
    instance (only trustworthy when errors is empty).
    """
    errors = {}
    cleaned = RegistrationData()

    username = (post_data.get('username') or '').strip()
    password = post_data.get('password') or ''
    confirm_password = post_data.get('confirm_password') or ''
    work_email = (post_data.get('work_email') or '').strip()

    first_name = (post_data.get('first_name') or '').strip()
    last_name = (post_data.get('last_name') or '').strip()
    employee_id = (post_data.get('employee_id') or '').strip()
    designation = (post_data.get('designation') or '').strip()
    department = (post_data.get('department') or '').strip()
    location = (post_data.get('location') or '').strip()
    manager_name = (post_data.get('manager_name') or '').strip()
    date_of_joining_raw = (post_data.get('date_of_joining') or '').strip()
    phone = (post_data.get('phone') or '').strip()
    date_of_birth_raw = (post_data.get('date_of_birth') or '').strip()
    profile_photo = files.get('profile_photo')

    if not _present(username):
        _add(errors, 'username', 'Username is required.')
    elif User.objects.filter(username=username).exists():
        _add(errors, 'username', 'A user with this username already exists.')

    if not password:
        _add(errors, 'password', 'Password is required.')
    if not confirm_password:
        _add(errors, 'confirm_password', 'Please confirm your password.')
    if password and confirm_password and password != confirm_password:
        _add(errors, 'confirm_password', 'Passwords do not match.')
    if password:
        try:
            validate_password(password, user=User(username=username or 'placeholder', email=work_email))
        except DjangoValidationError as exc:
            for message in exc.messages:
                _add(errors, 'password', message)

    normalized_email = ''
    if not _present(work_email):
        _add(errors, 'work_email', 'Work email is required.')
    else:
        try:
            validate_email(work_email)
        except DjangoValidationError:
            _add(errors, 'work_email', 'Enter a valid email address.')
        else:
            normalized_email = User.objects.normalize_email(work_email)
            if User.objects.filter(email__iexact=normalized_email).exists():
                _add(errors, 'work_email', 'This email is already registered.')

    if not _present(first_name):
        _add(errors, 'first_name', 'First name is required.')
    if not _present(last_name):
        _add(errors, 'last_name', 'Last name is required.')

    if not _present(employee_id):
        _add(errors, 'employee_id', 'Employee ID is required.')
    else:
        try:
            employee_id_validator(employee_id)
        except DjangoValidationError as exc:
            for message in exc.messages:
                _add(errors, 'employee_id', message)
        if EmployeeProfile.objects.filter(employee_id=employee_id).exists():
            _add(errors, 'employee_id', 'This Employee ID is already registered.')

    if not _present(designation):
        _add(errors, 'designation', 'Designation is required.')
    if not _present(department):
        _add(errors, 'department', 'Department is required.')
    if not _present(location):
        _add(errors, 'location', 'Location is required.')
    if not _present(manager_name):
        _add(errors, 'manager_name', 'Reporting manager is required.')

    date_of_joining = parse_date(date_of_joining_raw) if date_of_joining_raw else None
    if not date_of_joining_raw:
        _add(errors, 'date_of_joining', 'Date of joining is required.')
    elif date_of_joining is None:
        _add(errors, 'date_of_joining', 'Enter a valid date of joining.')

    if not _present(phone):
        _add(errors, 'phone', 'Phone number is required.')
    else:
        try:
            phone_validator(phone)
        except DjangoValidationError as exc:
            for message in exc.messages:
                _add(errors, 'phone', message)

    date_of_birth = parse_date(date_of_birth_raw) if date_of_birth_raw else None
    if not date_of_birth_raw:
        _add(errors, 'date_of_birth', 'Date of birth is required.')
    elif date_of_birth is None:
        _add(errors, 'date_of_birth', 'Enter a valid date of birth.')
    elif date_of_birth >= timezone.localdate():
        _add(errors, 'date_of_birth', 'Date of birth cannot be today or in the future.')

    if profile_photo is not None:
        try:
            validate_profile_photo(profile_photo)
        except DjangoValidationError as exc:
            for message in exc.messages:
                _add(errors, 'profile_photo', message)

    if errors:
        return errors, cleaned

    cleaned.username = username
    cleaned.password = password
    cleaned.work_email = normalized_email
    cleaned.first_name = first_name
    cleaned.last_name = last_name
    cleaned.employee_id = employee_id
    cleaned.designation = designation
    cleaned.department = department
    cleaned.location = location
    cleaned.manager_name = manager_name
    cleaned.date_of_joining = date_of_joining
    cleaned.phone = phone
    cleaned.date_of_birth = date_of_birth
    cleaned.profile_photo = profile_photo

    return errors, cleaned
