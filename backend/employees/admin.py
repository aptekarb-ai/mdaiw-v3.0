from django.contrib import admin

from .models import EmployeeProfile


@admin.register(EmployeeProfile)
class EmployeeProfileAdmin(admin.ModelAdmin):
    list_display = (
        'employee_id',
        'user',
        'designation',
        'department',
        'registration_status',
        'created_at',
    )
    list_filter = ('registration_status', 'department', 'location')
    search_fields = ('employee_id', 'user__username', 'user__email', 'user__first_name', 'user__last_name')
    readonly_fields = ('created_at', 'updated_at')
