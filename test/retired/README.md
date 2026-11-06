# Exchange v1's tests, kept with the retirement

These files test Exchange v1: free and swap listings, their permission passports, sandbox trials, installs,
offers, the first-party catalogue and the public API. v1 is retired (2026-11-06): its pages answer 410, its
API is gone, and its tables are kept read-only. The files stay here, unrun, as the record of what v1 did;
`test/retirement.test.js` proves the retirement itself.

They are not part of `npm test` (the runner reads `test/*.test.js` only), and they depend on v1 modules this
repository no longer has.
