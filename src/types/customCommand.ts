// Custom command plugin types.

export interface CommandPreset {
    id: string;
    label: string;
    /** Command template, e.g. "shell pm clear {package}". */
    template: string;
    /** True when the template references {package}. */
    needsPackage?: boolean;
}

export interface CustomCommandResult {
    success: boolean;
    stdout?: string;
    stderr?: string;
    error?: string;
    errorCode?: string;
}

export const CUSTOM_COMMANDS_KEY = 'scrcpy_custom_commands';

/**
 * Split a template into tokens, respecting double-quoted spans so a quoted
 * argument (e.g. a text value) stays a single token. Quotes are stripped from
 * the resulting tokens.
 */
export function tokenizeTemplate(template: string): string[] {
    const tokens: string[] = [];
    let current = '';
    let inQuotes = false;
    for (const ch of template) {
        if (ch === '"') {
            inQuotes = !inQuotes;
        } else if (/\s/.test(ch) && !inQuotes) {
            if (current) {
                tokens.push(current);
                current = '';
            }
        } else {
            current += ch;
        }
    }
    if (current) tokens.push(current);
    return tokens;
}

/** A few useful starter presets shown when the user has none. */
export const DEFAULT_COMMAND_PRESETS: CommandPreset[] = [
    { id: 'wm-size', label: 'Show resolution', template: 'shell wm size' },
    { id: 'battery', label: 'Battery dump', template: 'shell dumpsys battery' },
    {
        id: 'clear-app',
        label: 'Clear app data',
        template: 'shell pm clear {package}',
        needsPackage: true
    },
    {
        id: 'grant-all',
        label: 'Reboot device',
        template: 'reboot'
    }
];
