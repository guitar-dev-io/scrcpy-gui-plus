import { render, screen, fireEvent } from '@testing-library/react';
import Sidebar from '../Sidebar';
import { describe, it, expect, vi } from 'vitest';

describe('Sidebar Component', () => {
    const mockProps = {
        devices: ['device1', 'device2'],
        runningDevices: ['device1'],
        onRefresh: vi.fn(),
        onKillAdb: vi.fn(),
        selectedDevice: 'device1',
        onSelectDevice: vi.fn(),
        onPair: vi.fn(),
        onConnect: vi.fn(),
        historyDevices: [],
        onFilePush: vi.fn(),
        isAutoConnect: false,
        onToggleAuto: vi.fn(),
        isRefreshing: false
    };

    it('renders device list correctly', () => {
        render(<Sidebar {...mockProps} />);
        expect(screen.getByText('device1')).toBeInTheDocument();
        expect(screen.getByText('device2')).toBeInTheDocument();
    });

    it('shows "Live" status for running devices', () => {
        render(<Sidebar {...mockProps} />);
        const liveIndicator = screen.getByText('Live');
        expect(liveIndicator).toBeInTheDocument();
        expect(liveIndicator).toHaveClass('text-emerald-500');
    });

    it('calls onSelectDevice when a device is clicked', () => {
        render(<Sidebar {...mockProps} />);
        fireEvent.click(screen.getByText('device2'));
        expect(mockProps.onSelectDevice).toHaveBeenCalledWith('device2');
    });

    it('calls onRefresh when refresh button is clicked', () => {
        render(<Sidebar {...mockProps} />);
        fireEvent.click(screen.getByText(/refresh/i));
        expect(mockProps.onRefresh).toHaveBeenCalled();
    });

    it('switches tabs correctly', () => {
        render(<Sidebar {...mockProps} />);

        // USB default
        expect(screen.getByText('USB Setup Tip')).toBeInTheDocument();

        // Switch to Wireless
        fireEvent.click(screen.getByText('Wireless'));
        expect(screen.getByText('Wireless Setup Tip')).toBeInTheDocument();
    });

    it('renders mdns discovered devices and calls onConnect when clicked', () => {
        const mdnsProps = {
            ...mockProps,
            mdnsDevices: [
                { name: 'DiscoveredPhone', service: '_adb-tls-connect._tcp', address: '192.168.0.104:44321' }
            ]
        };
        render(<Sidebar {...mdnsProps} />);

        // Switch to Wireless tab to see it
        fireEvent.click(screen.getByText('Wireless'));
        expect(screen.getByText(/DiscoveredPhone/)).toBeInTheDocument();

        // Click the connect button next to/on the discovered device
        const connectBtn = screen.getByText(/DiscoveredPhone/).closest('button');
        expect(connectBtn).toBeInTheDocument();
        if (connectBtn) {
            fireEvent.click(connectBtn);
            expect(mockProps.onConnect).toHaveBeenCalledWith('192.168.0.104:44321');
        }
    });
});
