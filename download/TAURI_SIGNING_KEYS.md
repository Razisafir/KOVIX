# Tauri Updater Signing Keys

**⚠️ IMPORTANT: Keep the private key secret. Only store it as a GitHub secret.**

## Public Key (safe to commit — already in tauri.conf.json)

```
x7rd+A/oSTUixP8A2n4Pe8llDov5Aaj4/QxwdBtpnuQ=
```

## Private Key (MUST be stored as GitHub Secret only)

Set as `TAURI_PRIVATE_KEY` in GitHub repository secrets:
- Go to: https://github.com/Razisafir/construct-ai-agent/settings/secrets/actions
- Name: `TAURI_PRIVATE_KEY`
- Value: (the private key — not stored in this file for security)

## Key Password (optional)

If the private key is password-protected, store the password as `TAURI_KEY_PASSWORD`.
If no password, leave the secret empty or unset.

## How to Generate New Keys (if needed)

```bash
cargo install tauri-cli
cargo tauri signer generate -w ~/.tauri/construct-keys
```

Or with Python:
```python
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives import serialization
import base64

private_key = Ed25519PrivateKey.generate()
private_bytes = private_key.private_bytes(
    encoding=serialization.Encoding.Raw,
    format=serialization.PrivateFormat.Raw,
    encryption_algorithm=serialization.NoEncryption()
)
public_key = private_key.public_key()
public_bytes = public_key.public_bytes(
    encoding=serialization.Encoding.Raw,
    format=serialization.PublicFormat.Raw
)
print("Private:", base64.b64encode(private_bytes).decode())
print("Public:", base64.b64encode(public_bytes).decode())
```

## What to Update When Keys Change

1. Update `pubkey` in `src/main/tauri.conf.json` → `plugins.updater.pubkey`
2. Update `TAURI_PRIVATE_KEY` GitHub secret
3. All subsequent releases will be signed with the new key
