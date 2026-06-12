// @ts-nocheck

const {HtmlValidate} = require('html-validate')

/**
 * @typedef {'html' | 'svg' | 'mathml'} Namespace
 * @typedef {import('typescript').Expression} TsExpression
 * @typedef {{text: string, start: number}} TemplateSegment
 * @typedef {{kind: string, quoted?: boolean}} Hole
 * @typedef {{tag: string, start: number, length: number}} StackEntry
 * @typedef {{ruleId: string, message: string, offset?: number, size?: number, context?: Record<string, string>}} HtmlValidateMessage
 * @typedef {{start: number, length: number, code: number, ruleId: string, message: string}} StructuralDiagnostic
 */

const STRUCTURAL_RULE_CONFIG = {
	'close-order': 'error',
	'no-implicit-close': 'error',
	'element-permitted-content': 'error',
	'prefer-tbody': 'error',
	'no-dup-attr': 'error',
	'void-content': 'error',
	'close-attr': 'error',
	'element-name': 'error',
	'element-permitted-parent': 'error',
}

const STRUCTURAL_RULE_BY_HTML_VALIDATE_RULE = {
	'no-implicit-close': 'implicitOptionalEndTag',
	'prefer-tbody': 'implicitTbody',
	'no-dup-attr': 'duplicateAttribute',
	'void-content': 'voidContent',
	'close-attr': 'closeTagAttribute',
	'element-name': 'invalidElementName',
	'element-permitted-parent': 'invalidElementParent',
}

const VALIDATOR = new HtmlValidate({
	root: true,
	extends: [],
	rules: STRUCTURAL_RULE_CONFIG,
})

/**
 * Create html-validate-backed structural diagnostics for parsed templates.
 * @param {object} context
 */
function createStructuralValidation(context) {
	const {sourceFile, constants} = context
	const {DIAGNOSTIC_CODES, STRUCTURAL_RULES} = constants

	/**
	 * Validate generated HTML and remap html-validate offsets back to source ranges.
	 * @param {TemplateSegment[]} segments
	 * @param {TsExpression[]} expressions
	 * @param {Hole[]} holes
	 * @param {StackEntry[]} stack
	 * @param {Namespace} mode
	 * @returns {StructuralDiagnostic[]}
	 */
	function getStructuralDiagnostics(segments, expressions, holes, stack, mode) {
		const {markup, offsets} = buildValidationMarkup(segments, expressions, holes, mode, sourceFile)
		const report =
			typeof VALIDATOR.validateStringSync === 'function'
				? VALIDATOR.validateStringSync(markup)
				: VALIDATOR.validateString(markup)
		if (report?.then) throw new Error('nimble-html-template-analyzer requires a synchronous html-validate API.')
		const messages = report.results.flatMap(result => result.messages || [])
		return messages
			.filter(
				message =>
					!(message.ruleId === 'element-permitted-content' && message.context?.child === '<style>') &&
					!isCaseOnlyNimbleBindingDuplicate(message, markup),
			)
			.map(message => toStructuralDiagnostic(message, offsets, stack, DIAGNOSTIC_CODES, STRUCTURAL_RULES))
			.filter(Boolean)
	}

	return {getStructuralDiagnostics}
}

/**
 * Convert template literal segments/holes to validator-safe markup plus offset map.
 *
 * Example:
 *
 *   source:
 *     html`<span title=${value} title="y"></span>`
 *
 *   scanner input:
 *     segments[0] = { text: "<span title=",        start: 100 }
 *     expressions[0] = value, starts at 113
 *     segments[1] = { text: " title=\"y\"></span>", start: 121 }
 *
 *   generated markup:
 *     <span title="nimble-hole-0" title="y"></span>
 *
 *   offset map:
 *     generated char:  <  s  p  ...  "  n  i  ...  "     t  i  ...
 *     generated index: 0  1  2  ... 12 13 14  ... 26 27 28 29 ...
 *     source offset:   100 101 102 ...112 113 113 ...113 121 122 123 ...
 *
 * html-validate reports offsets in generated markup. resolveOffset() uses this
 * array to map them back to original source offsets; synthetic placeholder text
 * maps to the expression start, and synthetic wrapper text maps to null.
 *
 * @param {TemplateSegment[]} segments
 * @param {TsExpression[]} expressions
 * @param {Hole[]} holes
 * @param {Namespace} mode
 * @param {import('typescript').SourceFile} sourceFile
 * @returns {{markup: string, offsets: Array<number | null>}}
 */
function buildValidationMarkup(segments, expressions, holes, mode, sourceFile) {
	const chunks = []
	const offsets = []
	const append = (text, sourceStart) => {
		chunks.push(text)
		for (let index = 0; index < text.length; index++) offsets.push(sourceStart + index)
	}
	const appendSynthetic = (text, sourceOffset) => {
		chunks.push(text)
		for (let index = 0; index < text.length; index++) offsets.push(sourceOffset)
	}

	if (mode === 'svg') appendSynthetic('<svg>', null)
	if (mode === 'mathml') appendSynthetic('<math>', null)
	for (let index = 0; index < segments.length; index++) {
		append(segments[index].text, segments[index].start)
		if (index < expressions.length) {
			const hole = holes[index]
			const placeholder =
				hole?.kind === 'spread'
					? `x-nimble-spread-${index}=""`
					: hole && hole.kind !== 'text' && !hole.quoted
						? `"nimble-hole-${index}"`
						: `nimble-hole-${index}`
			appendSynthetic(placeholder, expressions[index].getStart(sourceFile))
		}
	}
	if (mode === 'svg') appendSynthetic('</svg>', null)
	if (mode === 'mathml') appendSynthetic('</math>', null)

	return {markup: chunks.join(''), offsets}
}

/**
 * Ignore duplicate warnings caused only by html-validate lowercasing .?@ names.
 * @param {HtmlValidateMessage} message
 * @param {string} markup
 */
function isCaseOnlyNimbleBindingDuplicate(message, markup) {
	if (message.ruleId !== 'no-dup-attr') return false
	const name = markup.slice(message.offset || 0).match(/^[^\s=/>]+/)?.[0] || ''
	if (!/^!?(?:[.@])/.test(name)) return false
	const tagStart = markup.lastIndexOf('<', message.offset || 0)
	const priorNames = Array.from(
		markup.slice(tagStart + 1, message.offset || 0).matchAll(/(?:^|[\s/])([^\s=/>]+)/g),
		match => match[1],
	)
	return (
		!priorNames.some(priorName => priorName === name) &&
		priorNames.some(priorName => priorName.toLowerCase() === name.toLowerCase())
	)
}

/**
 * Convert one html-validate message into the analyzer diagnostic shape.
 * @param {HtmlValidateMessage} message
 * @param {Array<number | null>} offsets
 * @param {StackEntry[]} stack
 * @param {Record<string, number>} codes
 * @param {Record<string, string>} rules
 * @returns {StructuralDiagnostic | null}
 */
function toStructuralDiagnostic(message, offsets, stack, codes, rules) {
	let structuralKey = STRUCTURAL_RULE_BY_HTML_VALIDATE_RULE[message.ruleId]
	if (message.ruleId === 'close-order')
		structuralKey = message.message.startsWith('Missing close-tag') ? 'missingClosingTag' : 'mismatchedClosingTag'
	if (message.ruleId === 'element-permitted-content') {
		const child = message.context?.child || message.message.match(/^<[^>]+>/)?.[0] || ''
		structuralKey = /^<(?:tr|td|th)>$/i.test(child) ? 'invalidTableStructure' : 'invalidNesting'
	}
	const ruleId = rules[structuralKey]
	const code = codes[structuralKey]
	if (!ruleId || !code) return null

	let range = null
	const missingTag =
		message.ruleId === 'close-order' && message.message.match(/^Missing close-tag, expected '<\/([^>]+)>'/)
	if (missingTag) {
		const openTag = [...stack].reverse().find(entry => entry.tag.toLowerCase() === missingTag[1].toLowerCase())
		if (openTag) range = {start: openTag.start, length: openTag.length}
	}
	if (!range) {
		const generatedStart = message.offset || 0
		const generatedLength = Math.max(message.size || 1, 1)
		const start = resolveOffset(offsets, generatedStart, generatedLength)
		const end = resolveOffset(offsets, generatedStart + generatedLength, 0, false)
		range = {
			start,
			length: Math.max(end && end > start ? end - start : generatedLength, 1),
		}
	}

	return {
		start: range.start,
		length: range.length,
		code,
		ruleId,
		message:
			structuralKey === 'invalidNesting'
				? `${message.message}; browser parsing will change the DOM tree.`
				: message.message,
	}
}

/**
 * Map a generated-markup offset back to the nearest original source offset.
 * @param {Array<number | null>} offsets
 * @param {number} generatedStart
 * @param {number} generatedLength
 * @param {boolean} [preferForward]
 * @returns {number}
 */
function resolveOffset(offsets, generatedStart, generatedLength, preferForward = true) {
	for (let index = generatedStart; index < generatedStart + generatedLength && index < offsets.length; index++)
		if (typeof offsets[index] === 'number') return offsets[index]
	if (preferForward)
		for (let index = generatedStart + generatedLength; index < offsets.length; index++)
			if (typeof offsets[index] === 'number') return offsets[index]
	for (
		let index = Math.min(preferForward ? generatedStart : generatedStart - 1, offsets.length - 1);
		index >= 0;
		index--
	)
		if (typeof offsets[index] === 'number') return offsets[index] + 1
	return 0
}

module.exports = {createStructuralValidation}
