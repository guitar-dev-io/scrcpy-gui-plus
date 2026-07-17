import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ControlPanel from '.';
import { RenderDriverSupport, ScrcpyConfig } from '../../hooks/useScrcpy';

const supportedRenderers: RenderDriverSupport = {
    hostOs: 'windows',
    supportsRenderDriver: true,
    supportedDrivers: [
        { id: 'direct3d', label: 'D3D11 (Direct3D)' },
        { id: 'opengl', label: 'OpenGL' }
    ]
};

const unsupportedRenderers: RenderDriverSupport = {
    hostOs: 'windows',
    supportsRenderDriver: false,
    supportedDrivers: []
};

function createConfig(overrides: Partial<ScrcpyConfig> = {}): ScrcpyConfig {
    return {
        device: 'device-1',
        sessionMode: 'mirror',
        fps: 60,
        res: '0',
        ...overrides
    };
}

function renderControlPanel(config: ScrcpyConfig, support: RenderDriverSupport, setConfig = vi.fn()) {
    render(
        <ControlPanel
            config={config}
            setConfig={setConfig}
            onStart={vi.fn()}
            onStop={vi.fn()}
            isRunning={false}
            onListOptions={vi.fn()}
            detectedCameras={[]}
            renderDriverSupport={support}
        />
    );

    return setConfig;
}

async function openRendererSelect(user: ReturnType<typeof userEvent.setup>) {
    const label = screen.getByText('Graphics Renderer');
    const container = label.parentElement as HTMLElement;
    const button = container.querySelector('button') as HTMLButtonElement;
    await user.click(button);
}

describe('ControlPanel renderer selector', () => {
    describe('with supported renderers and default config', () => {
        let user: ReturnType<typeof userEvent.setup>;

        beforeEach(() => {
            user = userEvent.setup();
            renderControlPanel(createConfig(), supportedRenderers);
        });

        it('shows graphics renderer label', () => {
            expect(screen.getByText('Graphics Renderer')).toBeInTheDocument();
        });

        it('shows auto renderer value by default', () => {
            expect(screen.getByText('Auto')).toBeInTheDocument();
        });

        it('shows supported renderer option', async () => {
            await openRendererSelect(user);
            expect(screen.getByText('OpenGL')).toBeInTheDocument();
        });

        it('hides unsupported renderer option', async () => {
            await openRendererSelect(user);
            expect(screen.queryByText('Metal')).not.toBeInTheDocument();
        });
    });

    describe('when selecting renderers', () => {
        it('updates renderDriver when selecting supported renderer', async () => {
            const user = userEvent.setup();
            const setConfig = renderControlPanel(createConfig(), supportedRenderers);
            await openRendererSelect(user);
            await user.click(screen.getByText('D3D11 (Direct3D)'));
            expect(setConfig).toHaveBeenCalledWith(expect.objectContaining({ renderDriver: 'direct3d' }));
        });

        it('clears renderDriver when selecting auto renderer', async () => {
            const user = userEvent.setup();
            const setConfig = renderControlPanel(createConfig({ renderDriver: 'direct3d' }), supportedRenderers);
            await openRendererSelect(user);
            await user.click(screen.getByText('Auto'));
            expect(setConfig).toHaveBeenCalledWith(expect.objectContaining({ renderDriver: undefined }));
        });
    });

    describe('with unsupported renderer capability', () => {
        it('keeps renderer options auto only when support is unavailable', async () => {
            const user = userEvent.setup();
            renderControlPanel(createConfig(), unsupportedRenderers);
            await openRendererSelect(user);
            expect(screen.queryByText('OpenGL')).not.toBeInTheDocument();
        });
    });

    describe('across session modes', () => {
        it('shows renderer selector in camera mode', () => {
            renderControlPanel(createConfig({ sessionMode: 'camera' }), supportedRenderers);
            expect(screen.getByText('Graphics Renderer')).toBeInTheDocument();
        });

        it('shows renderer selector in desktop mode', () => {
            renderControlPanel(createConfig({ sessionMode: 'desktop' }), supportedRenderers);
            expect(screen.getByText('Graphics Renderer')).toBeInTheDocument();
        });
    });
});
