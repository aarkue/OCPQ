// This file was generated by [ts-rs](https://github.com/Aleph-Alpha/ts-rs). Do not edit this file manually.

export type ValueFilter =
  | { type: "Float"; min: number | null; max: number | null }
  | { type: "Integer"; min: number | null; max: number | null }
  | { type: "Boolean"; is_true: boolean }
  | { type: "String"; is_in: Array<string> }
  | { type: "Time"; from: string | null; to: string | null };