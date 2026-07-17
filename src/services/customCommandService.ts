// Wrapper around the custom command Tauri command.

import { invoke } from '@tauri-apps/api/core';
import type { CustomCommandResult } from '../types/customCommand';

export async function runCustomCommand(
    serial: string,
    tokens: string[],
    packageName?: string,
    customPath?: string
): Promise<CustomCommandResult> {
    return invoke<CustomCommandResult>('run_custom_command', {
        serial,
        tokens,
        package: packageName,
        customPath
    });
}
