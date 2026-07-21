import type {TestHarness} from '../harness';
import {response} from '../primitives';

export type AcuityIframeVariant =
    | 'default'
    | 'insufficient_credits'
    | 'max_hours_reached'
    | 'multi_calendar_chooser'
    | 'acuity_unavailable';

export type AcuityIframeUser = {
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
};

export type AcuityIframeAppointmentType = {
    id: string | number;
    name: string;
    durationMinutes?: number;
};

export type AcuityIframeSchedulePageOptions = {
    owner?: string;
    calendarId?: string;
    capturedHtml?: string;
    user?: AcuityIframeUser;
    appointmentTypes?: AcuityIframeAppointmentType[];
    hiddenSelectors?: string[];
    variant?: AcuityIframeVariant;
    status?: number;
};

export type AcuityIframeProviderHarness = {
    schedulePage: (options: AcuityIframeSchedulePageOptions) => void;
};

export const acuityIframeProvider = (harness: TestHarness): AcuityIframeProviderHarness => ({
    schedulePage: options => {
        const query = scheduleQuery(options);
        const name = [
            'Acuity iframe schedule page',
            options.owner ? `owner=${options.owner}` : undefined,
            options.calendarId ? `calendarID=${options.calendarId}` : undefined,
        ].filter(Boolean).join(' ');

        harness.mockRoute({
            method: 'GET',
            path: '/schedule.php',
            query,
        }, () => response.text(renderSchedulePage(options), {
            status: options.status || variantStatus(options.variant),
            headers: {'content-type': 'text/html; charset=utf-8'},
        }), {name});
    },
});

const scheduleQuery = (
    options: AcuityIframeSchedulePageOptions,
): Record<string, string> | undefined => {
    const query: Record<string, string> = {};
    if (options.owner) {
        query.owner = options.owner;
    }
    if (options.calendarId) {
        query.calendarID = options.calendarId;
    }
    return Object.keys(query).length ? query : undefined;
};

const variantStatus = (variant: AcuityIframeVariant = 'default'): number => {
    return variant === 'acuity_unavailable' ? 503 : 200;
};

const renderSchedulePage = (options: AcuityIframeSchedulePageOptions): string => {
    const variant = options.variant || 'default';
    let html = options.capturedHtml || defaultCapturedHtml();

    html = patchUser(html, options.user || {});
    html = patchAppointmentTypes(html, options.appointmentTypes || []);
    html = injectHiddenSelectors(html, options.hiddenSelectors || []);
    html = injectVariantMarkup(html, variant);
    html = injectMetadata(html, options);

    return html;
};

const patchUser = (html: string, user: AcuityIframeUser): string => {
    return Object.entries({
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        phone: user.phone,
    }).reduce((current, [name, value]) => {
        return value === undefined ? current : patchInputValue(current, name, value);
    }, html);
};

const patchInputValue = (html: string, name: string, value: string): string => {
    const escaped = escapeHtml(value);
    const inputPattern = new RegExp(`(<input\\b(?=[^>]*(?:name|id)=["']${escapeRegExp(name)}["'])[^>]*)(>)`, 'i');
    if (inputPattern.test(html)) {
        return html.replace(inputPattern, (_match, start: string, end: string) => {
            const withoutExistingValue = start.replace(/\svalue=("[^"]*"|'[^']*'|[^\s>]+)/i, '');
            return `${withoutExistingValue} value="${escaped}"${end}`;
        });
    }

    const input = `<input name="${escapeHtml(name)}" value="${escaped}" />`;
    return /<\/form>/i.test(html)
        ? html.replace(/<\/form>/i, `${input}\n</form>`)
        : injectBeforeBodyEnd(html, input);
};

const patchAppointmentTypes = (
    html: string,
    appointmentTypes: AcuityIframeAppointmentType[],
): string => {
    if (!appointmentTypes.length) {
        return html;
    }

    const options = appointmentTypes.map(type => [
        `<option value="${escapeHtml(String(type.id))}"`,
        ` data-fullcircle-appointment-type="${escapeHtml(String(type.id))}"`,
        type.durationMinutes === undefined ? '' : ` data-duration-minutes="${type.durationMinutes}"`,
        `>${escapeHtml(type.name)}</option>`,
    ].join('')).join('\n');

    if (/<select\b(?=[^>]*(?:name|id)=["']appointmentType["'])[^>]*>/i.test(html)) {
        return html.replace(
            /(<select\b(?=[^>]*(?:name|id)=["']appointmentType["'])[^>]*>)([\s\S]*?)(<\/select>)/i,
            `$1\n${options}\n$3`,
        );
    }

    return injectBeforeBodyEnd(html, `<div class="fullcircle-appointment-types">${options}</div>`);
};

const injectHiddenSelectors = (html: string, selectors: string[]): string => {
    if (!selectors.length) {
        return html;
    }

    const style = `<style data-fullcircle-hidden-selectors>${selectors.join(',')}{display:none !important;}</style>`;
    return injectBeforeHeadEnd(html, style);
};

const injectVariantMarkup = (html: string, variant: AcuityIframeVariant): string => {
    const message = variantMessage(variant);
    if (!message) {
        return html;
    }

    return injectBeforeBodyEnd(html, `<div data-fullcircle-acuity-variant="${variant}" role="status">${message}</div>`);
};

const variantMessage = (variant: AcuityIframeVariant): string | undefined => {
    switch (variant) {
    case 'insufficient_credits':
        return 'Not enough booking credit';
    case 'max_hours_reached':
        return 'Maximum bookable hours reached';
    case 'multi_calendar_chooser':
        return 'Choose a calendar';
    case 'acuity_unavailable':
        return 'Acuity is unavailable';
    default:
        return undefined;
    }
};

const injectMetadata = (html: string, options: AcuityIframeSchedulePageOptions): string => {
    const metadata = [
        '<script type="application/json" data-fullcircle-acuity-iframe>',
        escapeScriptJson(JSON.stringify({
            owner: options.owner || null,
            calendarId: options.calendarId || null,
            variant: options.variant || 'default',
            appointmentTypes: options.appointmentTypes || [],
        })),
        '</script>',
    ].join('');
    return injectBeforeBodyEnd(html, metadata);
};

const defaultCapturedHtml = (): string => `<!doctype html>
<html>
<head><title>Acuity Scheduling</title></head>
<body>
<form id="appointment-form">
<input id="firstName" name="firstName" />
<input id="lastName" name="lastName" />
<input id="email" name="email" />
<input id="phone" name="phone" />
<select id="appointmentType" name="appointmentType"></select>
</form>
</body>
</html>`;

const injectBeforeHeadEnd = (html: string, fragment: string): string => {
    return /<\/head>/i.test(html)
        ? html.replace(/<\/head>/i, `${fragment}\n</head>`)
        : `${fragment}\n${html}`;
};

const injectBeforeBodyEnd = (html: string, fragment: string): string => {
    return /<\/body>/i.test(html)
        ? html.replace(/<\/body>/i, `${fragment}\n</body>`)
        : `${html}\n${fragment}`;
};

const escapeHtml = (value: string): string => value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

const escapeScriptJson = (value: string): string => value.replace(/<\//g, '<\\/');

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
