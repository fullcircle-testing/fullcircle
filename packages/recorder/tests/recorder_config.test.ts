import {
    loadRecorderConfig,
    parseDestinationArg,
    resolveRecorderConfig,
} from '../src/recorder_config';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

describe('recorder config', () => {
    it('loads JSON config files', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fullcircle-recorder-config-'));
        const configPath = path.join(dir, 'fullcircle.recorder.json');
        fs.writeFileSync(configPath, JSON.stringify({
            includeHeaders: true,
            destinations: [{host: 'https://api.stripe.com', port: 5005}],
        }));

        expect(loadRecorderConfig(configPath)).toEqual({
            includeHeaders: true,
            destinations: [{host: 'https://api.stripe.com', port: 5005}],
        });
    });

    it('loads destinations and includeHeaders from config input', () => {
        expect(resolveRecorderConfig({
            config: {
                includeHeaders: true,
                destinations: [
                    {host: 'https://api.stripe.com', port: 5005},
                    {host: 'http://localhost:3000', port: '5006'},
                ],
            },
        })).toEqual({
            includeHeaders: true,
            destinations: [
                {host: 'https://api.stripe.com', port: '5005'},
                {host: 'http://localhost:3000', port: '5006'},
            ],
        });
    });

    it('lets CLI destinations and includeHeaders override config input', () => {
        expect(resolveRecorderConfig({
            config: {
                includeHeaders: false,
                destinations: [{host: 'https://api.stripe.com', port: 5005}],
            },
            destinationArgs: ['https://api.github.com|5006'],
            includeHeadersOverride: true,
        })).toEqual({
            includeHeaders: true,
            destinations: [{host: 'https://api.github.com', port: '5006'}],
        });
    });

    it('requires at least one configured destination', () => {
        expect(() => resolveRecorderConfig({})).toThrow(/No recorder destinations configured/);
    });

    it('validates legacy destination args', () => {
        expect(parseDestinationArg('https://api.stripe.com|5005')).toEqual({
            host: 'https://api.stripe.com',
            port: '5005',
        });

        expect(() => parseDestinationArg('https://api.stripe.com')).toThrow(/Expected format/);
        expect(() => parseDestinationArg('ftp://api.stripe.com|5005')).toThrow(/http\(s\) URL/);
        expect(() => parseDestinationArg('https://api.stripe.com|nope')).toThrow(/numeric port/);
    });
});
