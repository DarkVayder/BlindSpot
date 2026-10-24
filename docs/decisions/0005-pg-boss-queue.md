# 0005 — pg-boss on Postgres for background jobs

**Context.** Repository analysis jobs need retries, idempotency keys, delayed retry after rate limits, and a way to enqueue in the same transaction as the webhook delivery record. Postgres is already required.

**Decision.** Use pg-boss. Webhook ingestion writes `WebhookDelivery` and enqueues the job in one transaction, so a delivery is never recorded without its job or the other way round. Job singleton keys provide idempotency.

**Consequences.** No Redis to deploy or secure. Throughput is lower than BullMQ/Redis, which is acceptable at expected volumes. If that changes, revisit with load data.
