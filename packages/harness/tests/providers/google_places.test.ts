(Symbol as any).asyncDispose ??= Symbol('Symbol.asyncDispose');

import request from 'supertest';

import {fullcircle} from '../../src/fullcircle';
import {googlePlacesProvider} from '../../src/providers/google_places';

describe('Google Places provider harness', () => {
    it('fixtures Text Search (New) responses with field mask assertions', async () => {
        await using fc = await fullcircle({listenAddress: null, defaultDestination: 'places.googleapis.com'});
        await using th = fc.harness('places.googleapis.com');

        googlePlacesProvider(th).searchText({
            match: {
                textQuery: /Soundspace/i,
                includedType: 'music_school',
                fieldMask: 'places.id,places.displayName,places.formattedAddress',
            },
            reply: [{
                id: 'places/soundspace-hq',
                displayName: {text: 'Soundspace HQ'},
                formattedAddress: '1 Music Way, Nashville, TN',
            }],
        });

        expect((await request(fc.expressApp)
            .post('/v1/places:searchText')
            .set('X-Goog-FieldMask', 'places.id,places.displayName,places.formattedAddress')
            .send({textQuery: 'Soundspace Nashville', includedType: 'music_school'})
            .expect(200)).body)
            .toEqual({places: [{
                id: 'places/soundspace-hq',
                displayName: {text: 'Soundspace HQ'},
                formattedAddress: '1 Music Way, Nashville, TN',
            }]});
    });

    it('fixtures empty Text Search, Place Details, and browser Maps JavaScript responses', async () => {
        await using fc = await fullcircle({listenAddress: null, defaultDestination: 'places.googleapis.com'});
        await using th = fc.harness('places.googleapis.com');

        const places = googlePlacesProvider(th);
        places.searchText({match: {textQuery: 'no matches'}, reply: []});
        places.details({
            match: {name: 'places/soundspace-hq', fieldMask: /displayName/},
            reply: {id: 'places/soundspace-hq', displayName: {text: 'Soundspace HQ'}},
        });
        places.mapsJavaScript({body: 'window.google={maps:{}};'});

        expect((await request(fc.expressApp)
            .post('/v1/places:searchText')
            .send({textQuery: 'no matches'})
            .expect(200)).body)
            .toEqual({places: []});
        expect((await request(fc.expressApp)
            .get('/v1/places/soundspace-hq')
            .set('X-Goog-FieldMask', 'id,displayName')
            .expect(200)).body)
            .toEqual({id: 'places/soundspace-hq', displayName: {text: 'Soundspace HQ'}});
        expect((await request(fc.expressApp)
            .get('/maps/api/js?key=test-key&libraries=places')
            .expect(200)).text)
            .toContain('window.google={maps:{}};');
    });

    it('fixtures Google Places API errors', async () => {
        await using fc = await fullcircle({listenAddress: null, defaultDestination: 'places.googleapis.com'});
        await using th = fc.harness('places.googleapis.com');

        googlePlacesProvider(th).searchText({
            match: {textQuery: 'over quota'},
            status: 429,
            error: {error: {code: 429, status: 'RESOURCE_EXHAUSTED', message: 'Quota exceeded'}},
        });

        expect((await request(fc.expressApp)
            .post('/v1/places:searchText')
            .send({textQuery: 'over quota'})
            .expect(429)).body)
            .toEqual({error: {code: 429, status: 'RESOURCE_EXHAUSTED', message: 'Quota exceeded'}});
    });

    it('returns actionable diagnostics for mismatched Google Places requests', async () => {
        await using fc = await fullcircle({listenAddress: null, defaultDestination: 'places.googleapis.com'});
        await using th = fc.harness('places.googleapis.com');

        googlePlacesProvider(th).searchText({
            match: {textQuery: 'expected query', fieldMask: 'places.id'},
            reply: [],
        });

        const response = await request(fc.expressApp)
            .post('/v1/places:searchText')
            .set('X-Goog-FieldMask', 'places.displayName')
            .send({textQuery: 'actual query'})
            .expect(422);

        expect(response.body).toEqual({
            error: 'Google Places Text Search request did not match expectations',
            mismatches: [
                'Expected textQuery to match expected query but received actual query',
                'Expected fieldMask to match places.id but received places.displayName',
            ],
        });
    });
});
