// @ts-nocheck
// @vitest-environment jsdom
// Minimal E2E contract test: change the "I am a" persona in the real UI,
// submit a chat question, and assert the outgoing request carries persona +
// district. Renders the REAL App (store + Shell + ChatPanel + Home) with the
// API layer mocked at fetch level.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import App from '../src/App';

const chatResponses = [];

function mockFetch(url, opts) {
  const u = String(url);
  const body = opts && opts.body ? JSON.parse(opts.body) : {};
  const respond = (data) => Promise.resolve({
    ok: true, status: 200, json: () => Promise.resolve(data),
  });
  if (u.includes('/api/v1/chat')) {
    chatResponses.push(body);
    return respond({ answer: `MOCKED for ${body.user_type}`, evidence: [], risk: { level: 'LOW' } });
  }
  if (u.includes('/api/v1/warnings')) return respond({ verified: null });
  if (u.includes('/api/sources')) return respond({ adapters: [] });
  if (u.includes('/api/health')) return respond({ demo_mode: false });
  if (u.includes('/api/v1/system/status')) return respond({ state: 'LIVE' });
  if (u.includes('/api/v1/location/reports')) return respond({ reports: [] });
  return respond({});
}

vi.stubGlobal('fetch', vi.fn(mockFetch));
// jsdom has no audio playback or speech synthesis
window.Audio = vi.fn().mockImplementation(() => ({ play: () => Promise.resolve(), pause: () => {} }));
window.speechSynthesis = undefined;

describe('"I am a" persona drives the conversation', () => {
  beforeEach(() => { chatResponses.length = 0; localStorage.clear(); });
  afterEach(cleanup);

  it('sends the selected persona and district with every question', async () => {
    render(<App />);

    // Select persona = farmer in the topbar dropdown (real <select>)
    const personaSelect = screen.getAllByLabelText(/I am a/i)[0];
    fireEvent.change(personaSelect, { target: { value: 'farmer' } });

    // Ask from the Home view quick action (navigates to Ask + auto-submits)
    const askBtn = await screen.findByRole('button', { name: /Will it rain tomorrow/i });
    fireEvent.click(askBtn);

    await waitFor(() => expect(chatResponses.length).toBeGreaterThan(0), { timeout: 4000 });
    const payload = chatResponses[0];
    expect(payload.user_type).toBe('farmer');
    expect(payload.language).toBe('en');
    expect(payload).toHaveProperty('latitude');
    expect(payload).toHaveProperty('longitude');

    // The answer header must show who is being answered
    await screen.findByText(/farmer/i, {}, { timeout: 4000 });
  });

  it('persona chips differ between fisherman and farmer', async () => {
    const { unmount } = render(<App />);
    const personaSelect = screen.getAllByLabelText(/I am a/i)[0];
    fireEvent.change(personaSelect, { target: { value: 'fisherman' } });
    const fisherChip = await screen.findByRole('button', { name: /sea/i });
    expect(fisherChip).toBeTruthy();
    unmount();
    render(<App />);
    const sel2 = screen.getAllByLabelText(/I am a/i)[0];
    fireEvent.change(sel2, { target: { value: 'farmer' } });
    const farmChip = await screen.findByRole('button', { name: /farm/i });
    expect(farmChip).toBeTruthy();
  });
});
