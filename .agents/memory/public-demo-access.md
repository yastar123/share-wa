---
name: Public demo access
description: Safety boundary for the public demo identities displayed on the ShareWa sign-in page.
---

The login page may show demo emails and passwords, but they are examples for public, read-only previews only. They must never grant access to real Clerk accounts, database records, admin actions, or WhatsApp messaging.

**Why:** the user asked for demo identities to be visible on the login page, while the real workspace contains private contacts, messages, and linked WhatsApp sessions.

**How to apply:** Keep demo routes backed only by fictional in-app data. Assign real admin permissions only to a verified, owner-controlled email.
