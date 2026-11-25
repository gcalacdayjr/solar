# solar
Solar records for PowMR

Cloudflare Worker + static dashboard that pulls telemetry from https://solar.siseli.com.

## Worker secrets / variables
- `SISELI_USERNAME`, `SISELI_PASSWORD` (or `SISELI_TOKEN` to skip login)
- `SISELI_OPEN_APP_ID` - sent as the `IOT-Open-AppID` header
- Optional: `DASHBOARD_SECRET`, `SISELI_PASSWORD_HASH_MODE`, `SISELI_EXTRA_HEADERS`, endpoint path overrides

## Siseli request headers (work in progress)
Login currently needs `IOT-Open-Nonce` (random per request). The client also sends
`IOT-Open-Timestamp`. A signature header may still be required; the exact scheme is
being worked out from the error messages returned by `/api/dashboard`.

## Debugging
- `/api/health` - Worker is alive
- `/api/debug/raw?date=YYYY-MM-DD` - raw Siseli responses
