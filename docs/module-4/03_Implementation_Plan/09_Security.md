# 09 — Security

- Never expose OpenAI/API provider keys in browser code.
- Store secrets in server-side environment/secret manager.
- Browser calls your backend; backend calls the AI provider.
- Use short-lived authenticated sessions and authorization checks.
- Sanitize uploaded/imported HTML and file metadata.
- Restrict asset upload MIME type/size and scan where infrastructure supports it.
- Log AI actions without logging secrets.
- Redact sensitive personalization/sample data before provider calls when policy requires it.
- Keep platform credentials encrypted and scoped.
