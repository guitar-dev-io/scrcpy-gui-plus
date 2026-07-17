// Wrapper around deep link Tauri commands.

import { invoke } from '@tauri-apps/api/core';
import type { DeepLinkResult } from '../types/deepLink';

export async function launchDeepLink(
    serial: string,
    uri: string,
    packageName?: string,
    customPath?: string
): Promise<DeepLinkResult> {
    return invoke<DeepLinkResult>('launch_deep_link', {
        serial,
        uri,
        package: packageName,
        customPath
    });
}

export async function generateQrSvg(text: string): Promise<string> {
    return invoke<string>('generate_qr_svg', { text });
}
