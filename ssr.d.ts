export type TemplateMode = 'html' | 'svg' | 'mathml'

declare const FORCE_SYMBOL: unique symbol
declare const UNSAFE_HTML_SYMBOL: unique symbol
declare const UNSAFE_SVG_SYMBOL: unique symbol
declare const UNSAFE_MATHML_SYMBOL: unique symbol
declare const RAW_TEXT_SYMBOL: unique symbol

export type ForceValue<T = unknown> = {
	[FORCE_SYMBOL]: T
}

export type UnsafeHTMLValue = {
	[UNSAFE_HTML_SYMBOL]: string
}

export type UnsafeSVGValue = {
	[UNSAFE_SVG_SYMBOL]: string
}

export type UnsafeMathMLValue = {
	[UNSAFE_MATHML_SYMBOL]: string
}

export type RawTextValue = {
	[RAW_TEXT_SYMBOL]: string
}

export type SsrTemplateResult = {
	mode: TemplateMode
	strings: TemplateStringsArray
	values: readonly unknown[]
}

export type SsrTemplateView = ((key?: any, liveNodes?: unknown[]) => SsrTemplateResult) & {
	template?: {mode: TemplateMode; strings: TemplateStringsArray}
}

export function html(strings: TemplateStringsArray, ...values: readonly unknown[]): SsrTemplateView
export function svg(strings: TemplateStringsArray, ...values: readonly unknown[]): SsrTemplateView
export function mathml(strings: TemplateStringsArray, ...values: readonly unknown[]): SsrTemplateView
export function force<T>(value: T): ForceValue<T>
export function unsafeHTML(value: string): UnsafeHTMLValue
export function unsafeSVG(value: string): UnsafeSVGValue
export function unsafeMathML(value: string): UnsafeMathMLValue
export function rawText(value: string): RawTextValue
export function clearTemplateCache(): void
export function renderToString(value: unknown): string
