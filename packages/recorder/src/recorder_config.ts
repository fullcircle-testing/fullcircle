import fs from 'node:fs';
import path from 'node:path';

export type RecorderDestinationConfig = {
    host: string;
    port: string;
};

export type RecorderConfig = {
    destinations: RecorderDestinationConfig[];
    includeHeaders: boolean;
};

export type RecorderConfigInput = Partial<{
    destinations: Array<Partial<{
        host: unknown;
        port: unknown;
    }>>;
    includeHeaders: unknown;
}>;

export const DEFAULT_RECORDER_CONFIG_PATH = 'fullcircle.recorder.json';

export const loadRecorderConfig = (configPath: string): RecorderConfigInput | undefined => {
    const resolvedConfigPath = path.resolve(configPath);
    if (!fs.existsSync(resolvedConfigPath)) {
        return undefined;
    }

    const raw = fs.readFileSync(resolvedConfigPath, 'utf8');
    return JSON.parse(raw) as RecorderConfigInput;
};

export const parseDestinationArg = (destination: string): RecorderDestinationConfig => {
    const parts = destination.split('|');
    if (parts.length !== 2) {
        throw new Error(`Invalid destination "${destination}". Expected format "https://example.com|5005".`);
    }

    return normalizeDestination({host: parts[0], port: parts[1]}, `destination "${destination}"`);
};

export const resolveRecorderConfig = (input: {
    config?: RecorderConfigInput;
    destinationArgs?: string[];
    includeHeadersOverride?: boolean;
}): RecorderConfig => {
    const destinations = input.destinationArgs?.length
        ? input.destinationArgs.map(parseDestinationArg)
        : normalizeDestinations(input.config?.destinations);

    if (!destinations.length) {
        throw new Error(
            `No recorder destinations configured. Add ${DEFAULT_RECORDER_CONFIG_PATH} or pass --destinations https://example.com|5005.`,
        );
    }

    return {
        destinations,
        includeHeaders: input.includeHeadersOverride ?? normalizeIncludeHeaders(input.config?.includeHeaders),
    };
};

const normalizeDestinations = (destinations: RecorderConfigInput['destinations']): RecorderDestinationConfig[] => {
    if (!destinations) {
        return [];
    }

    if (!Array.isArray(destinations)) {
        throw new Error('Recorder config "destinations" must be an array.');
    }

    return destinations.map((destination, index) => normalizeDestination(destination, `destinations[${index}]`));
};

const normalizeDestination = (
    destination: Partial<{host: unknown; port: unknown}>,
    fieldName: string,
): RecorderDestinationConfig => {
    if (typeof destination.host !== 'string' || !destination.host.trim()) {
        throw new Error(`Recorder config ${fieldName}.host must be a non-empty string.`);
    }

    if (typeof destination.port !== 'string' && typeof destination.port !== 'number') {
        throw new Error(`Recorder config ${fieldName}.port must be a string or number.`);
    }

    const host = destination.host.trim();
    const port = String(destination.port).trim();
    validateUrl(host, `${fieldName}.host`);
    validatePort(port, `${fieldName}.port`);

    return {host, port};
};

const normalizeIncludeHeaders = (includeHeaders: unknown): boolean => {
    if (includeHeaders === undefined) {
        return false;
    }

    if (typeof includeHeaders !== 'boolean') {
        throw new Error('Recorder config "includeHeaders" must be a boolean.');
    }

    return includeHeaders;
};

const validateUrl = (value: string, fieldName: string) => {
    try {
        const parsed = new URL(value);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            throw new Error('unsupported protocol');
        }
    } catch {
        throw new Error(`Recorder config ${fieldName} must be an http(s) URL.`);
    }
};

const validatePort = (value: string, fieldName: string) => {
    if (!/^\d+$/.test(value)) {
        throw new Error(`Recorder config ${fieldName} must be a numeric port.`);
    }

    const parsed = Number(value);
    if (parsed < 1 || parsed > 65535) {
        throw new Error(`Recorder config ${fieldName} must be between 1 and 65535.`);
    }
};
