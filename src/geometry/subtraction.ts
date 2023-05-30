export type Subtraction<T> = {
  readonly value: T,
  readonly subtractions: readonly Subtraction<T>[],
};
