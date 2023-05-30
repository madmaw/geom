import { ReadonlyMat4, ReadonlyVec3 } from "gl-matrix";
import { Subtraction } from "./subtraction";
import { Line } from "./line";

export type Face = {
  readonly transform: ReadonlyMat4,
  readonly polygon: Subtraction<ConvexPolygon>,
  readonly lines: readonly Line[],
};

// the expectation is that z is always 0
export type ConvexPolygon = readonly ReadonlyVec3[];

