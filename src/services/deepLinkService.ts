// Wrapper around deep link Tauri commands.

import { invoke } from '@tauri-apps/api/core';
import type { DeepLinkResult } from '../types/deepLink';
import { withDesktop } from './tauriRuntime';

export async function launchDeepLink(
    serial: string,
    uri: string,
    packageName?: string,
    customPath?: string
): Promise<DeepLinkResult> {
    return withDesktop(() => invoke<DeepLinkResult>('launch_deep_link', {
        serial,
        uri,
        package: packageName,
        customPath
    }));
}

export async function generateQrSvg(
    text: string,
    errorCorrection: 'L' | 'M' | 'Q' | 'H' = 'M'
): Promise<string> {
    return withDesktop(() => invoke<string>('generate_qr_svg', { text, errorCorrection }));
}
