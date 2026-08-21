from django.contrib import admin

from .models import LandingPageProject, LandingPageVersion, ValidationIssue, ValidationReport


@admin.register(LandingPageProject)
class LandingPageProjectAdmin(admin.ModelAdmin):
    list_display = ('name', 'user', 'type', 'status', 'framework', 'updated_at')
    list_filter = ('type', 'status', 'framework')
    search_fields = ('name', 'slug', 'user__username', 'user__email')
    readonly_fields = ('created_at', 'updated_at')


@admin.register(LandingPageVersion)
class LandingPageVersionAdmin(admin.ModelAdmin):
    list_display = ('project', 'version_number', 'created_at')
    search_fields = ('project__name', 'project__user__username')
    readonly_fields = ('created_at',)


@admin.register(ValidationReport)
class ValidationReportAdmin(admin.ModelAdmin):
    list_display = ('id', 'user', 'project', 'error_count', 'warning_count', 'info_count', 'created_at')
    list_filter = ('created_at',)
    search_fields = ('user__username', 'project__name')
    readonly_fields = ('created_at',)


@admin.register(ValidationIssue)
class ValidationIssueAdmin(admin.ModelAdmin):
    list_display = ('report', 'severity', 'category', 'rule_id', 'file', 'line')
    list_filter = ('severity', 'category', 'file', 'risk')
    search_fields = ('rule_id', 'message')
