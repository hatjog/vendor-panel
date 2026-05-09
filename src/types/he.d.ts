declare module "he" {
  export function decode(
    text: string,
    options?: Record<string, unknown>
  ): string

  export function encode(
    text: string,
    options?: Record<string, unknown>
  ): string

  const he: {
    decode: typeof decode
    encode: typeof encode
  }

  export default he
}
