export type TemplateNodes = readonly (Element | Text)[]
export type WeakMapKey = symbol | object | Function
export type TemplateKey = WeakMapKey
export type TemplateMode = 'html' | 'svg' | 'mathml'

declare const FORCE_SYMBOL: unique symbol

export type ForceValue<T = unknown> = {
	[FORCE_SYMBOL]: T
}

export type TemplateView = ((key?: any, liveNodes?: Node[]) => TemplateNodes) & {
	template?: object
}

export type PrimitiveChild = string | number | boolean | bigint | null | undefined
export type AttributeValue = string | number | boolean | bigint | null | undefined
export type ChildValue = PrimitiveChild | Node | TemplateView | readonly ChildValue[]
export type EventValue<E extends Event = Event> = ((event: E) => unknown) | string | null | undefined | false | ''

type TemplateNamespace = 'html' | 'svg' | 'mathml'
type Whitespace = ' ' | '\n' | '\t' | '\r'
type ParserMode = 'text' | 'tagName' | 'beforeAttr' | 'attrName' | 'afterAttrName' | 'beforeAttrValue' | 'attrValue'
type Quote = '' | '"' | "'"
type AnyFunction = (...args: any[]) => unknown
type HoleValue<T> = T | ForceValue<T>
type ChildHoleValue = HoleValue<ChildValue>
type BooleanHoleValue = HoleValue<boolean>

type TemplateState = {
	mode: ParserMode
	currentTag: string
	currentAttr: string
	quote: Quote
}

type InitialState = {
	mode: 'text'
	currentTag: ''
	currentAttr: ''
	quote: ''
}

type ReplaceState<State extends TemplateState, Next extends Partial<TemplateState>> = Omit<State, keyof Next> & Next
type IsWhitespace<Char extends string> = Char extends Whitespace ? true : false
type ScanText<Char extends string, State extends TemplateState> = Char extends '<'
	? ReplaceState<State, {mode: 'tagName'; currentTag: ''; currentAttr: ''; quote: ''}>
	: State
type ScanTagName<Char extends string, State extends TemplateState> = Char extends '>'
	? ReplaceState<State, {mode: 'text'; currentTag: ''; currentAttr: ''; quote: ''}>
	: Char extends '/'
		? State
		: IsWhitespace<Char> extends true
			? State['currentTag'] extends ''
				? State
				: ReplaceState<State, {mode: 'beforeAttr'}>
			: ReplaceState<State, {currentTag: `${State['currentTag']}${Lowercase<Char>}`}>
type ScanBeforeAttr<Char extends string, State extends TemplateState> = Char extends '>'
	? ReplaceState<State, {mode: 'text'; currentTag: ''; currentAttr: ''; quote: ''}>
	: Char extends '/'
		? State
		: IsWhitespace<Char> extends true
			? State
			: ReplaceState<State, {mode: 'attrName'; currentAttr: Char}>
type ScanAttrName<Char extends string, State extends TemplateState> = Char extends '='
	? ReplaceState<State, {mode: 'beforeAttrValue'}>
	: Char extends '>'
		? ReplaceState<State, {mode: 'text'; currentTag: ''; currentAttr: ''; quote: ''}>
		: Char extends '/'
			? ReplaceState<State, {mode: 'beforeAttr'; currentAttr: ''}>
			: IsWhitespace<Char> extends true
				? ReplaceState<State, {mode: 'afterAttrName'}>
				: ReplaceState<State, {currentAttr: `${State['currentAttr']}${Char}`}>
type ScanAfterAttrName<Char extends string, State extends TemplateState> = Char extends '='
	? ReplaceState<State, {mode: 'beforeAttrValue'}>
	: Char extends '>'
		? ReplaceState<State, {mode: 'text'; currentTag: ''; currentAttr: ''; quote: ''}>
		: Char extends '/'
			? ReplaceState<State, {mode: 'beforeAttr'; currentAttr: ''}>
			: IsWhitespace<Char> extends true
				? State
				: ReplaceState<State, {mode: 'attrName'; currentAttr: Char}>
type ScanBeforeAttrValue<Char extends string, State extends TemplateState> =
	IsWhitespace<Char> extends true
		? State
		: Char extends '"'
			? ReplaceState<State, {mode: 'attrValue'; quote: '"'}>
			: Char extends "'"
				? ReplaceState<State, {mode: 'attrValue'; quote: "'"}>
				: Char extends '>'
					? ReplaceState<State, {mode: 'text'; currentTag: ''; currentAttr: ''; quote: ''}>
					: ReplaceState<State, {mode: 'attrValue'; quote: ''}>
type ScanAttrValue<Char extends string, State extends TemplateState> = State['quote'] extends ''
	? Char extends '>'
		? ReplaceState<State, {mode: 'text'; currentTag: ''; currentAttr: ''; quote: ''}>
		: IsWhitespace<Char> extends true
			? ReplaceState<State, {mode: 'beforeAttr'; currentAttr: ''; quote: ''}>
			: State
	: Char extends State['quote']
		? ReplaceState<State, {mode: 'beforeAttr'; currentAttr: ''; quote: ''}>
		: State
type ScanChar<Char extends string, State extends TemplateState> = State['mode'] extends 'text'
	? ScanText<Char, State>
	: State['mode'] extends 'tagName'
		? ScanTagName<Char, State>
		: State['mode'] extends 'beforeAttr'
			? ScanBeforeAttr<Char, State>
			: State['mode'] extends 'attrName'
				? ScanAttrName<Char, State>
				: State['mode'] extends 'afterAttrName'
					? ScanAfterAttrName<Char, State>
					: State['mode'] extends 'beforeAttrValue'
						? ScanBeforeAttrValue<Char, State>
						: ScanAttrValue<Char, State>
type ScanSegment<Segment extends string, State extends TemplateState> = Segment extends `${infer Char}${infer Rest}`
	? ScanSegment<Rest, ScanChar<Char, State>>
	: State

type ChildContext = {kind: 'child'}
type AttrContext<Tag extends string, Attr extends string> = {kind: 'attr'; tag: Tag; attr: Attr}
type HoleContext = ChildContext | AttrContext<string, string>
type ContextFromState<State extends TemplateState> = State['mode'] extends 'beforeAttrValue' | 'attrValue'
	? AttrContext<State['currentTag'], State['currentAttr']>
	: ChildContext
type AdvanceAfterInterpolation<State extends TemplateState> = State['mode'] extends 'beforeAttrValue'
	? ReplaceState<State, {mode: 'beforeAttr'; currentAttr: ''; quote: ''}>
	: State
type InterpolationContexts<
	Strings extends readonly string[],
	State extends TemplateState = InitialState,
	Out extends readonly HoleContext[] = readonly [],
> = Strings extends readonly [infer Current extends string, infer Next extends string, ...infer Rest extends string[]]
	? ScanSegment<Current, State> extends infer Scanned extends TemplateState
		? ContextFromState<Scanned> extends infer Context extends HoleContext
			? InterpolationContexts<readonly [Next, ...Rest], AdvanceAfterInterpolation<Scanned>, readonly [...Out, Context]>
			: Out
		: Out
	: Strings extends readonly [string]
		? Out
		: readonly HoleContext[]

type MatchTag<Tag extends string, Map> = Lowercase<Tag> extends keyof Map ? Map[Lowercase<Tag> & keyof Map] : never
type ElementForNamespaceTag<Namespace extends TemplateNamespace, Tag extends string> = Namespace extends 'html'
	? MatchTag<Tag, HTMLElementTagNameMap> extends infer ElementType
		? [ElementType] extends [never]
			? Element
			: ElementType
		: Element
	: Namespace extends 'svg'
		? MatchTag<Tag, SVGElementTagNameMap> extends infer ElementType
			? [ElementType] extends [never]
				? SVGElement
				: ElementType
			: SVGElement
		: MatchTag<Tag, MathMLElementTagNameMap> extends infer ElementType
			? [ElementType] extends [never]
				? MathMLElement
				: ElementType
			: MathMLElement

type ElementForTag<Tag extends string> = ElementForNamespaceTag<'html', Tag>

export type PropertyValue<Tag extends string, Prop extends string> = Prop extends keyof ElementForTag<Tag>
	? ElementForTag<Tag>[Prop]
	: unknown

type NonFunctionPropertyNames<T> = {
	[K in keyof T]-?: T[K] extends AnyFunction ? never : K
}[keyof T]
type PrimitiveAttributeProps = {
	[K in `aria-${string}`]?: AttributeValue
} & {
	[K in `data-${string}`]?: AttributeValue
}
type ElementAttributeProps<ElementType extends Element> = PrimitiveAttributeProps & {
	[K in Extract<NonFunctionPropertyNames<ElementType>, string>]?: ElementType[K]
}
type ExactProp<Props, Name extends string> = Name extends keyof Props ? Props[Name] : never
type CaseInsensitiveProp<Props, Name extends string> = {
	[K in Extract<keyof Props, string>]: Lowercase<K> extends Lowercase<Name> ? Props[K] : never
}[Extract<keyof Props, string>]
type LookupProp<Props, Name extends string, Fallback> = [ExactProp<Props, Name>] extends [never]
	? [CaseInsensitiveProp<Props, Name>] extends [never]
		? Fallback
		: CaseInsensitiveProp<Props, Name>
	: ExactProp<Props, Name>
type StripForcePrefix<Name extends string> = Name extends `!${infer Rest}` ? Rest : Name
type AttrNameKind<Name extends string> =
	StripForcePrefix<Name> extends `.${string}`
		? 'property'
		: StripForcePrefix<Name> extends `?${string}`
			? 'boolean-attribute'
			: StripForcePrefix<Name> extends `@${string}`
				? 'event'
				: 'attribute'
type CleanAttrName<Name extends string> =
	StripForcePrefix<Name> extends `${'.' | '?' | '@'}${infer Rest}` ? Rest : StripForcePrefix<Name>
type AttributeValueForTag<Namespace extends TemplateNamespace, Tag extends string, Attr extends string> = LookupProp<
	ElementAttributeProps<ElementForNamespaceTag<Namespace, Tag>>,
	Attr,
	AttributeValue
>
type EventTypeForName<Name extends string> =
	Lowercase<Name> extends keyof GlobalEventHandlersEventMap
		? GlobalEventHandlersEventMap[Lowercase<Name> & keyof GlobalEventHandlersEventMap]
		: Event
type HoleValueForContext<Namespace extends TemplateNamespace, Context extends HoleContext> =
	Context extends AttrContext<infer Tag extends string, infer Attr extends string>
		? AttrNameKind<Attr> extends 'property'
			? HoleValue<PropertyValue<Tag, CleanAttrName<Attr>>>
			: AttrNameKind<Attr> extends 'boolean-attribute'
				? BooleanHoleValue
				: AttrNameKind<Attr> extends 'event'
					? HoleValue<EventValue<EventTypeForName<CleanAttrName<Attr>>>>
					: HoleValue<AttributeValueForTag<Namespace, Tag, CleanAttrName<Attr>>>
		: ChildHoleValue
type ValidateInterpolationValues<
	Contexts extends readonly HoleContext[],
	Values extends readonly unknown[],
	Namespace extends TemplateNamespace,
	Out extends readonly unknown[] = readonly [],
> = Contexts extends readonly [infer Context extends HoleContext, ...infer RestContexts extends HoleContext[]]
	? Values extends readonly [infer Value, ...infer RestValues]
		? Value extends HoleValueForContext<Namespace, Context>
			? ValidateInterpolationValues<RestContexts, RestValues, Namespace, readonly [...Out, Value]>
			: never
		: never
	: Values extends readonly []
		? Out
		: Contexts extends readonly []
			? never
			: Values
type TemplateTag<Namespace extends TemplateNamespace> = <
	const Strings extends readonly string[],
	const Values extends readonly unknown[],
>(
	strings: TemplateStringsArray & Strings,
	...values: ValidateInterpolationValues<InterpolationContexts<Strings>, Values, Namespace>
) => TemplateView

/**
 * A nimble `html` template tag function for declarative DOM creation and updates.
 */
export const html: TemplateTag<'html'>

/**
 * A nimble `svg` template tag function for declarative SVG DOM creation and updates.
 */
export const svg: TemplateTag<'svg'>

/**
 * A nimble `mathml` template tag function for declarative MathML DOM creation and updates.
 */
export const mathml: TemplateTag<'mathml'>

/**
 * Wrap a value in `force()` to indicate that it should not be checked for changes when applying updates.
 */
export function force<T>(value: T): ForceValue<T>

export type InterpolationValue = unknown
export type InterpolationSite = {
	node: Element | Text
	type: 'text' | 'attribute' | 'event' | 'boolean-attribute' | 'property'
	attributeName?: string
	parts?: Array<string | number>
	interpolationIndex?: number
	insertedNodes?: (Element | Text)[]
	lastValue?: unknown
	internalHandler?: EventListener
	currentEventListener?: EventListener
	skipEqualityCheck?: boolean
	requiresUnwrapping?: boolean
}
