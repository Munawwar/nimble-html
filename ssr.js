/**
 * A DOM-free SSR entrypoint for nimble-html templates.
 */

const FORCE_SYMBOL = Symbol('force')
const TEMPLATE_RESULT_SYMBOL = Symbol('template-result')
const UNSAFE_HTML_SYMBOL = Symbol('unsafe-html')
const UNSAFE_SVG_SYMBOL = Symbol('unsafe-svg')
const UNSAFE_MATHML_SYMBOL = Symbol('unsafe-mathml')
const RAW_TEXT_SYMBOL = Symbol('raw-text')
const INTERPOLATION_MARKER = '⧙⧘'
const INTERPOLATION_PARTS_REGEXP = new RegExp(`${INTERPOLATION_MARKER}(\\d+)${INTERPOLATION_MARKER}`)
const SPREAD_SITE_REGEXP = new RegExp(`^\\.\\.\\.${INTERPOLATION_MARKER}(\\d+)${INTERPOLATION_MARKER}$`)
const VOID_ELEMENTS = new Set([
	'area',
	'base',
	'br',
	'col',
	'embed',
	'hr',
	'img',
	'input',
	'link',
	'meta',
	'param',
	'source',
	'track',
	'wbr',
])

const ATTRIBUTE_SITE_ERROR =
	'Nested templates and DOM elements are not allowed in attributes. Use text content interpolation instead.'
const TRUSTED_TEXT_INPUT_ERROR = 'unsafeHTML(), unsafeSVG(), unsafeMathML(), and rawText() expect a string.'
const TRUSTED_TEXT_CONTEXT_ERROR =
	'unsafeHTML(), unsafeSVG(), unsafeMathML(), and rawText() are only allowed in text content interpolation.'
const RAW_TEXT_REPLACEMENTS = [
	[/<\/script(?=[\t\n\f\r />])/gi, match => `\\x3C${match.slice(1)}`],
	[/<script(?=[\t\n\f\r />])/gi, match => `\\x3C${match.slice(1)}`],
	[/<!--/g, '\\x3C!--'],
	[/<\/style(?=[\t\n\f\r />])/gi, match => `\\x3C${match.slice(1)}`],
	[/<style(?=[\t\n\f\r />])/gi, match => `\\x3C${match.slice(1)}`],
	[/<\/textarea(?=[\t\n\f\r />])/gi, match => `\\x3C${match.slice(1)}`],
	[/<\/title(?=[\t\n\f\r />])/gi, match => `\\x3C${match.slice(1)}`],
	[/<\/template(?=[\t\n\f\r />])/gi, match => `\\x3C${match.slice(1)}`],
]

/** @typedef {'html' | 'svg' | 'mathml'} TemplateMode */
/** @typedef {unknown} InterpolationValue */
/**
 * @typedef {{
 *   [TEMPLATE_RESULT_SYMBOL]: true,
 *   mode: TemplateMode,
 *   strings: TemplateStringsArray,
 *   values: readonly InterpolationValue[],
 * }} TemplateResult
 */
/**
 * @typedef {((key?: any, liveNodes?: unknown[]) => TemplateResult) & {
 *   template?: { mode: TemplateMode, strings: TemplateStringsArray }
 * }} TemplateView
 */
/**
 * @typedef {{
 *   type: 'attribute' | 'boolean-attribute' | 'property' | 'event',
 *   name: string,
 *   value: unknown,
 * }} Binding
 */
/**
 * @typedef {{
 *   [UNSAFE_HTML_SYMBOL]?: string,
 *   [UNSAFE_SVG_SYMBOL]?: string,
 *   [UNSAFE_MATHML_SYMBOL]?: string,
 *   [RAW_TEXT_SYMBOL]?: string,
 * }} TrustedTextValue
 */

/**
 * @param {TemplateStringsArray} strings
 * @param {...InterpolationValue} values
 * @returns {TemplateView}
 */
export function html(strings, ...values) {
	return handleTemplateTag('html', strings, ...values)
}

/**
 * @param {TemplateStringsArray} strings
 * @param {...InterpolationValue} values
 * @returns {TemplateView}
 */
export function svg(strings, ...values) {
	return handleTemplateTag('svg', strings, ...values)
}

/**
 * @param {TemplateStringsArray} strings
 * @param {...InterpolationValue} values
 * @returns {TemplateView}
 */
export function mathml(strings, ...values) {
	return handleTemplateTag('mathml', strings, ...values)
}

/** @param {InterpolationValue} value */
export function force(value) {
	return {[FORCE_SYMBOL]: value}
}

/**
 * @param {symbol} symbol
 * @param {string} value
 */
function wrapTrustedTextValue(symbol, value) {
	if (typeof value !== 'string') throw new TypeError(TRUSTED_TEXT_INPUT_ERROR)
	return {[symbol]: value}
}

/** @param {string} value */
export function unsafeHTML(value) {
	return wrapTrustedTextValue(UNSAFE_HTML_SYMBOL, value)
}

/** @param {string} value */
export function unsafeSVG(value) {
	return wrapTrustedTextValue(UNSAFE_SVG_SYMBOL, value)
}

/** @param {string} value */
export function unsafeMathML(value) {
	return wrapTrustedTextValue(UNSAFE_MATHML_SYMBOL, value)
}

/** @param {string} value */
export function rawText(value) {
	return wrapTrustedTextValue(RAW_TEXT_SYMBOL, value)
}

/**
 * @param {InterpolationValue | TemplateView | TemplateResult | readonly InterpolationValue[]} value
 * @returns {string}
 */
export function renderToString(value) {
	return serializeChildValue(value)
}

/**
 * @param {InterpolationValue} value
 * @returns {InterpolationValue}
 */
function unwrapForce(value) {
	return typeof value === 'object' && value !== null && FORCE_SYMBOL in value ? value[FORCE_SYMBOL] : value
}

/**
 * @param {TemplateMode} mode
 * @param {TemplateStringsArray} strings
 * @param {...InterpolationValue} values
 * @returns {TemplateView}
 */
function handleTemplateTag(mode, strings, ...values) {
	/** @type {TemplateView} */
	const render = function () {
		return {[TEMPLATE_RESULT_SYMBOL]: true, mode, strings, values}
	}

	render.template = {mode, strings}
	return render
}

/**
 * @param {InterpolationValue | TemplateView | TemplateResult | readonly InterpolationValue[]} value
 * @returns {string}
 */
function serializeChildValue(value) {
	value = unwrapForce(value)

	if (value == null || value === '') return ''
	if (Array.isArray(value)) return value.map(serializeChildValue).join('')
	if (typeof value === 'function') return serializeChildValue(value())
	if (looksTrustedTextValue(value)) return serializeTrustedTextValue(value)
	if (looksTemplateValue(value)) return serializeTemplateWithValues(/** @type {TemplateResult} */ (value), value.values)
	if (looksLikeNode(value)) throw new Error('DOM nodes are not supported by nimble-html/ssr')

	return escapeHtml(String(value))
}

/**
 * @param {TemplateResult} result
 * @param {readonly InterpolationValue[]} values
 * @returns {string}
 */
function serializeTemplateWithValues(result, values) {
	const source = result.strings.reduce(
		/**
		 * @param {string} htmlString
		 * @param {string} string
		 * @param {number} index
		 */
		(htmlString, string, index) =>
			htmlString +
			string +
			(index < result.values.length ? `${INTERPOLATION_MARKER}${index}${INTERPOLATION_MARKER}` : ''),
		'',
	)

	let output = ''
	let cursor = 0
	let depth = 0

	while (cursor < source.length) {
		if (source.startsWith('<!--', cursor)) {
			const commentEnd = source.indexOf('-->', cursor + 4)
			const end = commentEnd === -1 ? source.length : commentEnd + 3
			output += source.slice(cursor, end)
			cursor = end
			continue
		}
		if (source.startsWith('<![CDATA[', cursor)) {
			const cdataEnd = source.indexOf(']]>', cursor + 9)
			const end = cdataEnd === -1 ? source.length : cdataEnd + 3
			output += source.slice(cursor, end)
			cursor = end
			continue
		}

		if (source[cursor] === '<') {
			const tag = readTag(source, cursor, values)
			output += tag.output
			cursor = tag.end
			depth += tag.depthDelta
			continue
		}

		const nextTag = source.indexOf('<', cursor)
		const end = nextTag === -1 ? source.length : nextTag
		output += serializeTextFragment(source.slice(cursor, end), values, depth === 0)
		cursor = end
	}

	return output
}

/**
 * @param {string} source
 * @param {number} start
 * @param {readonly InterpolationValue[]} values
 */
function readTag(source, start, values) {
	if (source.startsWith('</', start)) {
		const end = source.indexOf('>', start + 2)
		const safeEnd = end === -1 ? source.length : end + 1
		return {output: source.slice(start, safeEnd), end: safeEnd, depthDelta: -1}
	}

	if (source[start + 1] === '!' || source[start + 1] === '?') {
		const end = source.indexOf('>', start + 2)
		const safeEnd = end === -1 ? source.length : end + 1
		return {output: source.slice(start, safeEnd), end: safeEnd, depthDelta: 0}
	}

	let cursor = start + 1
	let quote = ''

	while (cursor < source.length) {
		const char = source[cursor]

		if (quote) {
			if (char === quote) quote = ''
		} else if (char === '"' || char === "'") quote = char
		else if (char === '>') break

		cursor++
	}

	const end = Math.min(cursor + 1, source.length)
	const raw = source.slice(start, end)
	const output = serializeStartTag(raw, values)
	const tagNameMatch = raw.match(/^<\s*([^\s/>]+)/)
	const tagName = tagNameMatch?.[1]?.toLowerCase() || ''
	const isSelfClosing = /\/\s*>$/.test(raw) || VOID_ELEMENTS.has(tagName)

	return {output, end, depthDelta: isSelfClosing ? 0 : 1}
}

/**
 * @param {string} raw
 * @param {readonly InterpolationValue[]} values
 * @returns {string}
 */
function serializeStartTag(raw, values) {
	let cursor = 1
	let tagName = ''

	while (cursor < raw.length && !/[\s/>]/.test(raw[cursor])) tagName += raw[cursor++]

	/** @type {Map<string, Binding>} */
	const bindings = new Map()
	let isSelfClosing = false

	while (cursor < raw.length - 1) {
		while (cursor < raw.length - 1 && /\s/.test(raw[cursor])) cursor++
		if (cursor >= raw.length - 1) break

		if (raw[cursor] === '/') {
			isSelfClosing = true
			cursor++
			continue
		}

		const nameStart = cursor
		while (cursor < raw.length - 1 && !/[\s=/>]/.test(raw[cursor])) cursor++
		const name = raw.slice(nameStart, cursor)

		while (cursor < raw.length - 1 && /\s/.test(raw[cursor])) cursor++

		let value = null

		if (raw[cursor] === '=') {
			cursor++
			while (cursor < raw.length - 1 && /\s/.test(raw[cursor])) cursor++

			if (raw[cursor] === '"' || raw[cursor] === "'") {
				const quote = raw[cursor++]
				const valueStart = cursor
				while (cursor < raw.length - 1 && raw[cursor] !== quote) cursor++
				value = raw.slice(valueStart, cursor)
				cursor++
			} else {
				const valueStart = cursor
				while (cursor < raw.length - 1 && !/[\s/>]/.test(raw[cursor])) cursor++
				value = raw.slice(valueStart, cursor)
			}
		}

		applyAttributeBinding(bindings, name, value, values)
	}

	let output = `<${tagName}`

	for (const binding of bindings.values()) {
		if (binding.type === 'attribute') output += ` ${binding.name}="${binding.value}"`
		else if (binding.type === 'boolean-attribute' && binding.value) output += ` ${binding.name}=""`
	}

	return output + (isSelfClosing ? '/>' : '>')
}

/**
 * @param {Map<string, Binding>} bindings
 * @param {string} name
 * @param {string | null} rawValue
 * @param {readonly InterpolationValue[]} values
 */
function applyAttributeBinding(bindings, name, rawValue, values) {
	const spreadMatch = name.match(SPREAD_SITE_REGEXP)
	if (spreadMatch) {
		applySpreadBindings(bindings, values[Number(spreadMatch[1])])
		return
	}

	if (name.startsWith('?') || name.startsWith('!?')) {
		const attributeName = name.slice(name[1] === '?' ? 2 : 1)
		let value = false
		if (rawValue != null) {
			const parts = parseInterpolationParts(rawValue)
			if (parts.length === 3 && parts[0] === '' && parts[2] === '' && typeof parts[1] === 'number')
				value = !!unwrapForce(values[parts[1]])
			else if (parts.length === 1 && typeof parts[0] === 'string') value = parts[0].trim() !== ''
			else value = true
		}
		bindings.set(`?${attributeName}`, {
			type: 'boolean-attribute',
			name: attributeName,
			value,
		})
		return
	}

	if (name.startsWith('.') || name.startsWith('!.') || name.startsWith('@') || name.startsWith('!@')) {
		const prefixLength = name[0] === '!' ? 2 : 1
		const type = name[prefixLength - 1] === '.' ? 'property' : 'event'
		bindings.set(name, {type, name: name.slice(prefixLength), value: null})
		return
	}

	const attributeName = name.startsWith('!') ? name.slice(1) : name
	bindings.set(attributeName, {
		type: 'attribute',
		name: attributeName,
		value: rawValue == null ? '' : resolveAttributeValue(rawValue, values),
	})
}

/**
 * @param {Map<string, Binding>} bindings
 * @param {InterpolationValue} spreadValue
 */
function applySpreadBindings(bindings, spreadValue) {
	spreadValue = unwrapForce(spreadValue)

	if (
		spreadValue == null ||
		spreadValue === false ||
		typeof spreadValue !== 'object' ||
		Array.isArray(spreadValue) ||
		looksLikeNode(spreadValue)
	)
		return

	for (const [name, value] of Object.entries(spreadValue)) {
		if (name.startsWith('?')) {
			bindings.set(name, {type: 'boolean-attribute', name: name.slice(1), value: !!unwrapForce(value)})
			continue
		}

		if (name.startsWith('.') || name.startsWith('@')) continue

		bindings.set(name, {
			type: 'attribute',
			name,
			value: escapeHtml(resolveAttributeInput(value), true),
		})
	}
}

/**
 * @param {string} rawValue
 * @param {readonly InterpolationValue[]} values
 * @returns {string}
 */
function resolveAttributeValue(rawValue, values) {
	let value = ''

	for (const part of parseInterpolationParts(rawValue)) {
		if (typeof part === 'number') value += escapeHtml(resolveAttributeInput(values[part]), true)
		else value += part.replaceAll('"', '&quot;')
	}

	return value
}

/**
 * @param {InterpolationValue} value
 * @returns {string}
 */
function resolveAttributeInput(value) {
	value = unwrapForce(value)

	if (value == null) return ''
	if (looksTrustedTextValue(value)) throw new Error(TRUSTED_TEXT_CONTEXT_ERROR)
	if (typeof value === 'function' || Array.isArray(value) || looksTemplateValue(value) || looksLikeNode(value))
		throw new Error(ATTRIBUTE_SITE_ERROR)

	return String(value)
}

/**
 * @param {string} fragment
 * @param {readonly InterpolationValue[]} values
 * @param {boolean} isTopLevel
 * @returns {string}
 */
function serializeTextFragment(fragment, values, isTopLevel) {
	const parts = parseInterpolationParts(fragment)
	const filteredParts = isTopLevel
		? parts.filter(part => typeof part === 'number' || (typeof part === 'string' && part.trim() !== ''))
		: parts
	let output = ''

	for (const part of filteredParts) {
		if (typeof part === 'number') output += serializeChildValue(values[part])
		else output += part
	}

	return output
}

/**
 * @param {string} value
 * @returns {(string | number)[]}
 */
function parseInterpolationParts(value) {
	return value.split(INTERPOLATION_PARTS_REGEXP).map((part, index) => (index % 2 === 1 ? Number(part) : part))
}

/**
 * @param {string} value
 * @param {boolean} [attribute]
 * @returns {string}
 */
function escapeHtml(value, attribute = false) {
	value = value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
	return attribute ? value.replaceAll('"', '&quot;') : value
}

/** @param {InterpolationValue} value */
function looksTemplateValue(value) {
	return typeof value === 'object' && value !== null && TEMPLATE_RESULT_SYMBOL in value
}

/** @param {InterpolationValue} value */
function looksLikeNode(value) {
	return typeof value === 'object' && value !== null && 'nodeType' in value
}

/**
 * @param {InterpolationValue} value
 * @returns {value is TrustedTextValue}
 */
function looksTrustedTextValue(value) {
	return (
		typeof value === 'object' &&
		value !== null &&
		(UNSAFE_HTML_SYMBOL in value ||
			UNSAFE_SVG_SYMBOL in value ||
			UNSAFE_MATHML_SYMBOL in value ||
			RAW_TEXT_SYMBOL in value)
	)
}

/**
 * @param {TrustedTextValue} value
 * @returns {string}
 */
function serializeTrustedTextValue(value) {
	if (UNSAFE_HTML_SYMBOL in value || UNSAFE_SVG_SYMBOL in value || UNSAFE_MATHML_SYMBOL in value)
		return value[UNSAFE_HTML_SYMBOL] || value[UNSAFE_SVG_SYMBOL] || value[UNSAFE_MATHML_SYMBOL] || ''
	if (!(RAW_TEXT_SYMBOL in value)) return ''
	let text = value[RAW_TEXT_SYMBOL] || ''
	for (const [pattern, replacement] of RAW_TEXT_REPLACEMENTS) text = text.replace(pattern, replacement)
	return text
}
