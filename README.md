# Payment webhook prototype

Small TypeScript/Express prototype for receiving signed webhook events and simulating queue retries. It does not process real payments.

## Run locally

Use Node.js 20 or newer. Set `WEBHOOK_SECRET` in the shell before starting. Keep the value out of source control and logs.

```sh
npm ci
npm test
WEBHOOK_SECRET=replace-this-locally npm start
```

On Windows PowerShell, set the variable with `$env:WEBHOOK_SECRET = "your-local-test-value"`.

The endpoint accepts an HMAC-SHA256 hex signature in `x-webhook-signature`. Requests use the raw body bytes. The `/events` route returns counts only.

## Limits

Events and retries live in memory and disappear when the process stops. The sample simulates work; it is not connected to a payment provider, durable queue, database, or production alerting. Use synthetic data only.
