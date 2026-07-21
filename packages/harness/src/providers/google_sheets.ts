import fs from 'node:fs/promises';
import path from 'node:path';

export type GoogleSheetsAcuityModifierRow = {
    CalendarId: string;
    TenderModifier: string;
    CreditModifier: string;
};

export type GoogleSheetsAcuityModifiersFixture = {
    kind: 'google-sheets.acuity-modifiers.v1';
    rows: GoogleSheetsAcuityModifierRow[];
    csv: string;
    diagnostics?: string[];
};

export type GoogleSheetsWriteFixtureOptions = {
    directory: string;
    basename: string;
};

export type GoogleSheetsWrittenFixture = {
    jsonPath: string;
    csvPath: string;
};

export type GoogleSheetsFixtureFacade = {
    resources: {
        acuityModifiers: (rows: GoogleSheetsAcuityModifierRow[]) => GoogleSheetsAcuityModifiersFixture;
    };
    fixtures: {
        acuityModifiersDefault: () => GoogleSheetsAcuityModifiersFixture;
        acuityModifiersEmpty: () => GoogleSheetsAcuityModifiersFixture;
        acuityModifiersMultiCalendar: () => GoogleSheetsAcuityModifiersFixture;
        acuityModifiersMalformed: (input?: {rows?: GoogleSheetsAcuityModifierRow[]}) => GoogleSheetsAcuityModifiersFixture;
    };
    writeFixtureFiles: (
        fixture: GoogleSheetsAcuityModifiersFixture,
        options: GoogleSheetsWriteFixtureOptions,
    ) => Promise<GoogleSheetsWrittenFixture>;
};

const ACUITY_MODIFIER_HEADERS: Array<keyof GoogleSheetsAcuityModifierRow> = [
    'CalendarId',
    'TenderModifier',
    'CreditModifier',
];

export const googleSheetsFixtureFacade = (): GoogleSheetsFixtureFacade => ({
    resources: {
        acuityModifiers: rows => acuityModifiersFixture(rows, {validate: true}),
    },
    fixtures: {
        acuityModifiersDefault: () => acuityModifiersFixture([
            {CalendarId: '7034881', TenderModifier: '1', CreditModifier: '1'},
        ], {validate: true}),
        acuityModifiersEmpty: () => acuityModifiersFixture([], {validate: true}),
        acuityModifiersMultiCalendar: () => acuityModifiersFixture([
            {CalendarId: '7034881', TenderModifier: '1', CreditModifier: '1'},
            {CalendarId: '3287474', TenderModifier: '2', CreditModifier: '0.5'},
            {CalendarId: '5550101', TenderModifier: '0.75', CreditModifier: '1.25'},
        ], {validate: true}),
        acuityModifiersMalformed: input => {
            const rows = input?.rows || [{CalendarId: '', TenderModifier: 'NaN', CreditModifier: ''}];
            return acuityModifiersFixture(rows, {validate: false, includeDiagnostics: true});
        },
    },
    writeFixtureFiles: async (fixture, options) => {
        await fs.mkdir(options.directory, {recursive: true});
        const jsonPath = path.join(options.directory, `${options.basename}.json`);
        const csvPath = path.join(options.directory, `${options.basename}.csv`);
        await fs.writeFile(jsonPath, `${JSON.stringify(fixture, null, 2)}\n`, 'utf8');
        await fs.writeFile(csvPath, fixture.csv, 'utf8');
        return {jsonPath, csvPath};
    },
});

const acuityModifiersFixture = (
    rows: GoogleSheetsAcuityModifierRow[],
    options: {validate: boolean; includeDiagnostics?: boolean},
): GoogleSheetsAcuityModifiersFixture => {
    const diagnostics = validateAcuityModifierRows(rows);
    if (options.validate && diagnostics.length) {
        throw new Error(diagnostics.join('\n'));
    }

    return {
        kind: 'google-sheets.acuity-modifiers.v1',
        rows,
        csv: acuityModifiersCsv(rows),
        ...(options.includeDiagnostics ? {diagnostics} : {}),
    };
};

const validateAcuityModifierRows = (rows: GoogleSheetsAcuityModifierRow[]): string[] => {
    return rows.flatMap((row, index) => {
        const errors: string[] = [];
        if (!row.CalendarId) {
            errors.push('CalendarId is required');
        }
        if (!row.TenderModifier) {
            errors.push('TenderModifier is required');
        } else if (!isNumeric(row.TenderModifier)) {
            errors.push('TenderModifier must be numeric');
        }
        if (!row.CreditModifier) {
            errors.push('CreditModifier is required');
        } else if (!isNumeric(row.CreditModifier)) {
            errors.push('CreditModifier must be numeric');
        }
        return errors.length ? [`Invalid Google Sheets Acuity modifier row ${index}: ${errors.join('; ')}`] : [];
    });
};

const isNumeric = (value: string): boolean => {
    return value.trim() !== '' && Number.isFinite(Number(value));
};

const acuityModifiersCsv = (rows: GoogleSheetsAcuityModifierRow[]): string => {
    const lines = [
        ACUITY_MODIFIER_HEADERS.join(','),
        ...rows.map(row => ACUITY_MODIFIER_HEADERS.map(header => csvCell(row[header])).join(',')),
    ];
    return `${lines.join('\n')}\n`;
};

const csvCell = (value: string): string => {
    if (!/[",\n\r]/.test(value)) {
        return value;
    }
    return `"${value.replaceAll('"', '""')}"`;
};
