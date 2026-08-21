"""Secure LP Preview — Module 3.

Assembles the current editor state (HTML + active stylesheet + JavaScript +
simulated AMPscript) into one standalone HTML document, stores it as a
short-lived, per-user, unguessable-token snapshot, and serves it inside a
sandboxed opaque-origin iframe so previewed JavaScript never runs with the
authenticated application's cookies, storage, or window access.

Submodules:
  - cdn_policy: classifies external resource URLs (approved CDN / unapproved
    remote / mixed content / blocked protocol / local asset).
  - ampscript_preview: static, non-executing AMPscript simulator.
  - assembly: parser-aware (html5lib) document builder.
  - csp: Content-Security-Policy strings for the outer shell and the inner
    assembled document.
"""
