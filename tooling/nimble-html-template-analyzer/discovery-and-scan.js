// @ts-nocheck

/**
 * @typedef {'html' | 'svg' | 'mathml'} Namespace
 * @typedef {import('typescript').Expression} TsExpression
 * @typedef {import('typescript').TaggedTemplateExpression} TaggedTemplateExpression
 * @typedef {{text: string, start: number}} TemplateSegment
 * @typedef {{tag: string, namespace: Namespace, start: number, length: number}} StackEntry
 * @typedef {{index: number, tagName: string, namespace: Namespace}} BaseHole
 * @typedef {BaseHole & {kind: 'spread', prefix: '...'}} SpreadHole
 * @typedef {BaseHole & {kind: 'attribute' | 'property' | 'boolean-attribute' | 'event', rawName: string, name: string, forced: boolean, quoted: boolean}} BindingHole
 * @typedef {BaseHole & {kind: 'text'}} TextHole
 * @typedef {SpreadHole | BindingHole | TextHole} Hole
 * @typedef {{mode: string, quote: string, currentTag: string, currentTagNamespace: Namespace, currentAttr: string, pendingSpread: boolean, closingTag: string, selfClosing: boolean, rawTextTag: string}} ScannerState
 * @typedef {{holes: Hole[], state: ScannerState, stack: StackEntry[]}} ScanResult
 * @typedef {{node: TaggedTemplateExpression, mode: Namespace, segments: TemplateSegment[], holes: Hole[], state: ScannerState, stack: StackEntry[], diagnostics: import('./structural-validation.js').StructuralDiagnostic[], expressions: TsExpression[]}} TemplateEntry
 */

/**
 * Determine the child namespace after opening an HTML/SVG/MathML tag.
 * @param {Namespace} parentNamespace
 * @param {string} tagName
 * @returns {Namespace}
 */
function resolveNamespace(parentNamespace, tagName) {
	if (parentNamespace === 'html' && tagName.toLowerCase() === 'svg') return 'svg'
	if (parentNamespace === 'html' && tagName.toLowerCase() === 'math') return 'mathml'
	if (parentNamespace === 'svg' && tagName === 'foreignObject') return 'html'
	return parentNamespace
}

/**
 * Create helpers that discover nimble tagged templates and scan template text.
 * @param {object} context
 */
function createDiscoveryAndScan(context) {
	const {ts, sourceFile, caches, constants} = context
	const {VOID_HTML_TAGS, RAW_TEXT_TAGS, NIMBLE_TAG_MODES} = constants
	const {getResolvedSymbol, isNimbleDeclaration} = context.types
	const {getStructuralDiagnostics} = context.structural

	/**
	 * Return html/svg/mathml only for real nimble-html tag functions.
	 * @param {TaggedTemplateExpression} taggedTemplate
	 * @returns {Namespace | null}
	 */
	function getNimbleTagMode(taggedTemplate) {
		const tagNode =
			ts.isPropertyAccessExpression(taggedTemplate.tag) || ts.isIdentifier(taggedTemplate.tag)
				? taggedTemplate.tag
				: null
		const tagName = tagNode && (ts.isIdentifier(tagNode) ? tagNode.text : tagNode.name.text)
		if (!tagName || !NIMBLE_TAG_MODES.has(tagName)) return null
		const symbol = getResolvedSymbol(ts.isIdentifier(tagNode) ? tagNode : tagNode.name)
		if (!symbol) return null
		for (const declaration of symbol.declarations || []) if (isNimbleDeclaration(declaration)) return tagName
		return null
	}

	/**
	 * Read literal template pieces with their absolute source offsets.
	 * @param {TaggedTemplateExpression} taggedTemplate
	 * @returns {TemplateSegment[]}
	 */
	function readTemplateSegments(taggedTemplate) {
		if (ts.isNoSubstitutionTemplateLiteral(taggedTemplate.template)) {
			const text = taggedTemplate.template.getText(sourceFile)
			return [{text: text.slice(1, -1), start: taggedTemplate.template.getStart(sourceFile) + 1}]
		}
		const segments = []
		const {head, templateSpans} = taggedTemplate.template
		const headText = head.getText(sourceFile)
		segments.push({text: headText.slice(1, -2), start: head.getStart(sourceFile) + 1})
		for (const span of templateSpans) {
			const literalText = span.literal.getText(sourceFile)
			const trimEnd = span.literal.kind === ts.SyntaxKind.TemplateTail ? 1 : 2
			segments.push({text: literalText.slice(1, -trimEnd), start: span.literal.getStart(sourceFile) + 1})
		}
		return segments
	}

	/**
	 * Scan literal segments to classify expression holes and maintain tag stack.
	 * @param {TemplateSegment[]} segments
	 * @param {Namespace} mode
	 * @returns {ScanResult}
	 */
	function scanTemplate(segments, mode) {
		const stack = []
		const state = {
			mode: 'text',
			quote: '',
			currentTag: '',
			currentTagNamespace: mode,
			currentAttr: '',
			pendingSpread: false,
			closingTag: '',
			selfClosing: false,
			rawTextTag: '',
		}
		const holes = []

		/**
		 * Pop the current open tag from the local scanner stack.
		 */
		function closeCurrentTag() {
			const current = stack[stack.length - 1]
			if (!current) return
			stack.pop()
			state.mode = 'text'
			state.rawTextTag = ''
		}

		/**
		 * Finish an opening tag and update namespace/raw-text/stack state.
		 * @param {number} tagStart
		 * @param {number} tagEnd
		 */
		function finalizeTag(tagStart, tagEnd) {
			if (!state.currentTag) {
				state.mode = 'text'
				state.selfClosing = false
				return
			}
			const lowerTagName = state.currentTag.toLowerCase()
			const currentNamespace = stack.length ? stack[stack.length - 1].namespace : mode
			state.currentTagNamespace = resolveNamespace(currentNamespace, state.currentTag)
			if (!state.selfClosing && !(state.currentTagNamespace === 'html' && VOID_HTML_TAGS.has(lowerTagName)))
				stack.push({
					tag: state.currentTag,
					namespace: state.currentTagNamespace,
					start: tagStart,
					length: tagEnd - tagStart + 1,
				})
			state.mode = RAW_TEXT_TAGS.has(lowerTagName) && !state.selfClosing ? 'rawText' : 'text'
			state.rawTextTag = state.mode === 'rawText' ? lowerTagName : ''
			state.quote = ''
			state.currentAttr = ''
			state.currentTag = ''
			state.selfClosing = false
			state.pendingSpread = false
		}

		/**
		 * Finish a closing tag and reconcile it with the local open-tag stack.
		 * @param {number} tagStart
		 */
		function finalizeClosingTag(tagStart) {
			const lowered = state.closingTag.toLowerCase()
			const current = stack[stack.length - 1]
			if (!current) {
				// html-validate reports the diagnostic; the local stack still drives hole context.
			} else if (current.tag.toLowerCase() === lowered) closeCurrentTag()
			else {
				const matchIndex = stack.findLastIndex(entry => entry.tag.toLowerCase() === lowered)
				if (matchIndex >= 0) {
					stack.length = matchIndex + 1
					closeCurrentTag()
				}
			}
			state.mode = 'text'
			state.closingTag = ''
			state.rawTextTag = ''
		}

		for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex++) {
			const {text: segment, start: segmentStart} = segments[segmentIndex]
			let tagStart = -1

			for (let index = 0; index < segment.length; index++) {
				const char = segment[index]

				if (state.mode === 'comment') {
					if (segment.startsWith('-->', index)) {
						state.mode = 'text'
						index += 2
					}
					continue
				}

				if (state.mode === 'cdata') {
					if (segment.startsWith(']]>', index)) {
						state.mode = 'text'
						index += 2
					}
					continue
				}

				if (state.mode === 'rawText') {
					const closeTag = `</${state.rawTextTag}`
					const closeTagBoundary = segment[index + closeTag.length]
					if (
						char === '<' &&
						segment.slice(index, index + closeTag.length).toLowerCase() === closeTag &&
						(closeTagBoundary === '>' || /\s/.test(closeTagBoundary || ''))
					) {
						tagStart = segmentStart + index
						state.mode = 'closingTag'
						state.closingTag = ''
						index++
					}
					continue
				}

				if (state.mode === 'text') {
					if (segment.startsWith('<!--', index)) {
						state.mode = 'comment'
						index += 3
					} else if (segment.startsWith('<![CDATA[', index)) {
						state.mode = 'cdata'
						index += 8
					} else if (char === '<') {
						state.quote = ''
						state.currentAttr = ''
						state.currentTag = ''
						state.pendingSpread = false
						state.selfClosing = false
						tagStart = segmentStart + index
						if (segment[index + 1] === '/') {
							state.mode = 'closingTag'
							state.closingTag = ''
							index++
						} else {
							state.mode = 'tagName'
						}
					}
					continue
				}

				if (state.mode === 'closingTag') {
					if (char === '>' || /\s/.test(char)) {
						if (char === '>') finalizeClosingTag(tagStart)
					} else {
						state.closingTag += char
					}
					continue
				}

				if (state.mode === 'tagName') {
					if (char === '>') {
						finalizeTag(tagStart, segmentStart + index)
					} else if (char === '/') {
						state.selfClosing = true
					} else if (/\s/.test(char)) {
						const currentNamespace = stack.length ? stack[stack.length - 1].namespace : mode
						state.currentTagNamespace = resolveNamespace(currentNamespace, state.currentTag)
						state.mode = 'beforeAttr'
					} else {
						state.currentTag += char
					}
					continue
				}

				if (state.mode === 'beforeAttr') {
					if (char === '>') {
						finalizeTag(tagStart, segmentStart + index)
					} else if (char === '/') {
						state.selfClosing = true
					} else if (/\s/.test(char)) {
						state.pendingSpread = false
					} else if (segment.slice(index, index + 3) === '...') {
						state.pendingSpread = true
						index += 2
					} else {
						state.pendingSpread = false
						state.currentAttr = char
						state.mode = 'attrName'
					}
					continue
				}

				if (state.mode === 'attrName') {
					if (char === '=') {
						state.mode = 'beforeAttrValue'
					} else if (char === '>') {
						finalizeTag(tagStart, segmentStart + index)
					} else if (char === '/') {
						state.selfClosing = true
						state.mode = 'beforeAttr'
					} else if (/\s/.test(char)) {
						state.mode = 'afterAttrName'
					} else {
						state.currentAttr += char
					}
					continue
				}

				if (state.mode === 'afterAttrName') {
					if (char === '=') {
						state.mode = 'beforeAttrValue'
					} else if (char === '>') {
						finalizeTag(tagStart, segmentStart + index)
					} else if (char === '/') {
						state.selfClosing = true
						state.mode = 'beforeAttr'
					} else if (!/\s/.test(char)) {
						state.currentAttr = char
						state.mode = 'attrName'
					}
					continue
				}

				if (state.mode === 'beforeAttrValue') {
					if (/\s/.test(char)) continue
					if (char === '"' || char === "'") {
						state.quote = char
						state.mode = 'attrValue'
					} else if (char === '>') {
						finalizeTag(tagStart, segmentStart + index)
					} else {
						state.quote = ''
						state.mode = 'attrValue'
					}
					continue
				}

				if (state.mode === 'attrValue') {
					if (state.quote) {
						if (char === state.quote) {
							state.quote = ''
							state.currentAttr = ''
							state.mode = 'beforeAttr'
						}
					} else if (char === '>') {
						finalizeTag(tagStart, segmentStart + index)
					} else if (/\s/.test(char)) {
						state.currentAttr = ''
						state.mode = 'beforeAttr'
					}
				}
			}

			if (segmentIndex === segments.length - 1) continue

			// A template boundary becomes a hole whose expected value depends on the parser state.
			if (state.pendingSpread && state.mode === 'beforeAttr') {
				holes.push({
					index: segmentIndex,
					kind: 'spread',
					tagName: state.currentTag,
					namespace: state.currentTagNamespace,
					prefix: '...',
				})
				state.pendingSpread = false
				continue
			}

			if (state.mode === 'beforeAttrValue' || state.mode === 'attrValue') {
				const rawName = state.currentAttr
				holes.push({
					index: segmentIndex,
					kind: rawName.startsWith('.')
						? 'property'
						: rawName.startsWith('?')
							? 'boolean-attribute'
							: rawName.startsWith('@')
								? 'event'
								: 'attribute',
					tagName: state.currentTag,
					namespace: state.currentTagNamespace,
					rawName,
					name: rawName.replace(/^!?(?:[.?@])?/, ''),
					forced: rawName.startsWith('!'),
					quoted: !!state.quote,
				})
				if (state.mode === 'beforeAttrValue') {
					state.currentAttr = ''
					state.mode = 'beforeAttr'
					state.quote = ''
				}
				continue
			}

			holes.push({
				index: segmentIndex,
				kind: 'text',
				tagName: stack.length ? stack[stack.length - 1].tag : '',
				namespace: stack.length ? stack[stack.length - 1].namespace : mode,
			})
		}

		return {holes, state, stack}
	}

	/**
	 * Parse one tagged template into reusable diagnostics/completion metadata.
	 * @param {TaggedTemplateExpression} taggedTemplate
	 * @returns {TemplateEntry | null}
	 */
	function getTemplateEntry(taggedTemplate) {
		if (caches.templateEntries.has(taggedTemplate)) return caches.templateEntries.get(taggedTemplate)
		const mode = getNimbleTagMode(taggedTemplate)
		if (!mode) {
			caches.templateEntries.set(taggedTemplate, null)
			return null
		}
		const segments = readTemplateSegments(taggedTemplate)
		const parsed = scanTemplate(segments, mode)
		const expressions = ts.isNoSubstitutionTemplateLiteral(taggedTemplate.template)
			? []
			: taggedTemplate.template.templateSpans.map(span => span.expression)
		const entry = {
			node: taggedTemplate,
			mode,
			segments,
			...parsed,
			diagnostics: getStructuralDiagnostics(segments, expressions, parsed.holes, parsed.stack, mode),
			expressions,
		}
		caches.templateEntries.set(taggedTemplate, entry)
		return entry
	}

	/**
	 * Discover and cache all nimble tagged templates in the source file.
	 * @returns {TemplateEntry[]}
	 */
	function getTemplateEntries() {
		if (context.cachedTemplateEntries) return context.cachedTemplateEntries
		const entries = []
		const visit = node => {
			if (ts.isTaggedTemplateExpression(node)) {
				const entry = getTemplateEntry(node)
				if (entry) entries.push(entry)
			}
			ts.forEachChild(node, visit)
		}
		visit(sourceFile)
		context.cachedTemplateEntries = entries
		return entries
	}

	/**
	 * Find the innermost cached template that contains a source position.
	 * @param {number} position
	 * @returns {TemplateEntry | null}
	 */
	function getContainingTemplateEntry(position) {
		if (!context.cachedTemplateRanges) {
			context.cachedTemplateRanges = getTemplateEntries()
				.map(entry => ({
					entry,
					start: entry.node.getStart(sourceFile),
					end: entry.node.getEnd(),
				}))
				.sort((left, right) => left.start - right.start || right.end - left.end)
		}
		let best = null
		for (const range of context.cachedTemplateRanges) {
			if (range.start > position) break
			if (position <= range.end && (!best || (range.start >= best.start && range.end <= best.end))) best = range
		}
		return best?.entry || null
	}

	return {getTemplateEntries, getContainingTemplateEntry, scanTemplate}
}

module.exports = {createDiscoveryAndScan}
