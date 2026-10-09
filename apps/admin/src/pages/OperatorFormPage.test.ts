import { toPayload } from './OperatorFormPage';

const blank = {
  name: '', legalName: '', countryCode: '', licensingAuthority: '', tourismBoardLicense: '', businessRegNumber: '', address: '',
  yearEstablished: '', referenceContactName: '', referenceContactInfo: '', websiteUrl: '', email: '', phone: '', telegramUsername: '',
  verificationVideoUrl: '', descriptionRu: '', descriptionEn: '',
};

describe('toPayload', () => {
  it('leaves blank fields out when creating, trims, and turns the year into a number', () => {
    expect(toPayload({ ...blank, name: '  Acme  ', yearEstablished: '2010' })).toEqual({ name: 'Acme', yearEstablished: 2010 });
  });

  it('sends only changed fields when editing, with null for a cleared optional field', () => {
    const original = { ...blank, name: 'Acme', websiteUrl: 'https://a.example.com', phone: '1' };
    expect(toPayload({ ...original, websiteUrl: '', phone: ' 1 ' }, original)).toEqual({ websiteUrl: null });
  });

  it('sends an empty string for a cleared required field so validation flags it', () => {
    const original = { ...blank, name: 'Acme' };
    expect(toPayload({ ...original, name: '' }, original)).toEqual({ name: '' });
  });
});
