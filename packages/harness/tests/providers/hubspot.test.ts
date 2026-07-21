(Symbol as any).asyncDispose ??= Symbol('Symbol.asyncDispose');

import request from 'supertest';

import {fullcircle} from '../../src/fullcircle';
import {hubspotProvider, hubspotFormsSink} from '../../src/providers/hubspot';

describe('HubSpot provider harness', () => {
    it('fixtures contact search by email and contact create', async () => {
        await using fc = await fullcircle({listenAddress: null, defaultDestination: 'api.hubapi.com'});
        await using th = fc.harness('api.hubapi.com');

        const hubspot = hubspotProvider(th);
        hubspot.contacts.searchByEmail({email: 'new@example.test', reply: []});
        hubspot.contacts.create({
            match: {email: 'new@example.test', firstname: 'New', lastname: 'User'},
            reply: {id: 'hs_contact_1', properties: {email: 'new@example.test'}},
        });

        expect((await request(fc.expressApp)
            .post('/crm/v3/objects/contacts/search')
            .send({filterGroups: [{filters: [{propertyName: 'email', operator: 'EQ', value: 'new@example.test'}]}]})
            .expect(200)).body)
            .toEqual({total: 0, results: []});
        expect((await request(fc.expressApp)
            .post('/crm/v3/objects/contacts')
            .send({properties: {email: 'new@example.test', firstname: 'New', lastname: 'User'}})
            .expect(201)).body)
            .toEqual({id: 'hs_contact_1', properties: {email: 'new@example.test'}});
    });

    it('fixtures existing search results, contact update, and failure responses', async () => {
        await using fc = await fullcircle({listenAddress: null, defaultDestination: 'api.hubapi.com'});
        await using th = fc.harness('api.hubapi.com');

        const hubspot = hubspotProvider(th);
        hubspot.contacts.searchByEmail({
            email: 'existing@example.test',
            reply: [{id: 'hs_existing', properties: {email: 'existing@example.test'}}],
        });
        hubspot.contacts.update({
            contactId: 'hs_existing',
            match: {lifecyclestage: 'customer'},
            reply: {id: 'hs_existing', properties: {lifecyclestage: 'customer'}},
        });
        hubspot.contacts.create({
            match: {email: 'fail@example.test'},
            status: 409,
            error: {status: 'error', message: 'Contact already exists', category: 'CONFLICT'},
        });

        expect((await request(fc.expressApp)
            .post('/crm/v3/objects/contacts/search')
            .send({filterGroups: [{filters: [{propertyName: 'email', value: 'existing@example.test'}]}]})
            .expect(200)).body.results)
            .toEqual([{id: 'hs_existing', properties: {email: 'existing@example.test'}}]);
        expect((await request(fc.expressApp)
            .patch('/crm/v3/objects/contacts/hs_existing')
            .send({properties: {lifecyclestage: 'customer'}})
            .expect(200)).body)
            .toEqual({id: 'hs_existing', properties: {lifecyclestage: 'customer'}});
        expect((await request(fc.expressApp)
            .post('/crm/v3/objects/contacts')
            .send({properties: {email: 'fail@example.test'}})
            .expect(409)).body)
            .toEqual({status: 'error', message: 'Contact already exists', category: 'CONFLICT'});
    });

    it('returns actionable diagnostics for mismatched contact payloads', async () => {
        await using fc = await fullcircle({listenAddress: null, defaultDestination: 'api.hubapi.com'});
        await using th = fc.harness('api.hubapi.com');

        hubspotProvider(th).contacts.create({match: {email: 'expected@example.test'}, reply: {id: 'hs_1'}});

        const response = await request(fc.expressApp)
            .post('/crm/v3/objects/contacts')
            .send({properties: {email: 'actual@example.test'}})
            .expect(422);

        expect(response.body).toEqual({
            error: 'HubSpot contact create request did not match expectations',
            mismatches: ['Expected properties.email to match expected@example.test but received actual@example.test'],
        });
    });

    it('treats browser HubSpot form embeds as explicit script sinks', async () => {
        await using fc = await fullcircle({listenAddress: null, defaultDestination: 'js.hsforms.net'});
        await using th = fc.harness('js.hsforms.net');

        hubspotFormsSink(th).formsEmbedScript({portalId: '12345', formId: 'form_abc'});

        const response = await request(fc.expressApp)
            .get('/forms/embed/v2.js')
            .expect(200)
            .expect('content-type', /javascript/);

        expect(response.text).toContain('window.hbspt.forms.create');
        expect(response.text).toContain('portalId:"12345"');
        expect(response.text).toContain('formId:"form_abc"');
        expect(response.text).toContain('data-fullcircle-hubspot-form');
    });
});
