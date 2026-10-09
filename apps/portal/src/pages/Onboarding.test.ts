import { describe, expect, it } from 'vitest';
import { applicationPatch } from './Onboarding';

const blank = Object.fromEntries(
  ['name', 'legalName', 'countryCode', 'yearEstablished', 'licensingAuthority', 'tourismBoardLicense', 'businessRegNumber', 'address', 'email', 'phone',
    'telegramUsername', 'websiteUrl', 'referenceContactName', 'referenceContactInfo', 'descriptionEn', 'descriptionRu', 'verificationVideoUrl'].map((k) => [k, '']),
);

describe('applicationPatch', () => {
  it('sends only changed fields, numbers as numbers, cleared optional fields as null', () => {
    const original = { ...blank, name: 'Forest Walkers', countryCode: 'UG', legalName: 'Old Ltd' };
    const values = { ...original, yearEstablished: '2015', legalName: '', tourismBoardLicense: ' UTB-1 ' };
    expect(applicationPatch(values, original)).toEqual({ yearEstablished: 2015, legalName: null, tourismBoardLicense: 'UTB-1' });
  });

  it('leaves a required field out while it is empty, so a half-done draft can be saved', () => {
    const original = { ...blank, name: 'Forest Walkers', countryCode: 'UG', address: 'Kabale' };
    expect(applicationPatch({ ...original, address: '' }, original)).toEqual({});
  });
});
