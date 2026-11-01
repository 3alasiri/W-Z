# Chat server (Cloudflare Worker)
1. Cloudflare dashboard -> Workers & Pages -> Create -> Worker -> Deploy, then Edit code and paste worker.js.
2. Settings -> Variables and Secrets -> add secret `ANTHROPIC_KEY` (from console.anthropic.com).
3. Copy the worker URL (https://NAME.SUBDOMAIN.workers.dev) and paste it in the chat page of the platform.
