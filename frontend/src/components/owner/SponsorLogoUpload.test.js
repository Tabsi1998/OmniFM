import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import SponsorLogoUpload from './SponsorLogoUpload.js';
import CommunitySection from '../CommunitySection.js';
import { I18nProvider } from '../../i18n.js';

// A partner's logo uploaded to this server (#486); a logo that does not load
// shows the partner's name on the website instead of a broken picture.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

describe('owner console: sponsor logo upload', () => {
  it('sends the picture as a data URL and takes the reference it gets back', async () => {
    const apiSend = vi.fn(async () => ({ ok: true, ref: `upload:${'b'.repeat(32)}` }));
    const onUploaded = vi.fn();
    render(<SponsorLogoUpload index={0} value="" apiSend={apiSend} onUploaded={onUploaded} />);
    const file = new File([PNG_BYTES], 'logo.png', { type: 'image/png' });
    await act(async () => { fireEvent.change(screen.getByTestId('cfg-sponsor-0-upload'), { target: { files: [file] } }); });

    await waitFor(() => expect(onUploaded).toHaveBeenCalledWith(`upload:${'b'.repeat(32)}`));
    const [path, method, body] = apiSend.mock.calls[0];
    expect([path, method]).toEqual(['/api/admin/pictures', 'POST']);
    expect(body.data).toMatch(/^data:image\/png;base64,/);
    expect(screen.getByTestId('cfg-sponsor-0-preview').getAttribute('src')).toBe(body.data);
  });

  it('refuses a file over 2 MB before anything is sent, and shows what the server says', async () => {
    const apiSend = vi.fn(async () => { throw new Error('Nur PNG, JPEG, WebP oder GIF.'); });
    render(<SponsorLogoUpload index={1} value={`upload:${'c'.repeat(32)}`} apiSend={apiSend} onUploaded={() => {}} />);
    expect(screen.getByTestId('cfg-sponsor-1-preview').getAttribute('src')).toBe('/api/image/sponsor/1');
    expect(screen.getByTestId('cfg-sponsor-1-uploaded')).toBeTruthy();

    const big = new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'big.png', { type: 'image/png' });
    await act(async () => { fireEvent.change(screen.getByTestId('cfg-sponsor-1-upload'), { target: { files: [big] } }); });
    expect(apiSend).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toBe('Das Bild ist größer als 2 MB.');

    const text = new File([new TextEncoder().encode('no picture')], 'fake.png', { type: 'image/png' });
    await act(async () => { fireEvent.change(screen.getByTestId('cfg-sponsor-1-upload'), { target: { files: [text] } }); });
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Nur PNG, JPEG, WebP oder GIF.'));
  });
});

describe('website: partner logos', () => {
  it('shows the name where a logo does not load', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      json: async () => ({ sponsors: [{ name: 'IT-Tabelander', logoUrl: '/api/image/sponsor/0?v=0123456789', url: 'https://it.tabelander.co.at/' }], botListings: [] }),
    })));
    render(<I18nProvider><CommunitySection /></I18nProvider>);
    const logo = await screen.findByAltText('IT-Tabelander');
    await act(async () => { fireEvent.error(logo); });
    expect(screen.queryByAltText('IT-Tabelander')).toBeNull();
    expect(screen.getByTestId('sponsor-0').textContent).toBe('IT-Tabelander');
  });
});
