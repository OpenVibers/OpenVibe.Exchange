# Gateway migration research — 2026-11-09

The plan's OpenRouter routing/fallback/preset/BYOK documentation and Eden AI, Vercel and Respan comparisons were checked alongside the existing exchange-chat research. Vendor comparisons are discovery material, not independent proof of parity or performance. The older collected price/count claims are not repeated here.

## Three additions worth building

1. **Reject unsupported configuration rather than silently dropping it.** A [LiteLLM user report](https://github.com/BerriAI/litellm/issues/37125) describes response_format being accepted but ignored. Another [user report](https://github.com/BerriAI/litellm/issues/44815) describes configuration failures being hidden by a more expensive fallback. These are reported experiences, not a claim about every current version. The C2 preview rejects unknown fields and validates types before any provider call. It does not claim execution-time enforcement yet.
2. **Explain a route before sending a prompt.** [OpenRouter's provider routing](https://openrouter.ai/docs/guides/routing/provider-selection) has independent order, privacy and price constraints. A zero-inference preview makes excluded offers and absent evidence inspectable. The new diagnostic refuses to treat an unknown price as zero or missing privacy metadata as a promise. Quality/throughput execution requires real evidence and is still pending.
3. **Forward request idempotency through compatible endpoints.** [LiteLLM's reliability guide](https://docs.litellm.ai/docs/router/learn/reliability) separates retries, fallbacks and cooldowns. Multiple retry layers make accidental repeated execution worth preventing. C2 connects the Idempotency-Key header to the existing durable run deduplication for both protocols, exposes replay status and avoids charging an opaque key's local usage counter for replayed results. This does not add automatic retries or relax budget reservations.

## Migration evidence and limits

- [OpenRouter preset examples](https://openrouter.ai/blog/tutorials/presets/) bundle model selection, routing and sampling. The importer here validates a deliberately explicit JSON subset; it is a preview, not a live account importer or a persistent preset service.
- [OpenRouter model fallbacks](https://openrouter.ai/docs/guides/routing/model-fallbacks) and [BYOK](https://openrouter.ai/docs/guides/overview/auth/byok) remain execution requirements for later C2 work; no equivalence is claimed by these preview tools.
- [Vercel's OpenAI-compatible provider](https://ai-sdk.dev/providers/openai-compatible-providers) exposes a base URL, but gateway-specific options do not automatically translate.
- [OpenRouter's routing update](https://openrouter.ai/blog/announcements/how-we-rebuilt-provider-routing/) describes conversation affinity to preserve caches. It is promising future work, but adding affinity requires provider health and privacy-aware invalidation; no untested cache sharing is added.

Built using public documentation, web search and local fixtures. No new accounts, paid research calls, provider requests or production writes were made.
