import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import OwnerLegalChecklist from './OwnerLegalChecklist.js';

// "Firma & Recht" (#424): the checklist with a traffic light per page, from
// what visitors see.

// Like the live data on 2026-09-28: no media owner, no "valid from".
const ANSWERS = {
  '/api/legal': {
    legal: {
      providerName: 'Max Mustermann', streetAddress: 'Musterstraße 1', postalCode: '4020', city: 'Linz',
      email: 'hallo@omnifm.xyz', businessPurpose: 'Betrieb eines Discord-Radio-Dienstes', mediaOwner: '',
    },
  },
  '/api/privacy': {
    controller: { name: 'Max Mustermann', streetAddress: 'Musterstraße 1', postalCode: '4020', city: 'Linz' },
    contact: { email: 'hallo@omnifm.xyz' },
    authority: { name: 'Österreichische Datenschutzbehörde' },
    dpo: {},
    hosting: { provider: '', location: 'Österreich | EU' },
  },
  '/api/terms': {
    operator: { providerName: 'Max Mustermann' },
    contact: { email: 'hallo@omnifm.xyz', effectiveDate: '', governingLaw: 'Österreichisches Recht' },
  },
};

const apiGet = vi.fn(async (path) => ANSWERS[path]);

afterEach(() => {
  cleanup();
  apiGet.mockClear();
});

describe('legal checklist', () => {
  it('shows a light per page, what is missing and why, and the public page as preview', async () => {
    render(<OwnerLegalChecklist apiGet={apiGet} token="t" version="1" notApplicable={[]} onNotApplicable={() => {}} />);
    await screen.findByTestId('legal-page-imprint');

    expect(screen.getByTestId('legal-page-imprint').dataset.light).toBe('yellow');
    expect(screen.getByTestId('legal-page-disclosure').dataset.light).toBe('red');
    expect(screen.getByTestId('legal-page-privacy').dataset.light).toBe('yellow');
    expect(screen.getByTestId('legal-page-terms').dataset.light).toBe('red');
    expect(screen.getByTestId('legal-light-disclosure').textContent).toContain('Pflichtangaben fehlen');

    const mediaOwner = screen.getByTestId('legal-item-mediaOwner');
    expect(mediaOwner.dataset.state).toBe('missing');
    expect(mediaOwner.textContent).toContain('§ 25 Abs. 5 MedienG');
    expect(screen.getByTestId('legal-item-effectiveDate').dataset.state).toBe('missing');
    expect(screen.getByTestId('legal-item-address').dataset.state).toBe('ok');
    expect(screen.getByTestId('legal-preview-privacy').getAttribute('href')).toBe('/datenschutz?lang=de');
    expect(apiGet.mock.calls.map(([path]) => path).sort()).toEqual(['/api/legal', '/api/privacy', '/api/terms']);
  });

  it('"Trifft nicht zu" is offered only where it may not apply and turns the point grey', async () => {
    const onNotApplicable = vi.fn();
    const { rerender } = render(<OwnerLegalChecklist apiGet={apiGet} token="t" version="1" notApplicable={[]} onNotApplicable={onNotApplicable} />);
    await screen.findByTestId('legal-page-imprint');

    expect(screen.queryByTestId('legal-na-mediaOwner')).toBeNull();
    fireEvent.click(screen.getByTestId('legal-na-vatId'));
    expect(onNotApplicable).toHaveBeenCalledWith('vatId', true);

    rerender(<OwnerLegalChecklist apiGet={apiGet} token="t" version="1" notApplicable={['vatId', 'commercialRegister', 'supervisoryAuthority', 'profession']} onNotApplicable={onNotApplicable} />);
    expect(screen.getByTestId('legal-item-vatId').dataset.state).toBe('na');
    expect(screen.getByTestId('legal-page-imprint').dataset.light).toBe('green');
  });
});
