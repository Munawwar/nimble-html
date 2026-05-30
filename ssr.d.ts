export type TemplateMode = 'html' | 'svg' | 'mathml'

declare const FORCE_SYMBOL: unique symbol

export type ForceValue<T = unknown> = {
	[FORCE_SYMBOL]: T
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
export function renderToString(value: unknown): string
