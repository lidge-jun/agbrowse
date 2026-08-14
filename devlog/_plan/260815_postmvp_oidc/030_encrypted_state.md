# 030 Encrypted State (H-009)

## Modify: web-ai/session-store.mjs
- AES-256-GCM encrypt/decrypt wrapper
- Key from AGBROWSE_STATE_KEY env or auto-generated in DATA_DIR
- Transparent migration: read plaintext, write encrypted

## Test: test/unit/encrypted-state.test.mjs
