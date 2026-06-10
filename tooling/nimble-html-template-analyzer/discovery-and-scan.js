// @ts-nocheck

function resolveNamespace(parentNamespace, tagName) {
	if (parentNamespace === 'html' && tagName.toLowerCase() === 'svg') return 'svg'
	if (parentNamespace === 'html' && tagName.toLowerCase() === 'math') return 'mathml'
	if (parentNamespace === 'svg' && tagName === 'foreignObject') return 'html'
	return parentNamespace
}

function createDiscoveryAndScan(context) {
	const {ts, sourceFile, caches, constants} = context
	const {DIAGNOSTIC_CODES, STRUCTURAL_RULES} = constants
	const {VOID_HTML_TAGS, RAW_TEXT_TAGS, PHRASING_ONLY_TAGS, NON_PHRASING_CHILD_TAGS} = constants
	const {OPTIONAL_END_TAG_OPEN_RULES, NIMBLE_TAG_MODES} = constants
	const {getResolvedSymbol, isNimbleDeclaration} = context.types

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
		const diagnostics = []

		function pushStructuralDiagnostic(start, length, code, ruleId, message) {
			diagnostics.push({start, length, code, ruleId, message})
		}

		function closeCurrentTag() {
			const current = stack[stack.length - 1]
			if (!current) return
			stack.pop()
			state.mode = 'text'
			state.rawTextTag = ''
		}

		function finalizeTag(tagStart, tagEnd) {
			if (!state.currentTag) {
				state.mode = 'text'
				state.selfClosing = false
				return
			}
			const lowerTagName = state.currentTag.toLowerCase()
			const currentNamespace = stack.length ? stack[stack.length - 1].namespace : mode
			state.currentTagNamespace = resolveNamespace(currentNamespace, state.currentTag)
			const parent = stack[stack.length - 1]
			const parentTag = parent?.tag.toLowerCase() || ''
			if (state.currentTagNamespace === 'html') {
				const impliedCloseChildren = OPTIONAL_END_TAG_OPEN_RULES.get(parentTag)
				if (impliedCloseChildren?.has(lowerTagName))
					pushStructuralDiagnostic(
						tagStart,
						tagEnd - tagStart + 1,
						DIAGNOSTIC_CODES.implicitOptionalEndTag,
						STRUCTURAL_RULES.implicitOptionalEndTag,
						`Opening <${state.currentTag}> relies on an implicit closing tag for <${parent.tag}>.`,
					)
				if (
					parent &&
					parent.namespace === 'html' &&
					PHRASING_ONLY_TAGS.has(parentTag) &&
					NON_PHRASING_CHILD_TAGS.has(lowerTagName)
				)
					pushStructuralDiagnostic(
						tagStart,
						tagEnd - tagStart + 1,
						DIAGNOSTIC_CODES.invalidNesting,
						STRUCTURAL_RULES.invalidNesting,
						`<${state.currentTag}> is not allowed inside <${parent.tag}>; browser parsing will change the DOM tree.`,
					)
				if (lowerTagName === 'a' && stack.some(entry => entry.namespace === 'html' && entry.tag.toLowerCase() === 'a'))
					pushStructuralDiagnostic(
						tagStart,
						tagEnd - tagStart + 1,
						DIAGNOSTIC_CODES.invalidNesting,
						STRUCTURAL_RULES.invalidNesting,
						'Nested <a> elements are not allowed; browser parsing will change the DOM tree.',
					)
				if (lowerTagName === 'tr' && parentTag === 'table')
					pushStructuralDiagnostic(
						tagStart,
						tagEnd - tagStart + 1,
						DIAGNOSTIC_CODES.implicitTbody,
						STRUCTURAL_RULES.implicitTbody,
						'<tr> cannot appear directly under <table>; write an explicit <tbody>.',
					)
				if ((lowerTagName === 'td' || lowerTagName === 'th') && parentTag !== 'tr')
					pushStructuralDiagnostic(
						tagStart,
						tagEnd - tagStart + 1,
						DIAGNOSTIC_CODES.invalidTableStructure,
						STRUCTURAL_RULES.invalidTableStructure,
						`<${state.currentTag}> must appear inside <tr>.`,
					)
				if (lowerTagName === 'tr' && parentTag && !['table', 'thead', 'tbody', 'tfoot'].includes(parentTag))
					pushStructuralDiagnostic(
						tagStart,
						tagEnd - tagStart + 1,
						DIAGNOSTIC_CODES.invalidTableStructure,
						STRUCTURAL_RULES.invalidTableStructure,
						'<tr> must appear inside <thead>, <tbody>, or <tfoot>.',
					)
			}
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

		function finalizeClosingTag(tagStart) {
			const lowered = state.closingTag.toLowerCase()
			const current = stack[stack.length - 1]
			if (!current)
				pushStructuralDiagnostic(
					tagStart,
					state.closingTag.length + 3,
					DIAGNOSTIC_CODES.mismatchedClosingTag,
					STRUCTURAL_RULES.mismatchedClosingTag,
					`Closing </${state.closingTag}> does not match any open tag.`,
				)
			else if (current.tag.toLowerCase() === lowered) closeCurrentTag()
			else {
				pushStructuralDiagnostic(
					tagStart,
					state.closingTag.length + 3,
					DIAGNOSTIC_CODES.mismatchedClosingTag,
					STRUCTURAL_RULES.mismatchedClosingTag,
					`Closing </${state.closingTag}> does not match currently open <${current.tag}>.`,
				)
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

		for (const entry of stack)
			pushStructuralDiagnostic(
				entry.start,
				entry.length,
				DIAGNOSTIC_CODES.missingClosingTag,
				STRUCTURAL_RULES.missingClosingTag,
				`Missing closing tag for <${entry.tag}>.`,
			)

		return {holes, state, stack, diagnostics}
	}

	function getTemplateEntry(taggedTemplate) {
		if (caches.templateEntries.has(taggedTemplate)) return caches.templateEntries.get(taggedTemplate)
		const mode = getNimbleTagMode(taggedTemplate)
		if (!mode) {
			caches.templateEntries.set(taggedTemplate, null)
			return null
		}
		const segments = readTemplateSegments(taggedTemplate)
		const parsed = scanTemplate(segments, mode)
		const entry = {
			node: taggedTemplate,
			mode,
			segments,
			...parsed,
			expressions: ts.isNoSubstitutionTemplateLiteral(taggedTemplate.template)
				? []
				: taggedTemplate.template.templateSpans.map(span => span.expression),
		}
		caches.templateEntries.set(taggedTemplate, entry)
		return entry
	}

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
