// @ts-nocheck

const {createDiscoveryAndScan} = require('./discovery-and-scan.js')
const {createDiagnostics} = require('./diagnostics.js')
const {createTypesAndExpressions} = require('./types-and-expressions.js')

const DIAGNOSTIC_CODES = {
	attributeValue: 91001,
	booleanAttributeValue: 91002,
	propertyValue: 91003,
	eventValue: 91004,
	eventParameter: 91005,
	spreadValue: 91006,
	spreadEntryValue: 91007,
	missingClosingTag: 92001,
	mismatchedClosingTag: 92002,
	implicitOptionalEndTag: 92003,
	invalidNesting: 92004,
	implicitTbody: 92005,
	invalidTableStructure: 92006,
}
const STRUCTURAL_RULES = {
	missingClosingTag: 'nimble-html/missing-closing-tag',
	mismatchedClosingTag: 'nimble-html/mismatched-closing-tag',
	implicitOptionalEndTag: 'nimble-html/implicit-optional-end-tag',
	invalidNesting: 'nimble-html/invalid-nesting',
	implicitTbody: 'nimble-html/implicit-tbody',
	invalidTableStructure: 'nimble-html/invalid-table-structure',
}

const VOID_HTML_TAGS = new Set([
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
const RAW_TEXT_TAGS = new Set(['script', 'style', 'textarea', 'title', 'template'])
const PHRASING_ONLY_TAGS = new Set([
	'a',
	'abbr',
	'b',
	'bdi',
	'bdo',
	'cite',
	'code',
	'data',
	'dfn',
	'em',
	'i',
	'kbd',
	'label',
	'mark',
	'q',
	'rp',
	'rt',
	'ruby',
	's',
	'samp',
	'small',
	'span',
	'strong',
	'sub',
	'sup',
	'time',
	'u',
	'var',
])
const NON_PHRASING_CHILD_TAGS = new Set([
	'address',
	'article',
	'aside',
	'blockquote',
	'details',
	'div',
	'dl',
	'fieldset',
	'figcaption',
	'figure',
	'footer',
	'form',
	'h1',
	'h2',
	'h3',
	'h4',
	'h5',
	'h6',
	'header',
	'hgroup',
	'hr',
	'main',
	'menu',
	'nav',
	'ol',
	'p',
	'pre',
	'search',
	'section',
	'table',
	'ul',
])
const OPTIONAL_END_TAG_OPEN_RULES = new Map([
	['li', new Set(['li'])],
	['tr', new Set(['tr'])],
	['td', new Set(['td', 'th'])],
	['th', new Set(['td', 'th'])],
	['p', NON_PHRASING_CHILD_TAGS],
])
const NIMBLE_TAG_MODES = new Set(['html', 'svg', 'mathml'])
const DEFAULT_ATTRIBUTE_COMPLETIONS = ['class', 'id', 'title', 'style', 'slot', 'part', 'role', 'tabindex']
const DEFAULT_BOOLEAN_COMPLETIONS = ['hidden']
const DEFAULT_EVENT_COMPLETIONS = ['click', 'input', 'change', 'submit', 'keydown', 'keyup']

const analyzerCache = new WeakMap()

function createAnalyzer(ts, program, sourceFile) {
	const context = {
		ts,
		checker: program.getTypeChecker(),
		sourceFile,
		caches: {
			tagMapTypes: new Map(),
			globalTypes: new Map(),
			completionSets: new Map(),
			templateEntries: new WeakMap(),
		},
		cachedDiagnostics: null,
		cachedTemplateEntries: null,
		cachedTemplateRanges: null,
		constants: {
			DIAGNOSTIC_CODES,
			STRUCTURAL_RULES,
			VOID_HTML_TAGS,
			RAW_TEXT_TAGS,
			PHRASING_ONLY_TAGS,
			NON_PHRASING_CHILD_TAGS,
			OPTIONAL_END_TAG_OPEN_RULES,
			NIMBLE_TAG_MODES,
			DEFAULT_ATTRIBUTE_COMPLETIONS,
			DEFAULT_BOOLEAN_COMPLETIONS,
			DEFAULT_EVENT_COMPLETIONS,
		},
	}
	context.types = createTypesAndExpressions(context)
	context.discovery = createDiscoveryAndScan(context)
	return createDiagnostics(context)
}

function getAnalyzer(ts, program, sourceFile) {
	const cached = analyzerCache.get(sourceFile)
	if (cached?.program === program && cached.ts === ts) return cached.analyzer
	const analyzer = createAnalyzer(ts, program, sourceFile)
	analyzerCache.set(sourceFile, {program, ts, analyzer})
	return analyzer
}

function analyzeSourceFile(ts, program, sourceFile) {
	return getAnalyzer(ts, program, sourceFile).buildDiagnostics()
}

function getCompletionsAtPosition(ts, program, sourceFile, position) {
	return getAnalyzer(ts, program, sourceFile).getTemplateCompletions(position)
}

module.exports = {
	DIAGNOSTIC_CODES,
	analyzeSourceFile,
	getCompletionsAtPosition,
}
