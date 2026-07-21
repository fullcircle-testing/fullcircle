import fetch, {Response} from 'node-fetch';

const smokeEnabled = process.env.FULLCIRCLE_REAL_PROVIDER_SMOKE === '1';
const describeSmoke = smokeEnabled ? describe : describe.skip;

const smokeTimeoutMs = 20_000;

describeSmoke('optional real provider smoke tests', () => {
    itIfEnv('HCLOUD_TOKEN')('can authenticate to Hetzner Cloud read-only endpoints', async () => {
        const response = await fetch('https://api.hetzner.cloud/v1/locations', {
            headers: {
                authorization: `Bearer ${process.env.HCLOUD_TOKEN}`,
            },
        });

        const body = await expectJsonOk<{locations?: unknown[]}>(response);
        expect(Array.isArray(body.locations)).toBe(true);
    }, smokeTimeoutMs);

    itIfEnv('OPENROUTER_API_KEY')('can authenticate to OpenRouter model catalog', async () => {
        const response = await fetch('https://openrouter.ai/api/v1/models', {
            headers: {
                authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
                'x-title': 'FullCircle real provider smoke test',
            },
        });

        const body = await expectJsonOk<{data?: unknown[]}>(response);
        expect(Array.isArray(body.data)).toBe(true);
    }, smokeTimeoutMs);

    itIfEnv('AUTUMN_SECRET_KEY', 'AUTUMN_API_KEY')('can authenticate to Autumn customer listing', async () => {
        const token = process.env.AUTUMN_SECRET_KEY || process.env.AUTUMN_API_KEY;
        const response = await fetch('https://api.useautumn.com/v1/customers.list', {
            method: 'POST',
            headers: {
                authorization: `Bearer ${token}`,
                'content-type': 'application/json',
            },
            body: JSON.stringify({limit: 1}),
        });

        const body = await expectJsonOk<Record<string, unknown>>(response);
        expect(body && typeof body === 'object').toBe(true);
    }, smokeTimeoutMs);
});

function itIfEnv(...envNames: string[]) {
    const hasAnyEnv = envNames.some(envName => Boolean(process.env[envName]));
    return hasAnyEnv ? it : it.skip;
}

async function expectJsonOk<T>(response: Response): Promise<T> {
    const text = await response.text();
    if (response.status !== 200) {
        throw new Error(`Expected HTTP 200 from real provider smoke endpoint, got ${response.status}: ${text}`);
    }
    return JSON.parse(text) as T;
}
