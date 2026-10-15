/* lib/cx.ts — CSS klass nomlarini birlashtirish: cx("a", ok && "b") → "a b" (bo'sh/false tashlanadi). */
export const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(" ");
