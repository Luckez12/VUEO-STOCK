# VUEO-STOCK

Official registry for VUEO native JavaScript providers.

Providers in this repository target the VUEO QuickJS runtime and must follow the VUEO provider contract. This repository does not contain the VUEO Android application.

## Structure

- `registry.json`: provider catalogue consumed by VUEO Content Manager
- `providers/<id>/manifest.json`: provider metadata
- `providers/<id>/provider.js`: QuickJS-compatible provider entry point
- `schemas/`: JSON schemas
- `scripts/validate.mjs`: dependency-free repository validator

## Validate

```bash
npm run validate
```

Only add providers for sources you are authorised to access. Do not bypass authentication, DRM, CAPTCHA, access controls or other technical protections.
