# Shared analysis

- `/api/v1/analysis/compare?models=openai/gpt-5-nano,openai/gpt-5-mini&kind=other&rating_kind=chat.arena`
  reads AI receipt metrics for up to six models and attaches each unchanged Bench rating.
- `/api/v1/analysis/models/openai%2Fgpt-5-nano?days=30&rating_kind=chat.arena`
  returns the daily series and the same rating used by the model page. Days may be 30 or 90.
- `/api/v1/analysis/ratings/:kind` reads the same public Bench board as Report.

Reads cache for sixty seconds, allow public browser GETs, and use SDK clients.
Metrics remain separate by day/provider/task; medians are never averaged.
Ratings below twenty eligible games and receipt cells below twenty runs are
withheld. Missing evidence is null or empty. Historical TTFT can remain null.

The model join first uses an exact catalogue/offer subject, then an unambiguous
dated API name. It returns the Bench subject with the score. Several rated
revisions never become an invented family score. Design and Exchange already
send their arena votes to Bench. Exchange's local arena tables still retain
round/result links and vote deduplication, not a second rating computation.
Design's active store already reads fitted Bench boards; its old rating table
is retained only for migration compatibility. Existing provisional Bench/Design
views remain; the new cross-site reads use the twenty-game floor.

For Fable: the existing model page has plain kit tables for the latest completed
day's runs, p50/p95 latency, TTFT and cost per run, and a plain Bench rating block
with its interval and games. Comparison JSON supplies those fields per model and
provider, plus `rating_kind` and a shared rating. The source-unavailable, cached
rating, sparse-data and ambiguous-model states need their look. No CSS was added.
