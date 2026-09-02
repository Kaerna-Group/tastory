export type RecipeTiming = Readonly<{
  prepMinutes?: number;
  cookMinutes?: number;
}>;

export function getTotalMinutes(timing: RecipeTiming): number | undefined {
  const values = [timing.prepMinutes, timing.cookMinutes];
  if (values.every((value) => value === undefined)) return undefined;
  for (const value of values) {
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) {
      throw new RangeError('Время должно быть целым неотрицательным числом минут.');
    }
  }
  const total = (timing.prepMinutes ?? 0) + (timing.cookMinutes ?? 0);
  if (!Number.isSafeInteger(total))
    throw new RangeError('Общее время превышает допустимое значение.');
  return total;
}
