(Symbol as any).asyncDispose ??= Symbol('Symbol.asyncDispose');

import request from 'supertest';

import {fullcircle} from '../../src/fullcircle';
import {hetznerProvider} from '../../src/providers/hetzner';

describe('Hetzner Cloud provider harness', () => {
    it('fixtures server create and delete lifecycle calls', async () => {
        await using fc = await fullcircle({
            listenAddress: null,
            defaultDestination: 'api.hetzner.cloud',
        });

        await using th = fc.harness('api.hetzner.cloud');
        const hcloud = hetznerProvider(th);
        hcloud.servers.create({
            match: {
                name: 'acme-app',
                serverType: 'cpx21',
                image: /snapshot-.+/,
                location: 'nbg1',
            },
            reply: {id: 1001, name: 'acme-app', ipv4: '203.0.113.10'},
            replyAction: {id: 3001, status: 'success'},
        });
        hcloud.servers.delete({serverId: 1001, replyAction: {id: 3002, status: 'running'}});

        const create = await request(fc.expressApp)
            .post('/v1/servers')
            .set('authorization', 'Bearer test-token')
            .send({name: 'acme-app', server_type: 'cpx21', image: 'snapshot-abc123', location: 'nbg1'})
            .expect(201);

        expect(create.body).toMatchObject({
            server: {
                id: 1001,
                name: 'acme-app',
                public_net: {
                    ipv4: {ip: '203.0.113.10'},
                },
            },
            action: {id: 3001, status: 'success'},
        });

        expect((await request(fc.expressApp)
            .delete('/v1/servers/1001')
            .expect(200)).body)
            .toEqual({action: expect.objectContaining({id: 3002, status: 'running'})});
    });

    it('fixtures volume create, attach, detach, delete, and action polling', async () => {
        await using fc = await fullcircle({
            listenAddress: null,
            defaultDestination: 'api.hetzner.cloud',
        });

        await using th = fc.harness('api.hetzner.cloud');
        const hcloud = hetznerProvider(th);
        hcloud.volumes.create({
            match: {name: 'acme-data', size: 50, location: 'nbg1'},
            reply: {id: 2001, name: 'acme-data'},
            replyAction: {id: 3003, status: 'success'},
        });
        hcloud.volumes.attach({volumeId: 2001, match: {server: 1001, automount: true}, replyAction: {id: 3004, status: 'success'}});
        hcloud.volumes.detach({volumeId: 2001, replyAction: {id: 3005, status: 'running'}});
        hcloud.actions.get({actionId: 3005, reply: {id: 3005, status: 'error', error: {code: 'action_failed', message: 'detach failed'}}});
        hcloud.volumes.delete({volumeId: 2001, status: 204});

        expect((await request(fc.expressApp)
            .post('/v1/volumes')
            .send({name: 'acme-data', size: 50, location: 'nbg1'})
            .expect(201)).body)
            .toMatchObject({volume: {id: 2001, name: 'acme-data', size: 50}, action: {id: 3003}});
        expect((await request(fc.expressApp)
            .post('/v1/volumes/2001/actions/attach')
            .send({server: 1001, automount: true})
            .expect(201)).body)
            .toEqual({action: expect.objectContaining({id: 3004, status: 'success'})});
        expect((await request(fc.expressApp)
            .post('/v1/volumes/2001/actions/detach')
            .expect(201)).body)
            .toEqual({action: expect.objectContaining({id: 3005, status: 'running'})});
        expect((await request(fc.expressApp)
            .get('/v1/actions/3005')
            .expect(200)).body)
            .toEqual({action: expect.objectContaining({id: 3005, status: 'error'})});
        await request(fc.expressApp).delete('/v1/volumes/2001').expect(204);
    });

    it('supports Hetzner failure fixtures and actionable mismatch diagnostics', async () => {
        await using fc = await fullcircle({
            listenAddress: null,
            defaultDestination: 'api.hetzner.cloud',
        });

        await using th = fc.harness('api.hetzner.cloud');
        const hcloud = hetznerProvider(th);
        hcloud.servers.create({
            match: {name: 'acme-app', serverType: 'cpx21'},
            status: 503,
            error: {code: 'resource_unavailable', message: 'No capacity in location'},
        });
        hcloud.volumes.attach({
            volumeId: 2001,
            match: {server: 1001},
            status: 422,
            error: {code: 'invalid_input', message: 'server cannot attach volume'},
        });

        expect((await request(fc.expressApp)
            .post('/v1/servers')
            .send({name: 'acme-app', server_type: 'cpx21'})
            .expect(503)).body)
            .toEqual({error: {code: 'resource_unavailable', message: 'No capacity in location'}});

        const mismatch = await request(fc.expressApp)
            .post('/v1/volumes/2001/actions/attach')
            .send({server: 9999})
            .expect(422);

        expect(mismatch.body).toEqual({
            error: 'Hetzner attach volume request did not match expectations',
            mismatches: ['Expected server to match 1001 but received 9999'],
        });
    });
});
