'use strict';
// Reviewed public provider tariffs, 2026-11-11. Refresh before expiry; no automatic stale-price purchases.
const checked_at = '2026-11-11T00:00:00Z';
const expires_at = Date.parse('2026-11-18T00:00:00Z');
const cpu = (provider, region, hourly, source, extra = {}) => ({ id: `${provider}-${region}-2x4`, provider, region,
    kind: 'cpu', cpu: 2, ram_mb: 4096, gpu_mb: 0, currency: 'USD', hourly, per_second: hourly / 3600,
    billing_seconds: 1, checked_at, expires_at, source, ...extra });
const prices = [
    cpu('baseten', 'us-pdx-1', 2 * .0655 + 4 * .0211, 'https://www.baseten.co/pricing', { promotion: 'Free until November 16; owner must set expiry', promotion_expires: '2026-11-16T00:00:00Z' }),
    cpu('baseten', 'eu-lon-1', 2 * .0655 + 4 * .0211, 'https://www.baseten.co/pricing', { promotion_expires: '2026-11-16T00:00:00Z' }),
    cpu('daytona', 'us', 2 * .0504 + 4 * .0162, 'https://www.daytona.io/pricing', { disk_gb: 5, promotion: '$200 one-time credit; expiry must be confirmed in the account' }),
    cpu('daytona', 'eu', 2 * .0504 + 4 * .0162, 'https://www.daytona.io/pricing', { disk_gb: 5 }),
    cpu('e2b', 'provider-default', 3600 * (2 * .000014 + 4 * .0000045), 'https://e2b.dev/pricing', { promotion: '$100 one-time Hobby credit; 10 concurrent; 1-hour sessions' }),
    // Fly publishes 2 shared vCPU / 2 GiB at $13.39 for 720 hours in iad/ewr.
    ...['iad','ewr'].map(region => cpu('fly', region, 13.39 / 720, 'https://docs.fly.io/about/pricing', { id: `fly-${region}-2x2`, ram_mb: 2048 })),
    { id: 'daytona-4090-preemptible', provider: 'daytona', kind: 'gpu', gpu: 'RTX 4090', gpu_mb: 24576, currency: 'USD', hourly: .57, per_second: .57/3600, interruptible: true, checked_at, expires_at, source: 'https://www.daytona.io/pricing' },
    { id: 'daytona-4090-ondemand', provider: 'daytona', kind: 'gpu', gpu: 'RTX 4090', gpu_mb: 24576, currency: 'USD', hourly: .99, per_second: .99/3600, interruptible: false, checked_at, expires_at, source: 'https://www.daytona.io/pricing' },
    { id: 'runpod-4090-pod', provider: 'runpod', kind: 'gpu', gpu: 'RTX 4090', gpu_mb: 24576, currency: 'USD', hourly: .89, per_second: .89/3600, checked_at, expires_at, source: 'https://www.runpod.io/pricing' },
];
module.exports = { checked_at, prices };
