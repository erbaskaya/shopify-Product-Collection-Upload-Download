# Shopify Product Collection Upload Desktop 1.0.2

## Fixed

- Collection Export no longer fails when Shopify returns `THROTTLED` while reading hybrid collection sources.
- Detailed source queries now run one collection at a time.
- Throttled GraphQL responses are retried automatically using Shopify cost and restore-rate information.
- A short delay between source queries prevents burst throttling on stores with many collections.

## Upgrade

Install the 1.0.2 setup file over 1.0.1. Existing stores, tokens, settings, and history remain in the local application data directory.
