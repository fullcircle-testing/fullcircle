(Symbol as any).asyncDispose ??= Symbol('Symbol.asyncDispose');

import request from 'supertest';

import {fullcircle} from '../../src/fullcircle';
import {cloudflareProvider} from '../../src/providers/cloudflare';

describe('Cloudflare provider harness', () => {
    it('fixtures D1 query requests with account/database and SQL matching', async () => {
        await using fc = await fullcircle({
            listenAddress: null,
            defaultDestination: 'api.cloudflare.com',
        });

        await using th = fc.harness('api.cloudflare.com');
        cloudflareProvider(th).d1.query({
            accountId: 'acct_123',
            databaseId: 'db_123',
            match: {
                sql: /select \* from lifecycle_jobs/i,
                params: ['job_1'],
            },
            reply: {
                results: [{id: 'job_1', status: 'active'}],
                meta: {served_by: 'fullcircle'},
            },
        });

        const response = await request(fc.expressApp)
            .post('/client/v4/accounts/acct_123/d1/database/db_123/query')
            .send({sql: 'SELECT * FROM lifecycle_jobs WHERE id = ?', params: ['job_1']})
            .expect(200);

        expect(response.body).toEqual({
            success: true,
            errors: [],
            messages: [],
            result: [{
                results: [{id: 'job_1', status: 'active'}],
                meta: {served_by: 'fullcircle'},
                success: true,
            }],
        });
    });

    it('fixtures D1 error envelopes and request mismatch diagnostics', async () => {
        await using fc = await fullcircle({
            listenAddress: null,
            defaultDestination: 'api.cloudflare.com',
        });

        await using th = fc.harness('api.cloudflare.com');
        const cloudflare = cloudflareProvider(th);
        cloudflare.d1.query({
            accountId: 'acct_123',
            databaseId: 'db_123',
            match: {sql: 'UPDATE lifecycle_jobs SET status = ? WHERE id = ?'},
            status: 400,
            errors: [{code: 7500, message: 'D1_ERROR: no such table'}],
        });
        cloudflare.d1.query({
            accountId: 'acct_123',
            databaseId: 'db_123',
            match: {sql: 'SELECT ok'},
            reply: {results: []},
        });

        expect((await request(fc.expressApp)
            .post('/client/v4/accounts/acct_123/d1/database/db_123/query')
            .send({sql: 'UPDATE lifecycle_jobs SET status = ? WHERE id = ?'})
            .expect(400)).body)
            .toEqual({
                success: false,
                errors: [{code: 7500, message: 'D1_ERROR: no such table'}],
                messages: [],
                result: null,
            });

        const mismatch = await request(fc.expressApp)
            .post('/client/v4/accounts/acct_123/d1/database/db_123/query')
            .send({sql: 'SELECT wrong'})
            .expect(422);

        expect(mismatch.body).toEqual({
            error: 'Cloudflare D1 query request did not match expectations',
            mismatches: ['Expected sql to match SELECT ok but received SELECT wrong'],
        });
    });

    it('fixtures tunnel deletion including already-deleted failure states', async () => {
        await using fc = await fullcircle({
            listenAddress: null,
            defaultDestination: 'api.cloudflare.com',
        });

        await using th = fc.harness('api.cloudflare.com');
        const cloudflare = cloudflareProvider(th);
        cloudflare.tunnels.delete({
            accountId: 'acct_123',
            tunnelId: 'tun_123',
            reply: {id: 'tun_123', deleted: true},
        });
        cloudflare.tunnels.delete({
            accountId: 'acct_123',
            tunnelId: 'tun_missing',
            status: 404,
            errors: [{code: 1003, message: 'tunnel not found'}],
        });

        expect((await request(fc.expressApp)
            .delete('/client/v4/accounts/acct_123/cfd_tunnel/tun_123')
            .expect(200)).body)
            .toEqual({
                success: true,
                errors: [],
                messages: [],
                result: {id: 'tun_123', deleted: true},
            });
        expect((await request(fc.expressApp)
            .delete('/client/v4/accounts/acct_123/cfd_tunnel/tun_missing')
            .expect(404)).body)
            .toEqual({
                success: false,
                errors: [{code: 1003, message: 'tunnel not found'}],
                messages: [],
                result: null,
            });
    });

    it('fixtures future DNS create/update/delete workflows with strict record matching', async () => {
        await using fc = await fullcircle({
            listenAddress: null,
            defaultDestination: 'api.cloudflare.com',
        });

        await using th = fc.harness('api.cloudflare.com');
        const cloudflare = cloudflareProvider(th);
        cloudflare.dns.records.create({
            zoneId: 'zone_123',
            match: {type: 'CNAME', name: 'app.example.test', content: 'tunnel.example.test'},
            reply: {id: 'dns_123', type: 'CNAME', name: 'app.example.test', content: 'tunnel.example.test'},
        });
        cloudflare.dns.records.update({
            zoneId: 'zone_123',
            recordId: 'dns_123',
            match: {content: 'new-tunnel.example.test'},
            reply: {id: 'dns_123', content: 'new-tunnel.example.test'},
        });
        cloudflare.dns.records.delete({zoneId: 'zone_123', recordId: 'dns_123'});

        expect((await request(fc.expressApp)
            .post('/client/v4/zones/zone_123/dns_records')
            .send({type: 'CNAME', name: 'app.example.test', content: 'tunnel.example.test'})
            .expect(200)).body.result)
            .toMatchObject({id: 'dns_123', type: 'CNAME'});
        expect((await request(fc.expressApp)
            .put('/client/v4/zones/zone_123/dns_records/dns_123')
            .send({content: 'new-tunnel.example.test'})
            .expect(200)).body.result)
            .toMatchObject({id: 'dns_123', content: 'new-tunnel.example.test'});
        expect((await request(fc.expressApp)
            .delete('/client/v4/zones/zone_123/dns_records/dns_123')
            .expect(200)).body.result)
            .toEqual({id: 'dns_123'});
    });
});
