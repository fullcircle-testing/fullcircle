import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
    googleSheetsFixtureFacade,
    type GoogleSheetsAcuityModifierRow,
} from '../../src/providers/google_sheets';

describe('Google Sheets fixture facade', () => {
    it('builds typed Acuity modifier fixtures and deterministic CSV output', () => {
        const googleSheets = googleSheetsFixtureFacade();

        const fixture = googleSheets.resources.acuityModifiers([
            {CalendarId: '7034881', TenderModifier: '1', CreditModifier: '1'},
            {CalendarId: '3287474', TenderModifier: '2', CreditModifier: '0.5'},
        ]);

        expect(fixture).toEqual({
            kind: 'google-sheets.acuity-modifiers.v1',
            rows: [
                {CalendarId: '7034881', TenderModifier: '1', CreditModifier: '1'},
                {CalendarId: '3287474', TenderModifier: '2', CreditModifier: '0.5'},
            ],
            csv: [
                'CalendarId,TenderModifier,CreditModifier',
                '7034881,1,1',
                '3287474,2,0.5',
                '',
            ].join('\n'),
        });
    });

    it('validates Acuity modifier rows before app mocks consume them', () => {
        const googleSheets = googleSheetsFixtureFacade();

        expect(() => googleSheets.resources.acuityModifiers([
            {CalendarId: '', TenderModifier: 'not-a-number', CreditModifier: '1'} as GoogleSheetsAcuityModifierRow,
        ])).toThrow('Invalid Google Sheets Acuity modifier row 0: CalendarId is required; TenderModifier must be numeric');
    });

    it('can intentionally emit malformed Acuity modifier fixtures for negative tests', () => {
        const googleSheets = googleSheetsFixtureFacade();

        const fixture = googleSheets.fixtures.acuityModifiersMalformed({
            rows: [{CalendarId: 'bad', TenderModifier: 'NaN', CreditModifier: ''}],
        });

        expect(fixture.csv).toBe('CalendarId,TenderModifier,CreditModifier\nbad,NaN,\n');
        expect(fixture.diagnostics).toEqual([
            'Invalid Google Sheets Acuity modifier row 0: TenderModifier must be numeric; CreditModifier is required',
        ]);
    });

    it('provides default, empty, and multi-calendar fixture variants', () => {
        const googleSheets = googleSheetsFixtureFacade();

        expect(googleSheets.fixtures.acuityModifiersDefault().rows).toEqual([
            {CalendarId: '7034881', TenderModifier: '1', CreditModifier: '1'},
        ]);
        expect(googleSheets.fixtures.acuityModifiersEmpty().csv).toBe('CalendarId,TenderModifier,CreditModifier\n');
        expect(googleSheets.fixtures.acuityModifiersMultiCalendar().rows).toHaveLength(3);
    });

    it('writes typed fixture JSON and CSV files for app-level MockGoogleSheetsClient usage', async () => {
        const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'fullcircle-google-sheets-'));
        const googleSheets = googleSheetsFixtureFacade();
        const fixture = googleSheets.resources.acuityModifiers([
            {CalendarId: '7034881', TenderModifier: '1', CreditModifier: '1'},
        ]);

        const written = await googleSheets.writeFixtureFiles(fixture, {
            directory: tmp,
            basename: 'acuity-modifiers.default',
        });

        expect(await fs.readFile(written.jsonPath, 'utf8')).toBe(`${JSON.stringify(fixture, null, 2)}\n`);
        expect(await fs.readFile(written.csvPath, 'utf8')).toBe(fixture.csv);
    });
});
