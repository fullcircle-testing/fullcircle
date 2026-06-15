(Symbol as any).asyncDispose ??= Symbol('Symbol.asyncDispose');

import request from 'supertest';

import {fullcircle} from '../../src/fullcircle';
import {attioProvider} from '../../src/providers/attio';

describe('Attio provider harness', () => {
    it('fixtures people query by email and upsert by email', async () => {
        await using fc = await fullcircle({listenAddress: null, defaultDestination: 'api.attio.com'});
        await using th = fc.harness('api.attio.com');

        const attio = attioProvider(th);
        attio.people.queryByEmail({email: 'new@example.test', reply: []});
        attio.people.upsertByEmail({
            email: 'new@example.test',
            reply: {id: {record_id: 'attio_person_1'}, values: {email_addresses: [{email_address: 'new@example.test'}]}},
        });

        expect((await request(fc.expressApp)
            .post('/v2/objects/people/records/query')
            .send({filter: {email_addresses: {email_address: {$eq: 'new@example.test'}}}})
            .expect(200)).body)
            .toEqual({data: []});
        expect((await request(fc.expressApp)
            .put('/v2/objects/people/records?matching_attribute=email_addresses')
            .send({data: {values: {email_addresses: [{email_address: 'new@example.test'}]}}})
            .expect(200)).body)
            .toEqual({data: {id: {record_id: 'attio_person_1'}, values: {email_addresses: [{email_address: 'new@example.test'}]}}});
    });

    it('fixtures existing people query, generic record search, and failure responses', async () => {
        await using fc = await fullcircle({listenAddress: null, defaultDestination: 'api.attio.com'});
        await using th = fc.harness('api.attio.com');

        const attio = attioProvider(th);
        attio.people.queryByEmail({
            email: 'existing@example.test',
            reply: [{id: {record_id: 'attio_existing'}, values: {email_addresses: [{email_address: 'existing@example.test'}]}}],
        });
        attio.records.search({
            match: {query: 'existing@example.test'},
            reply: [{object: 'people', id: {record_id: 'attio_existing'}}],
        });
        attio.people.upsertByEmail({
            email: 'fail@example.test',
            status: 409,
            error: {type: 'invalid_request_error', code: 'conflict', message: 'Multiple records matched'},
        });

        expect((await request(fc.expressApp)
            .post('/v2/objects/people/records/query')
            .send({filter: {email_addresses: {email_address: {$contains: 'existing@example.test'}}}})
            .expect(200)).body.data)
            .toEqual([{id: {record_id: 'attio_existing'}, values: {email_addresses: [{email_address: 'existing@example.test'}]}}]);
        expect((await request(fc.expressApp)
            .post('/v2/objects/records/search')
            .send({query: 'existing@example.test'})
            .expect(200)).body)
            .toEqual({data: [{object: 'people', id: {record_id: 'attio_existing'}}]});
        expect((await request(fc.expressApp)
            .put('/v2/objects/people/records?matching_attribute=email_addresses')
            .send({data: {values: {email_addresses: [{email_address: 'fail@example.test'}]}}})
            .expect(409)).body)
            .toEqual({type: 'invalid_request_error', code: 'conflict', message: 'Multiple records matched'});
    });

    it('returns actionable diagnostics for mismatched Attio request payloads', async () => {
        await using fc = await fullcircle({listenAddress: null, defaultDestination: 'api.attio.com'});
        await using th = fc.harness('api.attio.com');

        attioProvider(th).people.upsertByEmail({email: 'expected@example.test', reply: {id: {record_id: 'attio_person_1'}}});

        const response = await request(fc.expressApp)
            .put('/v2/objects/people/records?matching_attribute=email_addresses')
            .send({data: {values: {email_addresses: [{email_address: 'actual@example.test'}]}}})
            .expect(422);

        expect(response.body).toEqual({
            error: 'Attio upsert person by email request did not match expectations',
            mismatches: ['Expected email to match expected@example.test but received actual@example.test'],
        });
    });
});
