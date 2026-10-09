import { packageCreateSchema } from '@ttp/shared-types';
import { toPackageInput } from './Operator';

const base = {
  title: ' Trek ', titleRu: '', descriptionEn: '', descriptionRu: 'Описание', countryCode: 'UG', durationDays: '4', price: '', currency: 'USD',
  priceBasis: 'PER_PERSON' as const, capacity: '', inclusions: ['guide'], exclusions: 'visa,  tips ,', dates: [{ startDate: '2027-02-10', endDate: '', capacity: '' }],
};

describe('toPackageInput', () => {
  it('turns the form into a valid feed entry: blanks to null, no currency without a price, one-day dates', () => {
    const input = toPackageInput(base);
    expect(input).toMatchObject({ title: 'Trek', titleRu: null, price: null, currency: null, capacity: null, exclusions: ['visa', 'tips'], dates: [{ startDate: '2027-02-10', endDate: '2027-02-10', capacity: null }] });
    expect(packageCreateSchema.safeParse(input).success).toBe(true);
  });

  it('keeps the price with its currency', () => {
    expect(toPackageInput({ ...base, price: '2450', currency: 'EUR' })).toMatchObject({ price: 2450, currency: 'EUR' });
  });

  it('lets validation catch an end date before the start', () => {
    const r = packageCreateSchema.safeParse(toPackageInput({ ...base, dates: [{ startDate: '2027-02-10', endDate: '2027-02-01', capacity: '' }] }));
    expect(r.success).toBe(false);
  });
});
