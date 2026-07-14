# ingest worker

## Внутренние тенанты (без гейта)

Чтобы снять биллинг-гейт для тенанта:
Firestore → tenants/{businessId}/_meta/entitlements → поле `internal: true`
Ставится только вручную в Firebase Console. Клиент это поле не может выставить.
