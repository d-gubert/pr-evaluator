import { total } from '../src/pricing';

describe('pricing', () => {
	it('returns zero for an empty basket', () => {
		expect(total([])).toBe(0);
	});

	it('applies the tax rate', () => {
		expect(total([{ quantity: 1, price: 10 }], 0.2)).toBe(12);
	});
});
