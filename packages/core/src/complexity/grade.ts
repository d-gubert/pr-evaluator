/**
 * The grade of a count. A number alone says little, so the hover shows a word.
 *
 * The thresholds are a setting, because a team owns its own limit. The
 * defaults follow the common McCabe bands.
 */

export type ComplexityGrade = 'simple' | 'moderate' | 'complex' | 'critical';

export interface ComplexityThresholds {
	/** The count where `simple` ends and `moderate` starts. */
	moderate: number;
	complex: number;
	critical: number;
}

export const DEFAULT_THRESHOLDS: ComplexityThresholds = { moderate: 6, complex: 11, critical: 21 };

export function gradeOf(total: number, thresholds: ComplexityThresholds = DEFAULT_THRESHOLDS): ComplexityGrade {
	if (total >= thresholds.critical) return 'critical';
	if (total >= thresholds.complex) return 'complex';
	if (total >= thresholds.moderate) return 'moderate';
	return 'simple';
}

/** The grades from the mildest to the worst. */
export const GRADE_ORDER: readonly ComplexityGrade[] = ['simple', 'moderate', 'complex', 'critical'];

/**
 * `grade` is at least as bad as `minimum`. A view that shows only the
 * functions worth looking at filters on this.
 */
export function gradeAtLeast(grade: ComplexityGrade, minimum: ComplexityGrade): boolean {
	return GRADE_ORDER.indexOf(grade) >= GRADE_ORDER.indexOf(minimum);
}

export function gradeLabel(grade: ComplexityGrade): string {
	switch (grade) {
		case 'simple':
			return 'simple';
		case 'moderate':
			return 'moderate';
		case 'complex':
			return 'complex';
		case 'critical':
			return 'critical';
	}
}
