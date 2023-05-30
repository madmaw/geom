import { Plane } from "./plane";
import { Subtraction } from "./subtraction";

export type Shape = Subtraction<readonly Plane[]>;