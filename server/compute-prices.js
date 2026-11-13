'use strict';
// The compute price book: provider tariffs, read by hand from each provider's own public price page.
//
//   provider   page                                  read on      what was read there
//   baseten    https://www.baseten.co/pricing        2026-11-13   CPU $0.0655/vCPU/hr, memory $0.0211 GB RAM/hr, storage $0.20 GB/month;
//                                                                 no promotion shown on the page (it showed none on 11-13)
//   daytona    https://www.daytona.io/pricing         2026-11-13   vCPU $0.0504/h, memory $0.0162/GiB/h, storage $0.000108/GiB/h (5 GiB free);
//                                                                 Windows adds $0.0858/vCPU/h; GPU preemptible RTX 4090 $0.57/h,
//                                                                 on-demand RTX 4090 $0.99/h; $200 in free compute included
//   e2b        https://e2b.dev/pricing                2026-11-13   vCPU $0.000014/s, memory $0.0000045/GiB/s; Hobby free with $100 in credits,
//                                                                 sessions up to 1 hour, 10 concurrent sandboxes
//   fly        https://docs.fly.io/about/pricing      2026-11-13   shared-cpu-2x with 2 GB RAM $13.39/month in iad and ewr (30 days of runtime)
//   runpod     https://www.runpod.io/pricing          2026-11-13   RTX 4090 pod $0.89/hr (Secure Cloud); the page also publishes a Community
//                                                                 Cloud RTX 4090 at $0.34/hr, which is not published here: the page does
//                                                                 not say whether a community pod can be stopped, and a price without
//                                                                 that answer is not one to offer
//
// Every row keeps the page it was read from (source) and the day it was read (checked_at); expires_at is the day it
// must be read again. A price that cannot be read from the provider's page is never published: the row is left out
// rather than guessed, and the page says the list is past its review date. No automatic stale-price purchases.
const checked_at = '2026-11-13T00:00:00Z';
const expires_at = Date.parse('2026-11-20T00:00:00Z');
const cpu = (provider, region, hourly, source, extra = {}) => ({ id: `${provider}-${region}-2x4`, provider, region,
    kind: 'cpu', cpu: 2, ram_mb: 4096, gpu_mb: 0, currency: 'USD', hourly, per_second: hourly / 3600,
    billing_seconds: 1, checked_at, expires_at, source, ...extra });
const prices = [
    // Baseten's prices are read from its page. Its page showed no promotion on 2026-11-13, so the offer is kept
    // with its end date and marked as unconfirmed rather than restated as a fact.
    cpu('baseten', 'us-pdx-1', 2 * .0655 + 4 * .0211, 'https://www.baseten.co/pricing', { promotion: 'Free until November 16; not on the price page on 2026-11-13, owner must confirm', promotion_expires: '2026-11-16T00:00:00Z' }),
    cpu('baseten', 'eu-lon-1', 2 * .0655 + 4 * .0211, 'https://www.baseten.co/pricing', { promotion_expires: '2026-11-16T00:00:00Z' }),
    cpu('daytona', 'us', 2 * .0504 + 4 * .0162, 'https://www.daytona.io/pricing', { disk_gb: 5, promotion: '$200 in free compute included; expiry must be confirmed in the account' }),
    cpu('daytona', 'eu', 2 * .0504 + 4 * .0162, 'https://www.daytona.io/pricing', { disk_gb: 5 }),
    cpu('e2b', 'provider-default', 3600 * (2 * .000014 + 4 * .0000045), 'https://e2b.dev/pricing', { promotion: 'Hobby is free with $100 in credits; sessions up to 1 hour, 10 concurrent sandboxes' }),
    // Fly publishes shared-cpu-2x with 2 GB RAM at $13.39 for 720 hours in iad/ewr.
    ...['iad', 'ewr'].map(region => cpu('fly', region, 13.39 / 720, 'https://docs.fly.io/about/pricing', { id: `fly-${region}-2x2`, ram_mb: 2048 })),
    // Daytona's own price page calls the cheap RTX 4090 tier "Preemptible": the machine may be interrupted. The
    // page says so in those words, so the row says it too and carries interruptible for the filters that ask.
    { id: 'daytona-4090-preemptible', provider: 'daytona', kind: 'gpu', gpu: 'RTX 4090', gpu_mb: 24576, currency: 'USD', hourly: .57, per_second: .57/3600, interruptible: true, checked_at, expires_at, source: 'https://www.daytona.io/pricing' },
    { id: 'daytona-4090-ondemand', provider: 'daytona', kind: 'gpu', gpu: 'RTX 4090', gpu_mb: 24576, currency: 'USD', hourly: .99, per_second: .99/3600, interruptible: false, checked_at, expires_at, source: 'https://www.daytona.io/pricing' },
    { id: 'runpod-4090-pod', provider: 'runpod', kind: 'gpu', gpu: 'RTX 4090', gpu_mb: 24576, currency: 'USD', hourly: .89, per_second: .89/3600, checked_at, expires_at, source: 'https://www.runpod.io/pricing' },
];
module.exports = { checked_at, prices };
