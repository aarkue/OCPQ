// This file was generated by [ts-rs](https://github.com/Aleph-Alpha/ts-rs). Do not edit this file manually.
import type { BindingBox } from "./BindingBox";

export type BindingBoxTreeNode =
  | { Box: [BindingBox, Array<number>] }
  | { OR: [number, number] }
  | { AND: [number, number] }
  | { NOT: number };