// @ts-nocheck

/**
 * @typedef {'html' | 'svg' | 'mathml'} Namespace
 * @typedef {import('typescript').Node} TsNode
 * @typedef {import('typescript').Symbol} TsSymbol
 * @typedef {import('typescript').Declaration} TsDeclaration
 * @typedef {import('typescript').Expression} TsExpression
 * @typedef {import('typescript').Type} TsType
 * @typedef {{expression: TsExpression, unwrapped: TsExpression}} ForceResult
 * @typedef {{name: string, expression: TsExpression, node: TsNode}} SpreadEntry
 */

/**
 * Test whether a declaration comes from nimble-html itself, not a user shadowing.
 * @param {TsDeclaration} declaration
 */
function isNimbleDeclaration(declaration) {
	const fileName = declaration.getSourceFile().fileName.replace(/\\/g, '/')
	return /(^|\/)html\.(d\.ts|js)$/.test(fileName) || fileName.includes('/nimble-html/')
}

/**
 * Strip syntax-only wrappers so type checks inspect the underlying expression.
 * @param {typeof import('typescript')} ts
 * @param {TsExpression} expression
 * @returns {TsExpression}
 */
function unwrapExpression(ts, expression) {
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

/**
 * Create TypeScript symbol/type helpers shared by diagnostics and discovery.
 * @param {object} context
 */
function createTypesAndExpressions(context) {
	const {ts, checker, sourceFile, caches} = context

	/**
	 * Resolve the symbol at a node and unwrap import/export aliases.
	 * @param {TsNode} node
	 * @returns {TsSymbol | null}
	 */
	function getResolvedSymbol(node) {
		let symbol = checker.getSymbolAtLocation(node)
		if (symbol?.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol)
		return symbol || null
	}

	/**
	 * Resolve and cache a global type from the current SourceFile context.
	 * @param {string} name
	 * @returns {TsType | null}
	 */
	function getGlobalType(name) {
		if (caches.globalTypes.has(name)) return caches.globalTypes.get(name)
		const symbol = checker.resolveName(name, sourceFile, ts.SymbolFlags.Type, false)
		const type = symbol ? checker.getDeclaredTypeOfSymbol(symbol) : null
		caches.globalTypes.set(name, type)
		return type
	}

	/**
	 * Resolve a tag-name-map entry like HTMLElementTagNameMap["button"].
	 * @param {string} mapName
	 * @param {string} tagName
	 * @returns {TsType | null}
	 */
	function getTagType(mapName, tagName) {
		const cacheKey = `${mapName}:${tagName}`
		if (caches.tagMapTypes.has(cacheKey)) return caches.tagMapTypes.get(cacheKey)
		const mapType = getGlobalType(mapName)
		const property = mapType && checker.getPropertyOfType(mapType, tagName)
		const type = property ? checker.getTypeOfSymbolAtLocation(property, sourceFile) : null
		caches.tagMapTypes.set(cacheKey, type)
		return type
	}

	/**
	 * Resolve the DOM element instance type for a namespace/tag pair.
	 * @param {Namespace} namespace
	 * @param {string} tagName
	 * @returns {TsType | null}
	 */
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

	/**
	 * If the expression is nimble-html's force(value), return value for checking.
	 * @param {TsExpression} expression
	 * @returns {ForceResult}
	 */
	function unwrapForceExpression(expression) {
		const current = unwrapExpression(ts, expression)
		if (!ts.isCallExpression(current) || current.arguments.length !== 1)
			return {expression: current, unwrapped: current}
		if (!ts.isIdentifier(current.expression) || current.expression.text !== 'force')
			return {expression: current, unwrapped: current}
		const symbol = getResolvedSymbol(current.expression)
		if (!symbol) return {expression: current, unwrapped: current}
		for (const declaration of symbol.declarations || [])
			if (isNimbleDeclaration(declaration)) return {expression: current, unwrapped: current.arguments[0]}
		return {expression: current, unwrapped: current}
	}

	/**
	 * Extract statically-known entries from an object literal spread binding.
	 * @param {TsExpression} expression
	 * @returns {SpreadEntry[] | null}
	 */
	function resolveSpreadEntries(expression) {
		let current = unwrapExpression(ts, expression)
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

	return {
		getResolvedSymbol,
		isNimbleDeclaration,
		getGlobalType,
		getTagType,
		resolveElementType,
		unwrapExpression: expression => unwrapExpression(ts, expression),
		unwrapForceExpression,
		resolveSpreadEntries,
	}
}

module.exports = {createTypesAndExpressions}
