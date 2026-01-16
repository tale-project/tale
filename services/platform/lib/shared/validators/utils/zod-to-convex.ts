import { z } from 'zod';
import { v } from 'convex/values';
import type { Validator } from 'convex/values';

export function createValidator<T extends z.ZodType, V extends Validator<z.infer<T>>>(
	zodSchema: T,
	convexValidator: V,
): {
	zodSchema: T;
	convexValidator: V;
	zodType: z.infer<T>;
	convexType: V['type'];
} {
	return {
		zodSchema,
		convexValidator,
		zodType: undefined as z.infer<T>,
		convexType: undefined as V['type'],
	};
}

export function literalsToUnion<T extends readonly [string, ...string[]]>(
	literals: T,
): z.ZodEnum<T> {
	return z.enum(literals);
}

export function literalsToConvexUnion<T extends string>(
	literals: readonly T[],
): Validator<T> {
	if (literals.length === 0) {
		throw new Error('literalsToConvexUnion requires at least one literal');
	}
	if (literals.length === 1) {
		return v.literal(literals[0]) as Validator<T>;
	}
	const [first, ...rest] = literals;
	return v.union(v.literal(first), ...rest.map((lit) => v.literal(lit))) as Validator<T>;
}

export function createEnumValidator<T extends readonly [string, ...string[]]>(literals: T): {
	zodSchema: z.ZodEnum<T>;
	convexValidator: Validator<T[number]>;
} {
	return {
		zodSchema: z.enum(literals),
		convexValidator: literalsToConvexUnion(literals),
	};
}
