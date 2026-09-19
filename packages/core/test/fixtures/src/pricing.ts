export interface Line {
	quantity: number;
	price: number;
	discount?: number;
}

export function total(lines: Line[], taxRate = 0): number {
	if (lines.length === 0) return 0;
	const sum = lines.reduce((carry, line) => carry + line.quantity * line.price * (1 - (line.discount ?? 0)), 0);
	return taxRate > 0 ? sum * (1 + taxRate) : sum;
}
