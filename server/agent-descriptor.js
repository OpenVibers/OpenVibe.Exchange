'use strict';
// What openvibe.exchange tells an agent about itself (openvibe-shared/agent-layer): /.well-known/agent.json.
// Every field is something this site really serves: the pages, the public API host, and its own limits.
module.exports = {
    id: 'exchange',
    name: 'OpenVibe.Exchange',
    purpose: 'Every AI model, one account: live prices, speed and uptime for DeepSeek, Qwen, Kimi, GLM, MiniMax, Llama and the uncensored builds; chat with one model or three side by side; one OpenAI- and Anthropic-compatible endpoint.',
    home: 'https://openvibe.exchange',
    site: 'openvibe.exchange',
    api: 'https://api.openvibe.exchange/v1',
    docs: 'https://openvibe.exchange/api',
    policy: {
        auth: ['none', 'Network OIDC'],
        rateLimit: '300 page requests a minute per address; sign-in limited to 60 attempts per 15 minutes',
    },
};
