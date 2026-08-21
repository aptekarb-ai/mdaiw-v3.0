from django.contrib import admin

from .models import EmailDocument, SavedEmailModule


@admin.register(EmailDocument)
class EmailDocumentAdmin(admin.ModelAdmin):
    list_display = ('name', 'user', 'platform', 'width', 'start_type', 'status', 'updated_at')
    list_filter = ('platform', 'start_type', 'status')
    search_fields = ('name', 'user__username', 'user__email')
    readonly_fields = ('created_at', 'updated_at')


@admin.register(SavedEmailModule)
class SavedEmailModuleAdmin(admin.ModelAdmin):
    list_display = ('name', 'user', 'module_type', 'updated_at')
    list_filter = ('module_type',)
    search_fields = ('name', 'user__username', 'user__email')
    readonly_fields = ('created_at', 'updated_at')
