// @ts-nocheck

const DIAGNOSTIC_CODES = {
	attributeValue: 91001,
	booleanAttributeValue: 91002,
	propertyValue: 91003,
	eventValue: 91004,
	eventParameter: 91005,
	spreadValue: 91006,
	spreadEntryValue: 91007,
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

function createAnalyzer(ts, program, sourceFile) {
	const checker = program.getTypeChecker()
	const caches = {
		tagMapTypes: new Map(),
		globalTypes: new Map(),
		completionSets: new Map(),
		templateEntries: new WeakMap(),
	}
	let cachedDiagnostics = null
	let cachedTemplateEntries = null

	function getGlobalType(name) {
		if (caches.globalTypes.has(name)) return caches.globalTypes.get(name)
		const symbol = checker.resolveName(name, sourceFile, ts.SymbolFlags.Type, false)
		const type = symbol ? checker.getDeclaredTypeOfSymbol(symbol) : null
		caches.globalTypes.set(name, type)
		return type
	}

	function getTagType(mapName, tagName) {
		const cacheKey = `${mapName}:${tagName}`
		if (caches.tagMapTypes.has(cacheKey)) return caches.tagMapTypes.get(cacheKey)
		const mapType = getGlobalType(mapName)
		const property = mapType && checker.getPropertyOfType(mapType, tagName)
		const type = property ? checker.getTypeOfSymbolAtLocation(property, sourceFile) : null
		caches.tagMapTypes.set(cacheKey, type)
		return type
	}

	function getNimbleTagMode(taggedTemplate) {
		const tagNode =
			ts.isPropertyAccessExpression(taggedTemplate.tag) || ts.isIdentifier(taggedTemplate.tag)
				? taggedTemplate.tag
				: null
		const tagName = tagNode && (ts.isIdentifier(tagNode) ? tagNode.text : tagNode.name.text)
		if (!tagName || !['html', 'svg', 'mathml'].includes(tagName)) return null
		let symbol = checker.getSymbolAtLocation(ts.isIdentifier(tagNode) ? tagNode : tagNode.name)
		if (!symbol) return null
		if (symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol)
		const declarations = symbol.declarations || []
		for (const declaration of declarations) {
			const fileName = declaration.getSourceFile().fileName.replace(/\\/g, '/')
			if (/(^|\/)html\.(d\.ts|js)$/.test(fileName) || fileName.includes('/nimble-html/')) return tagName
		}
		return null
	}

	function resolveElementType(namespace, tagName) {
		const loweredTagName = tagName.toLowerCase()
		const htmlType = getTagType('HTMLElementTagNameMap', loweredTagName)
		const svgType = getTagType('SVGElementTagNameMap', loweredTagName)
		const mathType = getTagType('MathMLElementTagNameMap', loweredTagName)
		if (namespace === 'svg') return svgType || htmlType || null
		if (namespace === 'mathml') return mathType || htmlType || null
		if (namespace === 'html') {
			if (htmlType) return htmlType
			if (!htmlType && svgType && !mathType) return svgType
			if (!htmlType && mathType && !svgType) return mathType
		}
		return htmlType || svgType || mathType || null
	}

	function resolveNamespace(parentNamespace, tagName) {
		if (parentNamespace === 'html' && tagName.toLowerCase() === 'svg') return 'svg'
		if (parentNamespace === 'html' && tagName.toLowerCase() === 'math') return 'mathml'
		if (parentNamespace === 'svg' && tagName === 'foreignObject') return 'html'
		return parentNamespace
	}

	function scanTemplate(strings, mode) {
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
		}
		const holes = []

		function finalizeTag() {
			if (!state.currentTag) {
				state.mode = 'text'
				state.selfClosing = false
				return
			}
			const currentNamespace = stack.length ? stack[stack.length - 1].namespace : mode
			state.currentTagNamespace = resolveNamespace(currentNamespace, state.currentTag)
			if (
				!state.selfClosing &&
				!(state.currentTagNamespace === 'html' && VOID_HTML_TAGS.has(state.currentTag.toLowerCase()))
			)
				stack.push({tag: state.currentTag, namespace: state.currentTagNamespace})
			state.mode = 'text'
			state.quote = ''
			state.currentAttr = ''
			state.currentTag = ''
			state.selfClosing = false
			state.pendingSpread = false
		}

		function finalizeClosingTag() {
			const lowered = state.closingTag.toLowerCase()
			for (let index = stack.length - 1; index >= 0; index--) {
				if (stack[index].tag.toLowerCase() === lowered) {
					stack.length = index
					break
				}
			}
			state.mode = 'text'
			state.closingTag = ''
		}

		for (let segmentIndex = 0; segmentIndex < strings.length; segmentIndex++) {
			const segment = strings[segmentIndex]

			for (let index = 0; index < segment.length; index++) {
				const char = segment[index]

				if (state.mode === 'text') {
					if (char === '<') {
						state.quote = ''
						state.currentAttr = ''
						state.currentTag = ''
						state.pendingSpread = false
						state.selfClosing = false
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
						if (char === '>') finalizeClosingTag()
					} else {
						state.closingTag += char
					}
					continue
				}

				if (state.mode === 'tagName') {
					if (char === '>') {
						finalizeTag()
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
						finalizeTag()
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
						finalizeTag()
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
						finalizeTag()
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
						finalizeTag()
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
						finalizeTag()
					} else if (/\s/.test(char)) {
						state.currentAttr = ''
						state.mode = 'beforeAttr'
					}
				}
			}

			if (segmentIndex === strings.length - 1) continue

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

		return {holes, state, stack}
	}

	function parseTemplate(strings, mode) {
		return scanTemplate(strings, mode).holes
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

	function getTemplateEntry(taggedTemplate) {
		if (caches.templateEntries.has(taggedTemplate)) return caches.templateEntries.get(taggedTemplate)
		const mode = getNimbleTagMode(taggedTemplate)
		if (!mode) {
			caches.templateEntries.set(taggedTemplate, null)
			return null
		}
		const segments = readTemplateSegments(taggedTemplate)
		const entry = {
			node: taggedTemplate,
			mode,
			segments,
			holes: parseTemplate(
				segments.map(segment => segment.text),
				mode,
			),
			expressions: ts.isNoSubstitutionTemplateLiteral(taggedTemplate.template)
				? []
				: taggedTemplate.template.templateSpans.map(span => span.expression),
		}
		caches.templateEntries.set(taggedTemplate, entry)
		return entry
	}

	function getTemplateEntries() {
		if (cachedTemplateEntries) return cachedTemplateEntries
		const entries = []
		const visit = node => {
			if (ts.isTaggedTemplateExpression(node)) {
				const entry = getTemplateEntry(node)
				if (entry) entries.push(entry)
			}
			ts.forEachChild(node, visit)
		}
		visit(sourceFile)
		cachedTemplateEntries = entries
		return entries
	}

	function getNodeAtPosition(node, position) {
		if (position < node.getFullStart() || position > node.getEnd()) return null
		let match = node
		ts.forEachChild(node, child => {
			const childMatch = getNodeAtPosition(child, position)
			if (childMatch) match = childMatch
		})
		return match
	}

	function getContainingTemplateEntry(position) {
		for (let node = getNodeAtPosition(sourceFile, position); node; node = node.parent) {
			if (!ts.isTaggedTemplateExpression(node)) continue
			return getTemplateEntry(node)
		}
		return null
	}

	function getBindingExpectation(hole) {
		if (hole.kind === 'text') return {kind: 'text', label: 'child value'}
		if (hole.kind === 'spread') return {kind: 'spread', label: 'object, false, null, or undefined'}
		if (!hole.tagName) return {kind: 'unknown', label: 'unknown'}
		const elementType = resolveElementType(hole.namespace, hole.tagName)
		if (!elementType) {
			if (hole.kind === 'event') return {kind: 'event', label: hole.name}
			if (hole.kind === 'boolean-attribute') return {kind: 'boolean', label: 'boolean'}
			return {kind: 'unknown', label: 'unknown'}
		}

		if (hole.kind === 'property') {
			const property = checker.getPropertyOfType(elementType, hole.name)
			if (!property)
				return hole.tagName.includes('-') ? {kind: 'unknown', label: 'unknown'} : {kind: 'property', label: hole.name}
			return {kind: 'property', label: hole.name, type: checker.getTypeOfSymbolAtLocation(property, sourceFile)}
		}

		if (hole.kind === 'event') {
			const eventMap = getGlobalType('GlobalEventHandlersEventMap')
			const eventProperty =
				eventMap &&
				(checker.getPropertyOfType(eventMap, hole.name) ||
					checker.getPropertyOfType(eventMap, hole.name.toLowerCase()) ||
					checker.getPropertyOfType(eventMap, hole.name.toUpperCase()))
			return {
				kind: 'event',
				label: hole.name,
				eventType: eventProperty ? checker.getTypeOfSymbolAtLocation(eventProperty, sourceFile) : null,
			}
		}

		if (hole.kind === 'boolean-attribute') {
			const property =
				checker.getPropertyOfType(elementType, hole.name) ||
				checker.getPropertyOfType(elementType, hole.name.toLowerCase())
			if (!property)
				return hole.tagName.includes('-') ? {kind: 'boolean', label: 'boolean'} : {kind: 'boolean', label: 'boolean'}
			return {kind: 'boolean', label: hole.name, type: checker.getTypeOfSymbolAtLocation(property, sourceFile)}
		}

		const exactProperty = checker.getPropertyOfType(elementType, hole.name)
		if (exactProperty)
			return {
				kind: 'attribute',
				label: hole.name,
				type: checker.getTypeOfSymbolAtLocation(exactProperty, sourceFile),
			}
		const loweredName = hole.name.toLowerCase()
		for (const property of checker.getPropertiesOfType(elementType)) {
			if (String(property.escapedName).toLowerCase() === loweredName)
				return {
					kind: 'attribute',
					label: hole.name,
					type: checker.getTypeOfSymbolAtLocation(property, sourceFile),
				}
		}
		return {kind: 'attribute-primitive', label: hole.name}
	}

	function checkSimpleKind(actualType, expectation) {
		const typeString = checker.typeToString(actualType)
		if (actualType.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.Never)) return null
		if (expectation.kind === 'attribute-primitive') {
			if (actualType.isUnion()) {
				for (const unionPart of actualType.types) {
					const unionResult = checkSimpleKind(unionPart, expectation)
					if (unionResult) return unionResult
				}
				return null
			}
			const allowedFlags =
				ts.TypeFlags.StringLike |
				ts.TypeFlags.NumberLike |
				ts.TypeFlags.BooleanLike |
				ts.TypeFlags.BigIntLike |
				ts.TypeFlags.Null |
				ts.TypeFlags.Undefined
			return actualType.flags & allowedFlags ? null : `primitive attribute value, got ${typeString}`
		}
		if (expectation.kind === 'boolean') {
			const expectedType = expectation.type || checker.getBooleanType()
			return checker.isTypeAssignableTo(actualType, expectedType) ? null : `boolean, got ${typeString}`
		}
		if (expectation.kind === 'property' || expectation.kind === 'attribute') {
			if (!expectation.type || expectation.type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) return null
			return checker.isTypeAssignableTo(actualType, expectation.type)
				? null
				: `${checker.typeToString(expectation.type)}, got ${typeString}`
		}
		return null
	}

	function analyzeEventExpression(expression, expectation) {
		const actualType = checker.getTypeAtLocation(expression)
		if (actualType.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.Never)) return []
		if (
			ts.isArrowFunction(expression) ||
			ts.isFunctionExpression(expression) ||
			ts.isMethodDeclaration(expression) ||
			ts.isFunctionDeclaration(expression)
		) {
			if (!expectation.eventType || !expression.parameters.length) return []
			const [firstParam] = expression.parameters
			if (!firstParam.type) return []
			const parameterType = checker.getTypeAtLocation(firstParam)
			return checker.isTypeAssignableTo(expectation.eventType, parameterType)
				? []
				: [
						{
							node: firstParam,
							code: DIAGNOSTIC_CODES.eventParameter,
							message: `nimble-html @${expectation.label} handler should accept ${checker.typeToString(expectation.eventType)}.`,
						},
					]
		}
		if (actualType.getCallSignatures().length) return []
		if (actualType.isUnion()) {
			for (const unionPart of actualType.types) {
				if (unionPart.getCallSignatures().length) continue
				const flags = unionPart.flags
				if (
					flags &
					(ts.TypeFlags.StringLike | ts.TypeFlags.BooleanLiteral | ts.TypeFlags.Null | ts.TypeFlags.Undefined)
				)
					continue
				return [
					{
						node: expression,
						code: DIAGNOSTIC_CODES.eventValue,
						message: `nimble-html @${expectation.label} expects a function, string, false, null, or undefined.`,
					},
				]
			}
			return []
		}
		const flags = actualType.flags
		return flags & ts.TypeFlags.StringLike ||
			(flags & ts.TypeFlags.BooleanLiteral && actualType.intrinsicName === 'false') ||
			flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined)
			? []
			: [
					{
						node: expression,
						code: DIAGNOSTIC_CODES.eventValue,
						message: `nimble-html @${expectation.label} expects a function, string, false, null, or undefined.`,
					},
				]
	}

	function unwrapExpression(expression) {
		let current = expression
		while (
			ts.isParenthesizedExpression(current) ||
			ts.isAsExpression(current) ||
			ts.isTypeAssertionExpression(current) ||
			ts.isNonNullExpression(current)
		)
			current = current.expression
		return current
	}

	function unwrapForceExpression(expression) {
		const current = unwrapExpression(expression)
		if (!ts.isCallExpression(current) || current.arguments.length !== 1)
			return {expression: current, unwrapped: current}
		if (!ts.isIdentifier(current.expression) || current.expression.text !== 'force')
			return {expression: current, unwrapped: current}
		let symbol = checker.getSymbolAtLocation(current.expression)
		if (!symbol) return {expression: current, unwrapped: current}
		if (symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol)
		const declarations = symbol.declarations || []
		for (const declaration of declarations) {
			const fileName = declaration.getSourceFile().fileName.replace(/\\/g, '/')
			if (/(^|\/)html\.(d\.ts|js)$/.test(fileName) || fileName.includes('/nimble-html/'))
				return {expression: current, unwrapped: current.arguments[0]}
		}
		return {expression: current, unwrapped: current}
	}

	function resolveSpreadEntries(expression) {
		let current = unwrapExpression(expression)
		if (ts.isIdentifier(current)) {
			const symbol = checker.getSymbolAtLocation(current)
			if (
				symbol?.valueDeclaration &&
				ts.isVariableDeclaration(symbol.valueDeclaration) &&
				symbol.valueDeclaration.initializer
			)
				current = symbol.valueDeclaration.initializer
		}
		if (!ts.isObjectLiteralExpression(current)) return null
		const entries = []
		for (const property of current.properties) {
			if (ts.isShorthandPropertyAssignment(property)) {
				entries.push({name: property.name.text, expression: property.name, node: property.name})
				continue
			}
			if (!ts.isPropertyAssignment(property)) continue
			if (ts.isComputedPropertyName(property.name)) continue
			const name = ts.isIdentifier(property.name)
				? property.name.text
				: ts.isStringLiteralLike(property.name) || ts.isNumericLiteral(property.name)
					? property.name.text
					: null
			if (!name) continue
			entries.push({name, expression: property.initializer, node: property.name})
		}
		return entries
	}

	function isSpreadValueAllowed(actualType) {
		if (actualType.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.Never)) return true
		if (actualType.isUnion()) return actualType.types.every(isSpreadValueAllowed)
		if (actualType.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined)) return true
		if (actualType.flags & ts.TypeFlags.BooleanLiteral) return actualType.intrinsicName === 'false'
		if (!(actualType.flags & ts.TypeFlags.Object)) return false
		if (checker.isArrayType(actualType) || checker.isTupleType(actualType)) return false
		const symbol = actualType.getSymbol()
		return !symbol || String(symbol.getName()) !== 'Node'
	}

	function buildDiagnostics() {
		if (cachedDiagnostics) return cachedDiagnostics
		const diagnostics = []

		function pushDiagnostic(node, code, message) {
			diagnostics.push({
				file: sourceFile,
				start: node.getStart(sourceFile),
				length: node.getWidth(sourceFile),
				category: ts.DiagnosticCategory.Error,
				code,
				messageText: message,
			})
		}

		function analyzeBindingExpression(hole, expression, codePrefix) {
			const {unwrapped} = unwrapForceExpression(expression)
			const expectation = getBindingExpectation(hole)
			if (hole.kind === 'event') {
				for (const eventDiagnostic of analyzeEventExpression(unwrapped, expectation))
					pushDiagnostic(eventDiagnostic.node, eventDiagnostic.code, eventDiagnostic.message)
				return
			}
			if (hole.kind === 'text' || expectation.kind === 'unknown' || expectation.kind === 'text') return
			const actualType = checker.getTypeAtLocation(unwrapped)
			const mismatch = checkSimpleKind(actualType, expectation)
			if (!mismatch) return
			const diagnosticCode =
				codePrefix === 'spread'
					? DIAGNOSTIC_CODES.spreadEntryValue
					: hole.kind === 'boolean-attribute'
						? DIAGNOSTIC_CODES.booleanAttributeValue
						: hole.kind === 'property'
							? DIAGNOSTIC_CODES.propertyValue
							: DIAGNOSTIC_CODES.attributeValue
			const labelPrefix =
				hole.kind === 'property'
					? `.${hole.name}`
					: hole.kind === 'boolean-attribute'
						? `?${hole.name}`
						: hole.kind === 'attribute'
							? hole.name
							: hole.kind
			pushDiagnostic(
				unwrapped,
				diagnosticCode,
				`nimble-html ${codePrefix === 'spread' ? 'spread entry ' : ''}${labelPrefix} on <${hole.tagName}> expects ${mismatch}.`,
			)
		}

		for (const {holes, expressions} of getTemplateEntries()) {
			for (let index = 0; index < holes.length; index++) {
				const hole = holes[index]
				const expression = expressions[index]
				if (!expression) continue
				if (hole.kind === 'spread') {
					const {unwrapped} = unwrapForceExpression(expression)
					const actualType = checker.getTypeAtLocation(unwrapped)
					if (!isSpreadValueAllowed(actualType))
						pushDiagnostic(
							unwrapped,
							DIAGNOSTIC_CODES.spreadValue,
							`nimble-html spread on <${hole.tagName}> expects an object, false, null, or undefined.`,
						)
					const entries = resolveSpreadEntries(unwrapped)
					if (!entries) continue
					for (const entry of entries) {
						const entryHole = entry.name.startsWith('.')
							? {...hole, kind: 'property', name: entry.name.slice(1)}
							: entry.name.startsWith('?')
								? {...hole, kind: 'boolean-attribute', name: entry.name.slice(1)}
								: entry.name.startsWith('@')
									? {...hole, kind: 'event', name: entry.name.slice(1)}
									: {...hole, kind: 'attribute', name: entry.name}
						analyzeBindingExpression(entryHole, entry.expression, 'spread')
					}
					continue
				}
				analyzeBindingExpression(hole, expression, 'direct')
			}
		}
		cachedDiagnostics = diagnostics
		return diagnostics
	}

	function getTemplateCompletions(position) {
		let completion = null

		function getCompletionSet(namespace, tagName) {
			const cacheKey = `${namespace}:${tagName}`
			let completionSet = caches.completionSets.get(cacheKey)
			if (!completionSet) {
				const elementType = resolveElementType(namespace, tagName)
				const propertyEntries = new Set()
				const attributeEntries = new Set(['class', 'id', 'title', 'style', 'slot', 'part', 'role', 'tabindex'])
				const booleanEntries = new Set(['hidden'])
				const eventEntries = new Set(['click', 'input', 'change', 'submit', 'keydown', 'keyup'])
				if (elementType) {
					for (const property of checker.getPropertiesOfType(elementType)) {
						const name = String(property.escapedName)
						const propertyType = checker.getTypeOfSymbolAtLocation(property, sourceFile)
						if (propertyType.getCallSignatures().length) continue
						propertyEntries.add(name)
						attributeEntries.add(name.toLowerCase())
						if (propertyType.flags & ts.TypeFlags.BooleanLike) booleanEntries.add(name.toLowerCase())
					}
				}
				const eventMap = getGlobalType('GlobalEventHandlersEventMap')
				if (eventMap)
					for (const property of checker.getPropertiesOfType(eventMap)) eventEntries.add(String(property.escapedName))
				completionSet = {
					properties: [...propertyEntries].sort(),
					attributes: [...attributeEntries].sort(),
					booleans: [...booleanEntries].sort(),
					events: [...eventEntries].sort(),
				}
				caches.completionSets.set(cacheKey, completionSet)
			}
			return completionSet
		}

		function buildEntries(namespace, tagName, partial, forcePrefix, quoted) {
			const completionSet = getCompletionSet(namespace, tagName)
			const entries = []
			const loweredPartial = partial.toLowerCase()
			const addEntries = (names, prefix, sortText, shouldQuote = quoted) => {
				for (const name of names) {
					const completionName = `${forcePrefix}${prefix}${name}`
					const matches =
						prefix === '.' || prefix === '@'
							? completionName.startsWith(`${forcePrefix}${partial}`)
							: completionName.toLowerCase().startsWith(`${forcePrefix}${loweredPartial}`)
					if (matches)
						entries.push({
							name: completionName,
							insertText: shouldQuote ? `'${completionName}'` : completionName,
							kind: 'property',
							sortText,
						})
				}
			}
			addEntries(completionSet.attributes, '', '1', false)
			addEntries(completionSet.booleans, '?', '2')
			addEntries(completionSet.properties, '.', '3')
			addEntries(completionSet.events, '@', '4')
			if (!partial || 'data-'.startsWith(loweredPartial))
				entries.push({
					name: `${forcePrefix}data-`,
					insertText: quoted ? `'${forcePrefix}data-'` : `${forcePrefix}data-`,
					kind: 'property',
					sortText: '5',
				})
			if (!partial || 'aria-'.startsWith(loweredPartial))
				entries.push({
					name: `${forcePrefix}aria-`,
					insertText: quoted ? `'${forcePrefix}aria-'` : `${forcePrefix}aria-`,
					kind: 'property',
					sortText: '6',
				})
			return entries
		}

		const entry = getContainingTemplateEntry(position)
		if (!entry) return completion
		const {mode, segments, holes, node} = entry
		for (const segment of segments) {
			const segmentEnd = segment.start + segment.text.length
			if (position < segment.start || position > segmentEnd) continue
			const priorText = segment.text.slice(0, position - segment.start)
			const {state} = scanTemplate([priorText], mode)
			if (!state.currentTag || !['beforeAttr', 'attrName', 'afterAttrName'].includes(state.mode)) return completion
			const match = priorText.match(/(?:^|[\s<>"'=\/])(!?[.?@]?[A-Za-z0-9:_-]*)$/)
			if (!match) return completion
			const token = match[1]
			const forcePrefix = token.startsWith('!') ? '!' : ''
			const partial = forcePrefix ? token.slice(1) : token
			return {
				entries: buildEntries(state.currentTagNamespace, state.currentTag || 'div', partial, forcePrefix, false),
				replacementSpan: {
					start: position - token.length,
					length: token.length,
				},
			}
		}
		if (ts.isNoSubstitutionTemplateLiteral(node.template)) return completion
		for (let index = 0; index < node.template.templateSpans.length; index++) {
			const span = node.template.templateSpans[index]
			const hole = holes[index]
			if (hole?.kind !== 'spread') continue
			if (position < span.expression.getStart(sourceFile) || position > span.expression.getEnd()) continue
			const {unwrapped} = unwrapForceExpression(span.expression)
			if (!ts.isObjectLiteralExpression(unwrapped)) return completion
			const objectStart = unwrapped.getStart(sourceFile) + 1
			const objectEnd = unwrapped.getEnd() - 1
			if (position < objectStart || position > objectEnd) return completion
			const currentEntry = sourceFile.text.slice(objectStart, position).split(',').at(-1).replace(/^\s*/, '')
			if (currentEntry.includes(':')) return completion
			const match = currentEntry.match(/^(['"]?)([!?.@A-Za-z0-9:_-]*)$/)
			if (!match) return completion
			const [, quote, partial] = match
			const token = match[0]
			const replacementLength = quote ? token.length : partial.length
			return {
				entries: buildEntries(hole.namespace, hole.tagName || 'div', partial, '', true),
				replacementSpan: {
					start: position - replacementLength,
					length: replacementLength,
				},
			}
		}
		return completion
	}

	return {buildDiagnostics, getTemplateCompletions}
}

const analyzerCache = new WeakMap()

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
